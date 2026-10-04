package pty

import (
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

// Keep enough PTY history to recover a stalled or briefly disconnected
// renderer without throwing away the user's xterm scrollback. Memory is
// allocated only as output arrives and remains bounded per live session.
const outputBufSize = 8 * 1024 * 1024

type Session struct {
	ProjectName  string
	ProjectPath  string
	ptmx         *os.File
	cmd          *exec.Cmd
	mu           sync.Mutex
	closed       bool
	alive        bool
	subscribers  map[*OutputSubscription]struct{}
	outputBuf    []byte
	outputLimit  int
	outputCursor uint64
	lastOutput   time.Time
	outputMu     sync.Mutex
	processDone  bool
	exitCode     int
	exitErr      string
	cli          string
}

func (s *Session) setCLI(cli string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cli = cli
}

func (s *Session) CLI() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cli
}

func NewSession(name, path string) *Session {
	return &Session{
		ProjectName: name,
		ProjectPath: path,
		subscribers: make(map[*OutputSubscription]struct{}),
		outputLimit: outputBufSize,
	}
}

func (s *Session) SetOutputLimit(limit int) {
	s.outputMu.Lock()
	defer s.outputMu.Unlock()
	s.outputLimit = limit
	if limit > 0 && len(s.outputBuf) > limit {
		s.outputBuf = s.outputBuf[len(s.outputBuf)-limit:]
	}
}

func (s *Session) Start(cols, rows uint16, cli string, dangerous bool) error {
	return s.StartWithOptions(cols, rows, cli, dangerous, StartOptions{})
}

func (s *Session) StartWithOptions(cols, rows uint16, cli string, dangerous bool, options StartOptions) error {
	return s.StartWithCommand(cols, rows, sessionStartCommand(cli, dangerous, options))
}

// Integrating with an explicit merge of @{u} rather than `git pull` keeps startup
// immune to FETCH_HEAD: a background fetcher appending to it leaves the branch
// listed twice, which pull reads as two merge heads and refuses as "divergent".
func sessionStartCommand(cli string, dangerous bool, options StartOptions) string {
	if options.SkipStartupGitPull {
		return StartCommandWithOptions(cli, dangerous, options)
	}
	if options.StartupGitPullFFOnly {
		return "git fetch --quiet 2>&1 && git merge --ff-only '@{u}' 2>&1; " + StartCommandWithOptions(cli, dangerous, options)
	}
	return "git fetch --quiet 2>&1 && git merge '@{u}' 2>&1; " + StartCommandWithOptions(cli, dangerous, options)
}

func (s *Session) StartWithCommand(cols, rows uint16, command string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "bash"
	}
	s.cmd = exec.Command(shell, "-l", "-i", "-c", command)
	s.cmd.Dir = s.ProjectPath
	s.cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	var err error
	s.ptmx, err = pty.StartWithSize(s.cmd, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		return err
	}

	s.alive = true
	go s.readLoop()
	go s.waitLoop()

	return nil
}

func (s *Session) waitLoop() {
	err := s.cmd.Wait()
	exitCode := 0
	exitErr := ""
	if err != nil {
		exitErr = err.Error()
		exitCode = -1
		if exitError, ok := err.(*exec.ExitError); ok {
			exitCode = exitError.ExitCode()
		}
	}

	s.mu.Lock()
	s.alive = false
	s.processDone = true
	s.exitCode = exitCode
	s.exitErr = exitErr
	ptmx := s.ptmx
	s.mu.Unlock()

	if ptmx != nil {
		ptmx.Close()
	}
}

func (s *Session) readLoop() {
	buf := make([]byte, 32*1024)
	for {
		n, err := s.ptmx.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			s.publishOutput(chunk)
		}
		if err != nil {
			return
		}
	}
}

func (s *Session) appendOutput(data []byte) {
	s.outputMu.Lock()
	defer s.outputMu.Unlock()
	s.appendOutputLocked(data)
}

