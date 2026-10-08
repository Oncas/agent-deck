package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"agentdeck/internal/config"
)

func TestPTYCommandStatusFindsCommandThroughInteractiveShell(t *testing.T) {
	const toolName = "definitely-not-on-path-agentdeck-test"

	resetShellEnvPathCache(t)

	toolDir := t.TempDir()
	toolPath := writeExecutableAt(t, toolDir, toolName, "#!/bin/sh\n")
	shellPath := writeExecutable(t, "shell", "#!/bin/sh\nprintf 'shell startup noise\\nPATH=%s\\n' \"$SHELL_PATH\"\n")

	t.Setenv("PATH", t.TempDir())
	t.Setenv("SHELL", shellPath)
	t.Setenv("SHELL_PATH", toolDir)

	got := ptyCommandStatuses(toolName)[toolName]
	if !got.Available {
		t.Fatalf("ptyCommandStatuses reported unavailable: %+v", got)
	}
	if got.Path != toolPath {
		t.Fatalf("ptyCommandStatuses path = %q, want %q", got.Path, toolPath)
	}
}

func TestPTYCommandStatusesBatchesInteractiveShellFallback(t *testing.T) {
	resetShellEnvPathCache(t)

	firstDir := t.TempDir()
	secondDir := t.TempDir()
	firstPath := writeExecutableAt(t, firstDir, "missing-first", "#!/bin/sh\n")
	secondPath := writeExecutableAt(t, secondDir, "missing-second", "#!/bin/sh\n")
	countPath := filepath.Join(t.TempDir(), "count")
	shellPath := writeExecutable(t, "shell", strings.Join([]string{
		"#!/bin/sh",
		"printf x >> \"$SHELL_COUNT_PATH\"",
		"printf 'PATH=%s\\n' \"$SHELL_PATH\"",
		"",
	}, "\n"))

	t.Setenv("PATH", t.TempDir())
	t.Setenv("SHELL", shellPath)
	t.Setenv("SHELL_COUNT_PATH", countPath)
	t.Setenv("SHELL_PATH", firstDir+string(os.PathListSeparator)+secondDir)

	got := ptyCommandStatuses("missing-first", "missing-second")
	if got["missing-first"].Path != firstPath {
		t.Fatalf("missing-first path = %q, want %q", got["missing-first"].Path, firstPath)
	}
	if got["missing-second"].Path != secondPath {
		t.Fatalf("missing-second path = %q, want %q", got["missing-second"].Path, secondPath)
	}

	count, err := os.ReadFile(countPath)
	if err != nil {
		t.Fatalf("read shell count: %v", err)
	}
	if string(count) != "x" {
		t.Fatalf("shell fallback count = %q, want one invocation", count)
	}
}

