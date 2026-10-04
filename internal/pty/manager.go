package pty

import (
	"strings"
	"sync"
	"time"
)

type Manager struct {
	sessions             map[string]*Session
	cli                  string
	startupGitPullFFOnly bool
	dangerousPermissions map[string]bool
	cliIntegrations      map[string]CLIIntegration
	statusProbe          *StatusProbe
	mu                   sync.Mutex
}

func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

func (m *Manager) SetCLI(cli string) {
	m.mu.Lock()
	m.cli = cli
	m.mu.Unlock()
}

func (m *Manager) SetCLIIntegrations(integrations []CLIIntegration) {
	m.mu.Lock()
	m.cliIntegrations = cliIntegrationMap(integrations)
	m.mu.Unlock()
}

func (m *Manager) SetDangerousPermissions(flags map[string]bool) {
	m.mu.Lock()
	m.dangerousPermissions = cloneDangerousPermissions(flags)
	m.mu.Unlock()
}

func (m *Manager) SetStartupGitPullFFOnly(enabled bool) {
	m.mu.Lock()
	m.startupGitPullFFOnly = enabled
	m.mu.Unlock()
}

func (m *Manager) DefaultCLI() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.cli
}

func (m *Manager) GetOrCreate(name, path string, cols, rows uint16, cliOverride string) (*Session, error) {
	return m.GetOrCreateWithOptions(name, path, cols, rows, cliOverride, StartOptions{})
}

func (m *Manager) GetOrCreateWithOptions(name, path string, cols, rows uint16, cliOverride string, options StartOptions) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s := m.liveSessionLocked(name); s != nil {
		return s, nil
	}

	s := NewSession(name, path)
	cli := cliOverride
	if cli == "" {
		cli = m.cli
	}
	integrations := cloneCLIIntegrations(m.cliIntegrations)
	cli = NormalizeCLI(cli, integrations)
	options.StartupGitPullFFOnly = m.startupGitPullFFOnly
	options.CLIIntegrations = integrations
	dangerous := m.dangerousPermissions[cli]
	s.setCLI(cli)
	if err := s.StartWithOptions(cols, rows, cli, dangerous, options); err != nil {
		return nil, err
	}
	m.sessions[name] = s
	return s, nil
}

type sessionActivity struct {
	CLI        string
	LastOutput time.Time
}

// sessionActivity reports the CLI and most recent output time of every live
// session, so the status probe can infer work from a quiet or noisy terminal.
func (m *Manager) sessionActivity() map[string]sessionActivity {
	m.mu.Lock()
	defer m.mu.Unlock()

	activity := make(map[string]sessionActivity, len(m.sessions))
	for name, s := range m.sessions {
		alive, _, _, _ := s.State()
		if !alive {
			continue
		}
		activity[name] = sessionActivity{CLI: s.CLI(), LastOutput: s.LastOutputAt()}
	}
	return activity
}

