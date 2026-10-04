package server

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
)

const maxDockerOutput = 64 * 1024

var composeFileNames = []string{
	"compose.yaml",
	"compose.yml",
	"docker-compose.yaml",
	"docker-compose.yml",
}

// dockerManager tracks running docker compose processes per project
type dockerManager struct {
	mu         sync.RWMutex
	processes  map[string]*dockerProcess // project path → process
	operations map[string]*sync.Mutex    // project path → lifecycle lock
}

type dockerProcess struct {
	cmd     *exec.Cmd
	output  *ringBuffer
	running bool
	done    chan struct{}
	mu      sync.Mutex
}

type dockerStatus struct {
	Running     bool   `json:"running"`
	Output      string `json:"output"`
	ComposeFile string `json:"compose_file"`
}

func newDockerManager() *dockerManager {
	return &dockerManager{
		processes:  make(map[string]*dockerProcess),
		operations: make(map[string]*sync.Mutex),
	}
}

func dockerCommand(args ...string) *exec.Cmd {
	path, pathEnv, ok := lookupDockerPath()
	if !ok {
		// Keep the bare name so the failure reads as the familiar
		// "executable file not found in $PATH".
		path = "docker"
	}

	cmd := exec.Command(path, args...)
	if pathEnv != "" {
		// docker itself is resolved absolutely, but the tools it shells
		// out to — credential helpers, buildx — are not. Hand the child
		// the same PATH the binary was found in.
		cmd.Env = envWithPath(os.Environ(), pathEnv)
	}
	return cmd
}

// lookupDockerPath locates the docker binary. When the app is launched from a
// desktop environment (Finder or the Dock on macOS, a .desktop entry or
// AppImage on Linux) it inherits a minimal PATH that omits /usr/local/bin and
// shell-init additions, so exec.LookPath alone misses Docker Desktop's CLI even
// though it works in a terminal. Fall back to the login shell's PATH — the same
// environment PTY sessions run in — and report that PATH so the child inherits
// it too.
func lookupDockerPath() (path, pathEnv string, ok bool) {
	if path, err := commandPath("docker"); err == nil {
		return path, "", true
	}

	pathEnv = ptyShellEnvPath()
	if path := lookPathInPath("docker", pathEnv); path != "" {
		return path, pathEnv, true
	}
	return "", "", false
}

func dockerDependency() dependencyStatus {
	path, _, ok := lookupDockerPath()
	if !ok {
		return dependencyStatus{Available: false, Error: exec.ErrNotFound.Error()}
	}
	return dependencyStatus{Available: true, Path: path}
}

// envWithPath replaces PATH in env, leaving a single entry regardless of how
// many the incoming environment carried.
func envWithPath(env []string, pathEnv string) []string {
	result := make([]string, 0, len(env)+1)
	for _, entry := range env {
		if name, _, ok := strings.Cut(entry, "="); ok && name == "PATH" {
			continue
		}
		result = append(result, entry)
	}
	return append(result, "PATH="+pathEnv)
}

func (m *dockerManager) Start(projectPath string) error {
	operation := m.operationLock(projectPath)
	operation.Lock()
	defer operation.Unlock()

	waitForDockerProcess(m.process(projectPath))

	cmd := dockerComposeUpCommand(projectPath)

	buf := newRingBuffer(maxDockerOutput)
	cmd.Stdout = buf
	cmd.Stderr = buf

	if err := cmd.Start(); err != nil {
		return err
	}

	p := &dockerProcess{
		cmd:     cmd,
		output:  buf,
		running: true,
		done:    make(chan struct{}),
	}

	m.mu.Lock()
	m.processes[projectPath] = p
	m.mu.Unlock()

	go func() {
		cmd.Wait()
		p.mu.Lock()
		p.running = false
		p.mu.Unlock()
		close(p.done)
	}()

	return nil
}

func (m *dockerManager) Stop(projectPath string) error {
	operation := m.operationLock(projectPath)
	operation.Lock()
	defer operation.Unlock()

	p := m.process(projectPath)
	waitForDockerProcess(p)

	cmd := dockerComposeDownCommand(projectPath)
	output, err := cmd.CombinedOutput()
	if p != nil && len(output) > 0 {
		_, _ = p.output.Write(output)
	}
	if err == nil {
		return nil
	}

	if detail := strings.TrimSpace(string(output)); detail != "" {
		return fmt.Errorf("docker compose down: %w: %s", err, detail)
	}
	return fmt.Errorf("docker compose down: %w", err)
}

func (m *dockerManager) GetStatus(projectPath string) (bool, string) {
	p := m.process(projectPath)
	if p == nil {
		return dockerComposeRunning(projectPath), ""
	}

	p.mu.Lock()
	running := p.running
	output := p.output.String()
	p.mu.Unlock()

	if running {
		return true, output
	}
	return dockerComposeRunning(projectPath), output
}

func (m *dockerManager) StopAll() {
	m.mu.RLock()
	projects := make([]string, 0, len(m.processes))
	for projectPath := range m.processes {
		projects = append(projects, projectPath)
	}
	m.mu.RUnlock()

	for _, projectPath := range projects {
		_ = m.Stop(projectPath)
	}
}

func (m *dockerManager) process(projectPath string) *dockerProcess {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.processes[projectPath]
}

func (m *dockerManager) operationLock(projectPath string) *sync.Mutex {
	m.mu.Lock()
	defer m.mu.Unlock()

	operation := m.operations[projectPath]
	if operation == nil {
		operation = &sync.Mutex{}
		m.operations[projectPath] = operation
	}
	return operation
}

func waitForDockerProcess(p *dockerProcess) {
	if p == nil {
		return
	}

	p.mu.Lock()
	if !p.running || p.cmd == nil || p.cmd.Process == nil {
		p.mu.Unlock()
		return
	}
	done := p.done
	_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGTERM)
	p.mu.Unlock()

	<-done
}

func dockerComposeUpCommand(projectPath string) *exec.Cmd {
	cmd := dockerCommand("compose", "up")
	cmd.Dir = projectPath
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return cmd
}

func dockerComposeDownCommand(projectPath string) *exec.Cmd {
	cmd := dockerCommand("compose", "down")
	cmd.Dir = projectPath
	return cmd
}

func dockerComposeRunning(projectPath string) bool {
	cmd := dockerCommand("compose", "ps", "--status", "running", "--quiet")
	cmd.Dir = projectPath
	output, err := cmd.Output()
	return err == nil && len(bytes.TrimSpace(output)) > 0
}

// resolveDockerProjects finds repositories that own a standard Compose file.
func resolveDockerProjects(projects []projectDockerInfo) map[string]string {
	result := make(map[string]string)

	for _, project := range projects {
		if composeFile := projectComposeFile(project.Path); composeFile != "" {
			result[project.Name] = composeFile
		}
	}

	return result
}

type projectDockerInfo struct {
	Name string
	Path string
}

func projectComposeFile(projectPath string) string {
	for _, name := range composeFileNames {
		info, err := os.Stat(filepath.Join(projectPath, name))
		if err == nil && info.Mode().IsRegular() {
			return name
		}
	}
	return ""
}

// ringBuffer keeps the last N bytes of output
type ringBuffer struct {
	buf  []byte
	size int
	mu   sync.Mutex
}

func newRingBuffer(size int) *ringBuffer {
	return &ringBuffer{size: size}
}

func (r *ringBuffer) Write(p []byte) (n int, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buf = append(r.buf, p...)
	if len(r.buf) > r.size {
		r.buf = r.buf[len(r.buf)-r.size:]
	}
	return len(p), nil
}

func (r *ringBuffer) String() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return string(r.buf)
}
