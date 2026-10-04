package pty

import (
	"bufio"
	"encoding/json"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Agent states normalized from Claude Code session records and Codex rollout
// lifecycle events.
const (
	StateUnknown   = "unknown"
	StateIdle      = "idle"
	StateCompleted = "completed"
	StateShell     = "shell"
	StateWaiting   = "waiting"
	StateBusy      = "busy"
)

type SessionStatus struct {
	State         string `json:"state"`
	WaitingFor    string `json:"waiting_for,omitempty"`
	RemoteControl bool   `json:"remote_control,omitempty"`
	Provider      string `json:"provider,omitempty"`
	SessionID     string `json:"session_id,omitempty"`
	AgentName     string `json:"agent_name,omitempty"`
}

func (s SessionStatus) Working() bool {
	return s.State == StateBusy || s.State == StateShell
}

// Active reports whether the session is doing something, or wants something,
// that should keep the machine awake.
func (s SessionStatus) Active() bool {
	return s.Working() || s.State == StateWaiting || s.RemoteControl
}

type agentSessionFile struct {
	Pid             int    `json:"pid"`
	Status          string `json:"status"`
	StartedAt       int64  `json:"startedAt"`
	StatusUpdatedAt int64  `json:"statusUpdatedAt"`
	WaitingFor      string `json:"waitingFor"`
	BridgeSessionID string `json:"bridgeSessionId"`
	SessionID       string `json:"sessionId"`
	Name            string `json:"name"`
}

type codexRolloutEvent struct {
	Type    string `json:"type"`
	Payload struct {
		Type      string `json:"type"`
		ID        string `json:"id"`
		SessionID string `json:"session_id"`
	} `json:"payload"`
}

type codexRolloutCursor struct {
	offset int64
	status SessionStatus
}

var pidFileName = regexp.MustCompile(`^\d+\.json$`)

// statePriority orders states from least to most notable so that a session with
// several agent processes underneath it reports the most notable one.
var statePriority = map[string]int{
	StateUnknown:   0,
	StateIdle:      1,
	StateCompleted: 2,
	StateShell:     3,
	StateWaiting:   4,
	StateBusy:      5,
}

// attentionPriority rolls several sessions into one indicator. Waiting outranks
// busy here, unlike statePriority: a blocked pane needs the user, a busy one
// clears on its own.
var attentionPriority = map[string]int{
	StateUnknown:   0,
	StateIdle:      1,
	StateCompleted: 2,
	StateShell:     3,
	StateBusy:      4,
	StateWaiting:   5,
}

func AgentSessionsDir() string {
	if dir := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR")); dir != "" {
		return filepath.Join(dir, "sessions")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".claude", "sessions")
}

// opencodeBusyWindow is how long after the last byte of terminal output an
// opencode session still counts as working. Streaming output arrives in bursts
// well under this; an idle TUI emits nothing at all.
const opencodeBusyWindow = 5 * time.Second

type StatusProbe struct {
	dir            string
	sessions       func() map[string]int
	activity       func() map[string]sessionActivity
	ps             func() (string, error)
	codexRollouts  func(int) []string
	rolloutCursors map[string]*codexRolloutCursor

	refreshMu sync.Mutex
	mu        sync.RWMutex
	statuses  map[string]SessionStatus
	warned    map[string]struct{}
}

func NewStatusProbe(dir string, sessions func() map[string]int) *StatusProbe {
	return &StatusProbe{
		dir:            dir,
		sessions:       sessions,
		ps:             processTableOutput,
		codexRollouts:  openCodexRolloutFiles,
		rolloutCursors: make(map[string]*codexRolloutCursor),
		statuses:       make(map[string]SessionStatus),
		warned:         make(map[string]struct{}),
	}
}

func (p *StatusProbe) Start(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			p.Refresh()
			<-ticker.C
		}
	}()
}

