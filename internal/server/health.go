package server

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"agentdeck/internal/config"
)

const (
	shellEnvTimeout = 10 * time.Second
	// shellEnvRetryAfter bounds how often a failing probe is retried. Docker
	// status polls every few seconds, so without it a shell that hangs until
	// shellEnvTimeout would cost a full timeout on every poll.
	shellEnvRetryAfter = 30 * time.Second
)

type dependencyStatus struct {
	Available bool   `json:"available"`
	Path      string `json:"path,omitempty"`
	Error     string `json:"error,omitempty"`
}

type scanPathStatus struct {
	Path   string `json:"path"`
	Exists bool   `json:"exists"`
}

type capabilitiesResponse struct {
	ScanPaths    []scanPathStatus            `json:"scan_paths"`
	Dependencies map[string]dependencyStatus `json:"dependencies"`
}

func commandPath(name string) (string, error) {
	return exec.LookPath(name)
}

func ptyCommandStatuses(names ...string) map[string]dependencyStatus {
	statuses := make(map[string]dependencyStatus, len(names))
	missing := make([]string, 0, len(names))
	lookPathErrors := make(map[string]error, len(names))

	// First try the app process's own PATH. When the app is launched from a
	// terminal this already includes everything.
	for _, name := range names {
		if _, ok := statuses[name]; ok {
			continue
		}
		path, err := exec.LookPath(name)
		if err == nil {
			statuses[name] = dependencyStatus{Available: true, Path: path}
			continue
		}
		missing = append(missing, name)
		lookPathErrors[name] = err
	}

	// When launched from a desktop environment (e.g. an AppImage), the app
	// inherits a minimal PATH that omits shell-init additions like nvm,
	// asdf, or ~/.local/bin. PTY sessions resolve commands through a
	// login+interactive shell, so they find these tools while LookPath does
	// not. Mirror that here so detection matches what actually launches.
	for name, path := range ptyShellLookPaths(missing...) {
		statuses[name] = dependencyStatus{Available: true, Path: path}
	}

	for _, name := range missing {
		if _, ok := statuses[name]; ok {
			continue
		}
		statuses[name] = dependencyStatus{Available: false, Error: lookPathErrors[name].Error()}
	}

	return statuses
}

// ptyShellLookPath resolves a command through the user's login+interactive shell,
// matching the environment PTY sessions run in. Returns "" if not found.
func ptyShellLookPath(name string) string {
	return ptyShellLookPaths(name)[name]
}

func ptyShellLookPaths(names ...string) map[string]string {
	paths := make(map[string]string, len(names))
	if len(names) == 0 {
		return paths
	}

	pathEnv := ptyShellEnvPath()
	if pathEnv == "" {
		return paths
	}

	for _, name := range names {
		if _, ok := paths[name]; ok {
			continue
		}
		if path := lookPathInPath(name, pathEnv); path != "" {
			paths[name] = path
		}
	}
	return paths
}

// shellEnvPathCache memoizes the login-shell PATH probe. Probing spawns a
// login+interactive shell, which is far too slow to repeat on every Docker
// status poll. A success is cached for the process lifetime; a failure is only
// cached until shellEnvRetryAfter elapses, so a transient shell failure does
// not permanently disable fallback resolution while a persistent one (a shell
// that hangs until shellEnvTimeout) costs one probe per retry window instead
// of one per poll.
//
// The lock is held across the probe deliberately: callers that arrive mid-probe
// wait once and then read the cached result, rather than each spawning a shell
// of their own.
var shellEnvPathCache struct {
	sync.Mutex
	value   string
	probed  bool
	retryAt time.Time
}

// shellEnvNow reads the clock used for the failed-probe retry window. It is a
// variable so tests can move past the window without sleeping.
var shellEnvNow = time.Now