func cloneDangerousPermissions(src map[string]bool) map[string]bool {
	if src == nil {
		return nil
	}
	dst := make(map[string]bool, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func cliIntegrationMap(src []CLIIntegration) map[string]CLIIntegration {
	if len(src) == 0 {
		return nil
	}
	dst := make(map[string]CLIIntegration, len(src))
	for _, integration := range src {
		integration.ID = strings.TrimSpace(integration.ID)
		integration.Name = strings.TrimSpace(integration.Name)
		integration.Command = strings.TrimSpace(integration.Command)
		integration.ResumeCommand = strings.TrimSpace(integration.ResumeCommand)
		integration.CheckCommand = strings.TrimSpace(integration.CheckCommand)
		if integration.ID == "" || integration.Command == "" {
			continue
		}
		dst[integration.ID] = integration
	}
	if len(dst) == 0 {
		return nil
	}
	return dst
}

func cloneCLIIntegrations(src map[string]CLIIntegration) map[string]CLIIntegration {
	if src == nil {
		return nil
	}
	dst := make(map[string]CLIIntegration, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func (m *Manager) liveSessionLocked(name string) *Session {
	s, ok := m.sessions[name]
	if !ok {
		return nil
	}
	if s.IsAlive() {
		return s
	}
	s.Close()
	delete(m.sessions, name)
	return nil
}

func (m *Manager) CreateWithCommand(name, path string, cols, rows uint16, command string) (*Session, error) {
	return m.CreateWithCommandOutputLimit(name, path, cols, rows, command, outputBufSize)
}

func (m *Manager) CreateWithCommandOutputLimit(name, path string, cols, rows uint16, command string, outputLimit int) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	old := m.sessions[name]
	s := NewSession(name, path)
	s.SetOutputLimit(outputLimit)
	if err := s.StartWithCommand(cols, rows, command); err != nil {
		return nil, err
	}
	if old != nil {
		old.Close()
	}
	m.sessions[name] = s
	return s, nil
}

func (m *Manager) Get(name string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[name]
}

func (m *Manager) Remove(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[name]; ok {
		s.Close()
		delete(m.sessions, name)
	}
}

type SessionInfo struct {
	HasSession     bool   `json:"has_session"`
	SessionAlive   bool   `json:"session_alive"`
	SessionWorking bool   `json:"session_working"`
	SessionState   string `json:"session_state,omitempty"`
	WaitingFor     string `json:"session_waiting_for,omitempty"`
	RemoteControl  bool   `json:"session_remote_control,omitempty"`
	ProcessExited  bool   `json:"process_exited"`
	ExitCode       *int   `json:"exit_code,omitempty"`
	ExitError      string `json:"exit_error,omitempty"`
}

func (m *Manager) GetSessionInfo(name string) SessionInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[name]
	if !ok {
		return SessionInfo{}
	}
	alive, done, exitCode, exitErr := s.State()
	var exitCodePtr *int
	if done {
		code := exitCode
		exitCodePtr = &code
	}
	status := SessionStatus{State: StateUnknown}
	if alive && m.statusProbe != nil {
		status = m.statusProbe.Status(name)
	}
	return SessionInfo{
		HasSession:     true,
		SessionAlive:   alive,
		SessionWorking: status.Working(),
		SessionState:   status.State,
		WaitingFor:     status.WaitingFor,
		RemoteControl:  status.RemoteControl,
		ProcessExited:  done,
		ExitCode:       exitCodePtr,
		ExitError:      exitErr,
	}
}

// Split panes live in sessions named "<key>#N", so a project indicator has to
// speak for every pane in the tab — including when the original pane is closed
// and only "#2" survives.
func (m *Manager) GetProjectSessionInfo(name string) SessionInfo {
	m.mu.Lock()
	keys := make([]string, 0, 2)
	for key := range m.sessions {
		if key == name || strings.HasPrefix(key, name+"#") {
			keys = append(keys, key)
		}
	}
	m.mu.Unlock()

	var rolled SessionInfo
	for _, key := range keys {
		info := m.GetSessionInfo(key)
		if !info.HasSession {
			continue
		}
		rolled.HasSession = true
		rolled.SessionAlive = rolled.SessionAlive || info.SessionAlive
		rolled.SessionWorking = rolled.SessionWorking || info.SessionWorking
		rolled.RemoteControl = rolled.RemoteControl || info.RemoteControl
		if rolled.SessionState == "" || attentionPriority[info.SessionState] > attentionPriority[rolled.SessionState] {
			rolled.SessionState = info.SessionState
			rolled.WaitingFor = info.WaitingFor
		}
	}
	return rolled
}

// StartStatusProbe begins polling agent session state and makes it available
// through GetSessionInfo and SessionStatuses.
func (m *Manager) StartStatusProbe(interval time.Duration) {
	probe := NewStatusProbe(AgentSessionsDir(), m.sessionPids)
	probe.activity = m.sessionActivity
	m.mu.Lock()
	m.statusProbe = probe
	m.mu.Unlock()
	probe.Start(interval)
}

func (m *Manager) SessionStatuses() map[string]SessionStatus {
	m.mu.Lock()
	probe := m.statusProbe
	m.mu.Unlock()
	if probe == nil {
		return nil
	}
	return probe.Statuses()
}

func (m *Manager) sessionPids() map[string]int {
	m.mu.Lock()
	defer m.mu.Unlock()
	pids := make(map[string]int, len(m.sessions))
	for name, s := range m.sessions {
		if !s.IsAlive() {
			continue
		}
		if pid := s.Pid(); pid > 0 {
			pids[name] = pid
		}
	}
	return pids
}

func (m *Manager) GetOutput(name string) string {
	m.mu.Lock()
	s, ok := m.sessions[name]
	m.mu.Unlock()
	if !ok {
		return ""
	}
	return s.GetOutput()
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		s.Close()
	}
}