func (p *StatusProbe) Status(name string) SessionStatus {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if status, ok := p.statuses[name]; ok {
		return status
	}
	return SessionStatus{State: StateUnknown}
}

func (p *StatusProbe) Statuses() map[string]SessionStatus {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make(map[string]SessionStatus, len(p.statuses))
	for name, status := range p.statuses {
		out[name] = status
	}
	return out
}

func (p *StatusProbe) Refresh() {
	p.refreshMu.Lock()
	defer p.refreshMu.Unlock()

	pids := p.sessions()
	if len(pids) == 0 {
		p.store(nil)
		return
	}

	files := p.readSessionFiles()
	output, err := p.ps()
	if err != nil {
		p.store(nil)
		return
	}
	parents := parseProcessTable(output)
	commands := parseProcessCommands(output)
	previous := p.Statuses()

	statuses := make(map[string]SessionStatus, len(pids))
	for name, pid := range pids {
		if status, ok := resolveSessionStatus(files, parents, pid); ok {
			status = preserveCompletedState(status, previous[name])
			statuses[name] = status
			continue
		}
		if status, ok := p.resolveCodexSessionStatus(commands, parents, pid); ok {
			statuses[name] = status
			continue
		}
		if p.activity == nil {
			continue
		}
		if status, ok := resolveOpencodeSessionStatus(p.activity(), name, time.Now()); ok {
			statuses[name] = status
		}
	}
	p.store(statuses)
}

func preserveCompletedState(status, previous SessionStatus) SessionStatus {
	if status.Provider != "claude" || status.State != StateIdle ||
		previous.Provider != status.Provider || status.SessionID == "" ||
		previous.SessionID != status.SessionID {
		return status
	}
	if previous.Working() || previous.State == StateWaiting || previous.State == StateCompleted {
		status.State = StateCompleted
	}
	return status
}

func (p *StatusProbe) store(statuses map[string]SessionStatus) {
	p.mu.Lock()
	if statuses == nil {
		statuses = make(map[string]SessionStatus)
	}
	p.statuses = statuses
	p.mu.Unlock()
}

func (p *StatusProbe) readSessionFiles() []agentSessionFile {
	if p.dir == "" {
		return nil
	}
	entries, err := os.ReadDir(p.dir)
	if err != nil {
		return nil
	}
	files := make([]agentSessionFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !pidFileName.MatchString(entry.Name()) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(p.dir, entry.Name()))
		if err != nil {
			continue
		}
		var file agentSessionFile
		if err := json.Unmarshal(data, &file); err != nil {
			continue
		}
		if file.Pid <= 0 {
			continue
		}
		file.Status = p.normalizeState(file.Status)
		files = append(files, file)
	}
	return files
}

func (p *StatusProbe) normalizeState(raw string) string {
	switch raw {
	case StateIdle, StateCompleted, StateShell, StateWaiting, StateBusy:
		return raw
	}
	p.warnUnknownState(raw)
	return StateUnknown
}

func (p *StatusProbe) warnUnknownState(raw string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, seen := p.warned[raw]; seen {
		return
	}
	p.warned[raw] = struct{}{}
	log.Printf("pty: unrecognized agent session status %q", raw)
}

// resolveSessionStatus picks the status of the most notable agent process
// running underneath shellPid. Session files whose pid is absent from the
// process table belong to exited processes and are ignored.
func resolveSessionStatus(files []agentSessionFile, parents map[int]int, shellPid int) (SessionStatus, bool) {
	var best SessionStatus
	found := false
	for _, file := range files {
		if _, alive := parents[file.Pid]; !alive {
			continue
		}
		if !isDescendantOf(parents, file.Pid, shellPid) {
			continue
		}
		candidate := SessionStatus{
			State:         file.Status,
			RemoteControl: strings.TrimSpace(file.BridgeSessionID) != "",
			Provider:      "claude",
			SessionID:     strings.TrimSpace(file.SessionID),
			AgentName:     strings.TrimSpace(file.Name),
		}
		if candidate.State == StateIdle && file.StartedAt > 0 && file.StatusUpdatedAt > file.StartedAt {
			candidate.State = StateCompleted
		}
		if candidate.State == StateWaiting {
			candidate.WaitingFor = strings.TrimSpace(file.WaitingFor)
		}
		if !found {
			best = candidate
			found = true
			continue
		}
		remoteControl := best.RemoteControl || candidate.RemoteControl
		if statePriority[candidate.State] > statePriority[best.State] {
			best = candidate
		}
		best.RemoteControl = remoteControl
	}
	return best, found
}