func ptyShellEnvPath() string {
	shellEnvPathCache.Lock()
	defer shellEnvPathCache.Unlock()

	if shellEnvPathCache.probed {
		return shellEnvPathCache.value
	}
	if shellEnvNow().Before(shellEnvPathCache.retryAt) {
		return ""
	}

	pathEnv := probeShellEnvPath()
	if pathEnv == "" {
		shellEnvPathCache.retryAt = shellEnvNow().Add(shellEnvRetryAfter)
		return ""
	}

	shellEnvPathCache.value = pathEnv
	shellEnvPathCache.probed = true
	return pathEnv
}

func probeShellEnvPath() string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "bash"
	}

	ctx, cancel := context.WithTimeout(context.Background(), shellEnvTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, shell, "-l", "-i", "-c", "env")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}

	pathEnv := ""
	for _, line := range strings.Split(string(out), "\n") {
		key, value, ok := strings.Cut(strings.TrimRight(line, "\r"), "=")
		if ok && key == "PATH" {
			pathEnv = value
		}
	}
	return pathEnv
}

func lookPathInPath(name, pathEnv string) string {
	for _, dir := range filepath.SplitList(pathEnv) {
		if dir == "" {
			continue
		}
		path := filepath.Join(dir, name)
		if !filepath.IsAbs(path) {
			continue
		}
		if isExecutableFile(path) {
			return path
		}
	}
	return ""
}

func isExecutableFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Mode().Perm()&0111 != 0
}

func statusFromPath(path string, err error) dependencyStatus {
	if err == nil && path != "" {
		return dependencyStatus{Available: true, Path: path}
	}
	if err != nil {
		return dependencyStatus{Available: false, Error: err.Error()}
	}
	return dependencyStatus{Available: false, Error: exec.ErrNotFound.Error()}
}

func integrationCheckCommand(integration config.CLIIntegration) string {
	if command := strings.TrimSpace(integration.CheckCommand); command != "" {
		return command
	}
	return firstCommandWord(integration.Command)
}

func firstCommandWord(command string) string {
	for _, field := range strings.Fields(command) {
		field = strings.Trim(field, `"'`)
		if field == "" || field == "env" || strings.Contains(field, "=") {
			continue
		}
		return field
	}
	return ""
}

func (a *apiHandler) handleCapabilities(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	scanPaths := append([]string(nil), a.cfg.ScanPaths...)
	cliIntegrations := cloneCLIIntegrations(a.cfg.CLIIntegrations)
	a.mu.RUnlock()

	resp := capabilitiesResponse{
		ScanPaths: make([]scanPathStatus, 0, len(scanPaths)),
	}

	commands := []string{"claude", "cursor-agent", "codex", "gemini", "opencode", "kimi"}
	customChecks := make(map[string]string, len(cliIntegrations))
	for _, integration := range cliIntegrations {
		id := strings.TrimSpace(integration.ID)
		if id == "" {
			continue
		}
		command := integrationCheckCommand(integration)
		if command == "" {
			customChecks[id] = ""
			continue
		}
		customChecks[id] = command
		commands = append(commands, command)
	}

	ptyDependencies := ptyCommandStatuses(commands...)
	resp.Dependencies = map[string]dependencyStatus{
		"claude":   ptyDependencies["claude"],
		"cursor":   ptyDependencies["cursor-agent"],
		"openai":   ptyDependencies["codex"],
		"gemini":   ptyDependencies["gemini"],
		"opencode": ptyDependencies["opencode"],
		"kimi":     ptyDependencies["kimi"],
		"gh":       statusFromPath(a.githubRuntime().executablePath()),
		"glab":     statusFromPath(a.gitlabRuntime().executablePath()),
		"docker":   dockerDependency(),
	}
	for id, command := range customChecks {
		if command == "" {
			resp.Dependencies[id] = dependencyStatus{Available: false, Error: "command required"}
			continue
		}
		resp.Dependencies[id] = ptyDependencies[command]
	}

	for _, path := range scanPaths {
		status := scanPathStatus{Path: path}
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			status.Exists = true
		}
		resp.ScanPaths = append(resp.ScanPaths, status)
	}

	writeJSON(w, resp)
}