func (s *Session) appendOutputLocked(data []byte) {
	s.lastOutput = time.Now()
	s.outputBuf = append(s.outputBuf, data...)
	s.outputCursor += uint64(len(data))
	if s.outputLimit > 0 && len(s.outputBuf) > s.outputLimit {
		s.outputBuf = s.outputBuf[len(s.outputBuf)-s.outputLimit:]
	}
}

func (s *Session) publishOutput(data []byte) {
	s.outputMu.Lock()
	defer s.outputMu.Unlock()

	s.appendOutputLocked(data)
	for sub := range s.subscribers {
		select {
		case sub.output <- data:
		default:
			// The WebSocket writer is the only data consumer. Signal overflow
			// out of band so it can stop after any contiguous queued prefix;
			// reconnect replay then starts at a valid absolute cursor.
			delete(s.subscribers, sub)
			close(sub.overflow)
			close(sub.output)
		}
	}
}

func (s *Session) GetOutput() string {
	s.outputMu.Lock()
	defer s.outputMu.Unlock()
	return string(s.outputBuf)
}

type OutputReplay struct {
	Data   []byte
	Cursor uint64
	Reset  bool
}

type OutputSubscription struct {
	Output   <-chan []byte
	Overflow <-chan struct{}
	output   chan []byte
	overflow chan struct{}
}

// SubscribeFrom atomically attaches a subscriber and snapshots any output
// after cursor. Cursor is a byte offset in the session's output stream. If the
// requested position has fallen out of the retained buffer (or is ahead of the
// stream), Reset tells the client to clear its local terminal before replaying.
func (s *Session) SubscribeFrom(cursor uint64) (*OutputSubscription, OutputReplay) {
	output := make(chan []byte, 256)
	overflow := make(chan struct{})
	sub := &OutputSubscription{
		Output:   output,
		Overflow: overflow,
		output:   output,
		overflow: overflow,
	}
	s.outputMu.Lock()
	defer s.outputMu.Unlock()

	end := s.outputCursor
	start := end - uint64(len(s.outputBuf))
	reset := cursor < start || cursor > end
	if reset {
		cursor = start
	}
	replay := append([]byte(nil), s.outputBuf[int(cursor-start):]...)
	s.subscribers[sub] = struct{}{}
	return sub, OutputReplay{Data: replay, Cursor: cursor, Reset: reset}
}

func (s *Session) Unsubscribe(sub *OutputSubscription) {
	if sub == nil {
		return
	}
	s.outputMu.Lock()
	if _, subscribed := s.subscribers[sub]; subscribed {
		delete(s.subscribers, sub)
		close(sub.output)
	}
	s.outputMu.Unlock()
}

func (s *Session) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ptmx == nil {
		return 0, io.ErrClosedPipe
	}
	return s.ptmx.Write(p)
}

func (s *Session) Resize(cols, rows uint16) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ptmx != nil {
		pty.Setsize(s.ptmx, &pty.Winsize{
			Rows: rows,
			Cols: cols,
		})
	}
}

func (s *Session) IsAlive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.alive
}

// Pid is the pid of the login shell hosting the session, or 0 when the session
// has not started.
func (s *Session) Pid() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cmd == nil || s.cmd.Process == nil {
		return 0
	}
	return s.cmd.Process.Pid
}

func (s *Session) LastOutputAt() time.Time {
	s.outputMu.Lock()
	defer s.outputMu.Unlock()
	return s.lastOutput
}

func (s *Session) State() (alive bool, done bool, exitCode int, exitErr string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.alive, s.processDone, s.exitCode, s.exitErr
}

func (s *Session) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true

	if s.cmd != nil && s.cmd.Process != nil {
		s.cmd.Process.Signal(syscall.SIGTERM)
		go func() {
			time.Sleep(2 * time.Second)
			s.cmd.Process.Kill()
		}()
	}
	if s.ptmx != nil {
		s.ptmx.Close()
	}
}