func TestHandleCapabilitiesUsesGithubDirectResolver(t *testing.T) {
	resetShellEnvPathCache(t)

	home := t.TempDir()
	ghPath := writeExecutableAt(t, filepath.Join(home, ".local", "bin"), "gh", "#!/bin/sh\n")
	shellDir := t.TempDir()
	writeExecutableAt(t, shellDir, "gh", "#!/bin/sh\n")
	shellPath := writeExecutable(t, "shell", "#!/bin/sh\nprintf 'PATH=%s\\n' \"$SHELL_PATH\"\n")

	t.Setenv("PATH", t.TempDir())
	t.Setenv("SHELL", shellPath)
	t.Setenv("SHELL_PATH", shellDir)

	api := &apiHandler{
		cfg: &config.Config{},
		githubCLI: &forgeCLI{forge: githubForge,
			lookPath: func(name string) (string, error) {
				if name == ghPath {
					return ghPath, nil
				}
				return "", exec.ErrNotFound
			},
			userHomeDir: func() (string, error) {
				return home, nil
			},
		},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/capabilities", nil)
	api.handleCapabilities(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/capabilities status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var resp capabilitiesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got := resp.Dependencies["gh"].Path; got != ghPath {
		t.Fatalf("gh capability path = %q, want direct resolver path %q", got, ghPath)
	}
}

func TestHandleCapabilitiesIncludesCustomCLIIntegrations(t *testing.T) {
	toolDir := t.TempDir()
	headroomPath := writeExecutableAt(t, toolDir, "headroom", "#!/bin/sh\n")
	customPath := writeExecutableAt(t, toolDir, "custom-ai", "#!/bin/sh\n")
	t.Setenv("PATH", toolDir)

	api := &apiHandler{
		cfg: &config.Config{
			CLIIntegrations: []config.CLIIntegration{
				{
					ID:           "headroom-codex",
					Name:         "Headroom Codex",
					Command:      "headroom codex",
					CheckCommand: "headroom",
				},
				{
					ID:           "custom-ai",
					Name:         "Custom AI",
					Command:      "env TOKEN=1 custom-ai --wrapped",
					CheckCommand: "custom-ai",
				},
			},
		},
		githubCLI: &forgeCLI{forge: githubForge,
			lookPath:    func(string) (string, error) { return "", exec.ErrNotFound },
			userHomeDir: func() (string, error) { return t.TempDir(), nil },
		},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/capabilities", nil)
	api.handleCapabilities(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/capabilities status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var resp capabilitiesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := resp.Dependencies["headroom"]; ok {
		t.Fatalf("headroom should not be exposed as a built-in dependency")
	}
	if got := resp.Dependencies["headroom-codex"].Path; got != headroomPath {
		t.Fatalf("headroom custom integration path = %q, want %q", got, headroomPath)
	}
	if got := resp.Dependencies["custom-ai"].Path; got != customPath {
		t.Fatalf("custom capability path = %q, want %q", got, customPath)
	}
}

func TestHandleCapabilitiesReportsEveryScanPath(t *testing.T) {
	existing := t.TempDir()
	missing := filepath.Join(t.TempDir(), "missing")
	api := &apiHandler{
		cfg: &config.Config{ScanPaths: []string{existing, missing}},
		githubCLI: &forgeCLI{forge: githubForge,
			lookPath:    func(string) (string, error) { return "", exec.ErrNotFound },
			userHomeDir: func() (string, error) { return t.TempDir(), nil },
		},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/capabilities", nil)
	api.handleCapabilities(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/capabilities status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var resp capabilitiesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.ScanPaths) != 2 {
		t.Fatalf("scan_paths = %#v, want two statuses", resp.ScanPaths)
	}
	if resp.ScanPaths[0].Path != existing || !resp.ScanPaths[0].Exists {
		t.Fatalf("first scan path = %#v, want existing", resp.ScanPaths[0])
	}
	if resp.ScanPaths[1].Path != missing || resp.ScanPaths[1].Exists {
		t.Fatalf("second scan path = %#v, want missing", resp.ScanPaths[1])
	}
}

func TestPTYShellLookPathRejectsNonExecutableShellOutput(t *testing.T) {
	const toolName = "tool"

	resetShellEnvPathCache(t)

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, toolName), []byte("#!/bin/sh\n"), 0644); err != nil {
		t.Fatalf("write non-executable: %v", err)
	}
	shellPath := writeExecutable(t, "shell", "#!/bin/sh\nprintf 'tool is a shell builtin\\nPATH=%s\\n' \"$SHELL_PATH\"\n")

	t.Setenv("SHELL", shellPath)
	t.Setenv("SHELL_PATH", dir)

	if got := ptyShellLookPath(toolName); got != "" {
		t.Fatalf("ptyShellLookPath = %q, want empty", got)
	}
}

func TestPTYShellEnvPathCachesFailedProbe(t *testing.T) {
	resetShellEnvPathCache(t)

	dir := t.TempDir()
	probes := filepath.Join(dir, "probes")
	// A shell that prints no PATH is a failed probe, without the wait a
	// genuinely hanging shell would cost.
	shellPath := writeExecutableAt(t, dir, "shell", "#!/bin/sh\nprintf 'x' >> \"$PROBE_LOG\"\n")

	t.Setenv("SHELL", shellPath)
	t.Setenv("PROBE_LOG", probes)

	if got := ptyShellEnvPath(); got != "" {
		t.Fatalf("first probe = %q, want empty", got)
	}
	if got := countProbes(t, probes); got != 1 {
		t.Fatalf("probes after first call = %d, want 1", got)
	}

	if got := ptyShellEnvPath(); got != "" {
		t.Fatalf("second probe = %q, want empty", got)
	}
	if got := countProbes(t, probes); got != 1 {
		t.Fatalf("failed probe re-ran inside the retry window: %d probes, want 1", got)
	}

	// Past the window the probe runs again, so a transient shell failure does
	// not permanently disable fallback resolution.
	setShellEnvClock(t, time.Now().Add(shellEnvRetryAfter+time.Second))

	if got := ptyShellEnvPath(); got != "" {
		t.Fatalf("third probe = %q, want empty", got)
	}
	if got := countProbes(t, probes); got != 2 {
		t.Fatalf("probes after the retry window = %d, want 2", got)
	}
}

func countProbes(t *testing.T, path string) int {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0
		}
		t.Fatalf("read probe log: %v", err)
	}
	return len(data)
}

// setShellEnvClock pins the clock the failed-probe retry window is measured
// against, restoring the real one afterwards.
func setShellEnvClock(t *testing.T, now time.Time) {
	t.Helper()

	original := shellEnvNow
	shellEnvNow = func() time.Time { return now }
	t.Cleanup(func() { shellEnvNow = original })
}

// resetShellEnvPathCache clears the memoized login-shell PATH so a test can
// control what the fallback resolver sees, and clears it again afterwards so
// the fake PATH never leaks into another test.
func resetShellEnvPathCache(t *testing.T) {
	t.Helper()

	clear := func() {
		shellEnvPathCache.Lock()
		shellEnvPathCache.value = ""
		shellEnvPathCache.probed = false
		shellEnvPathCache.retryAt = time.Time{}
		shellEnvPathCache.Unlock()
	}

	clear()
	t.Cleanup(clear)
}

func writeExecutable(t *testing.T, name, content string) string {
	t.Helper()

	return writeExecutableAt(t, t.TempDir(), name, content)
}

func writeExecutableAt(t *testing.T, dir, name, content string) string {
	t.Helper()

	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("mkdir executable dir: %v", err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0755); err != nil {
		t.Fatalf("write executable: %v", err)
	}
	return path
}