func (p *StatusProbe) resolveCodexSessionStatus(commands map[int]string, parents map[int]int, shellPID int) (SessionStatus, bool) {
	var best SessionStatus
	found := false
	for pid, command := range commands {
		if !isCodexProcess(command) || !isDescendantOf(parents, pid, shellPID) {
			continue
		}
		status, ok := p.statusForCodexProcess(pid)
		if !ok {
			continue
		}
		if !found || statePriority[status.State] > statePriority[best.State] {
			best = status
			found = true
		}
	}
	return best, found
}

// resolveOpencodeSessionStatus infers work from terminal output, because
// opencode publishes no per-session state file. Its TUI is silent while idle,
// so recent bytes mean the agent is producing something.
func resolveOpencodeSessionStatus(activity map[string]sessionActivity, name string, now time.Time) (SessionStatus, bool) {
	entry, ok := activity[name]
	if !ok || entry.CLI != "opencode" {
		return SessionStatus{}, false
	}

	status := SessionStatus{State: StateIdle, Provider: "opencode"}
	if !entry.LastOutput.IsZero() && now.Sub(entry.LastOutput) <= opencodeBusyWindow {
		status.State = StateBusy
	}
	return status, true
}

func isCodexProcess(command string) bool {
	return filepath.Base(strings.TrimSpace(command)) == "codex"
}

func (p *StatusProbe) statusForCodexProcess(pid int) (SessionStatus, bool) {
	if p.codexRollouts == nil {
		return SessionStatus{}, false
	}
	paths := p.codexRollouts(pid)
	var newestPath string
	var newestMod time.Time
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			continue
		}
		if newestPath == "" || info.ModTime().After(newestMod) || (info.ModTime().Equal(newestMod) && path > newestPath) {
			newestPath = path
			newestMod = info.ModTime()
		}
	}
	if newestPath == "" {
		return SessionStatus{}, false
	}
	return p.readCodexRollout(newestPath)
}

func (p *StatusProbe) readCodexRollout(path string) (SessionStatus, bool) {
	if p.rolloutCursors == nil {
		p.rolloutCursors = make(map[string]*codexRolloutCursor)
	}
	cursor := p.rolloutCursors[path]
	if cursor == nil {
		cursor = &codexRolloutCursor{status: SessionStatus{State: StateUnknown, Provider: "openai"}}
		p.rolloutCursors[path] = cursor
	}

	info, err := os.Stat(path)
	if err != nil {
		return SessionStatus{}, false
	}
	if info.Size() < cursor.offset {
		cursor.offset = 0
		cursor.status = SessionStatus{State: StateUnknown, Provider: "openai"}
	}
	if info.Size() == cursor.offset {
		return cursor.status, true
	}

	f, err := os.Open(path)
	if err != nil {
		return SessionStatus{}, false
	}
	defer f.Close()
	if _, err := f.Seek(cursor.offset, io.SeekStart); err != nil {
		return SessionStatus{}, false
	}

	reader := bufio.NewReader(f)
	for {
		line, readErr := reader.ReadBytes('\n')
		if len(line) > 0 {
			var event codexRolloutEvent
			if err := json.Unmarshal(line, &event); err == nil {
				cursor.offset += int64(len(line))
				applyCodexRolloutEvent(&cursor.status, event)
			} else if readErr == nil {
				// A malformed complete record must not pin the cursor forever.
				cursor.offset += int64(len(line))
			}
		}
		if readErr != nil {
			break
		}
	}
	return cursor.status, true
}

func applyCodexRolloutEvent(status *SessionStatus, event codexRolloutEvent) {
	status.Provider = "openai"
	if event.Type == "session_meta" {
		status.SessionID = strings.TrimSpace(event.Payload.SessionID)
		if status.SessionID == "" {
			status.SessionID = strings.TrimSpace(event.Payload.ID)
		}
		if status.State == "" || status.State == StateUnknown {
			status.State = StateIdle
		}
		return
	}

	eventType := event.Payload.Type
	if eventType == "" {
		eventType = event.Type
	}
	switch eventType {
	case "task_started", "turn_started":
		status.State = StateBusy
		status.WaitingFor = ""
	case "task_complete", "turn_complete":
		status.State = StateCompleted
		status.WaitingFor = ""
	case "turn_aborted":
		status.State = StateIdle
		status.WaitingFor = ""
	case "exec_approval_request", "apply_patch_approval_request":
		status.State = StateWaiting
		status.WaitingFor = "approval"
	case "request_user_input", "elicitation_request", "dynamic_tool_call_request":
		status.State = StateWaiting
		status.WaitingFor = "answer"
	case "exec_command_begin", "patch_apply_begin", "mcp_tool_call_begin", "web_search_begin",
		"dynamic_tool_call_response", "terminal_interaction":
		status.State = StateBusy
		status.WaitingFor = ""
	}
}

func isDescendantOf(parents map[int]int, pid, ancestor int) bool {
	if pid == ancestor {
		return true
	}
	// Bounded to guard against a cycle in malformed process table output.
	for i := 0; i < 64; i++ {
		parent, ok := parents[pid]
		if !ok || parent <= 1 {
			return false
		}
		if parent == ancestor {
			return true
		}
		pid = parent
	}
	return false
}

func parseProcessTable(output string) map[int]int {
	parents := make(map[int]int)
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		ppid, err := strconv.Atoi(fields[1])
		if err != nil {
			continue
		}
		parents[pid] = ppid
	}
	return parents
}

func parseProcessCommands(output string) map[int]string {
	commands := make(map[int]string)
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		commands[pid] = fields[2]
	}
	return commands
}

func processTableOutput() (string, error) {
	out, err := exec.Command("ps", "-eo", "pid,ppid,comm").Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func openCodexRolloutFiles(pid int) []string {
	if runtime.GOOS == "linux" {
		if paths := procOpenCodexRollouts(pid); len(paths) > 0 {
			return paths
		}
	}
	return lsofOpenCodexRollouts(pid)
}

func procOpenCodexRollouts(pid int) []string {
	dir := filepath.Join("/proc", strconv.Itoa(pid), "fd")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	paths := make([]string, 0, 2)
	for _, entry := range entries {
		path, err := os.Readlink(filepath.Join(dir, entry.Name()))
		if err == nil && isCodexRolloutPath(path) {
			paths = append(paths, path)
		}
	}
	return paths
}

func lsofOpenCodexRollouts(pid int) []string {
	out, err := exec.Command("lsof", "-Fn", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return nil
	}
	paths := make([]string, 0, 2)
	for _, line := range strings.Split(string(out), "\n") {
		if len(line) > 1 && line[0] == 'n' && isCodexRolloutPath(line[1:]) {
			paths = append(paths, line[1:])
		}
	}
	return paths
}

func isCodexRolloutPath(path string) bool {
	clean := filepath.ToSlash(strings.TrimSpace(path))
	base := filepath.Base(clean)
	return strings.Contains(clean, "/sessions/") && strings.HasPrefix(base, "rollout-") && strings.HasSuffix(base, ".jsonl")
}

// SortedNames returns status map keys in a stable order.
func SortedNames(statuses map[string]SessionStatus) []string {
	names := make([]string, 0, len(statuses))
	for name := range statuses {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
