package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// forgeSpec names a code host's CLI and the environment it reads its login
// and host from. Everything else in the parent environment is dropped.
type forgeSpec struct {
	binary      string
	envKeys     []string
	envPrefixes []string
}

var githubForge = forgeSpec{
	binary:      "gh",
	envKeys:     []string{"GITHUB_TOKEN", "GITHUB_HOST", "GITHUB_ENTERPRISE_TOKEN"},
	envPrefixes: []string{"GH_"},
}

var gitlabForge = forgeSpec{
	binary:      "glab",
	envKeys:     []string{"OAUTH_TOKEN", "GL_HOST"},
	envPrefixes: []string{"GITLAB_", "GLAB_"},
}

// Shared by every forge CLI: where to find its config, the keyring a login may
// be stored in, and how to reach the network.
var forgeCommonEnvKeys = []string{
	"HOME",
	"PATH",
	"XDG_CONFIG_HOME",
	"XDG_CACHE_HOME",
	"XDG_STATE_HOME",
	"XDG_RUNTIME_DIR",
	"DBUS_SESSION_BUS_ADDRESS",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"ALL_PROXY",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"all_proxy",
}

// forgeActivityResponse is today's contribution count on one code host.
// PullRequests holds merge requests on GitLab.
type forgeActivityResponse struct {
	Date         string `json:"date"`
	Username     string `json:"username"`
	Total        int    `json:"total"`
	Pushes       int    `json:"pushes"`
	PullRequests int    `json:"pull_requests"`
	Issues       int    `json:"issues"`
	Comments     int    `json:"comments"`
	Other        int    `json:"other"`
}

func (r *forgeActivityResponse) count(bucket string) {
	r.Total++
	switch bucket {
	case "push":
		r.Pushes++
	case "pull_request":
		r.PullRequests++
	case "issue":
		r.Issues++
	case "comment":
		r.Comments++
	default:
		r.Other++
	}
}

type forgeCLI struct {
	forge        forgeSpec
	environ      func() []string
	lookPath     func(string) (string, error)
	userHomeDir  func() (string, error)
	runCommand   func(context.Context, string, []string, ...string) ([]byte, []byte, error)
	mu           sync.Mutex
	resolvedPath string
}

func newGithubCLI() *forgeCLI { return newForgeCLI(githubForge) }

func newGitlabCLI() *forgeCLI { return newForgeCLI(gitlabForge) }

func newForgeCLI(forge forgeSpec) *forgeCLI {
	return &forgeCLI{
		forge:       forge,
		environ:     os.Environ,
		lookPath:    exec.LookPath,
		userHomeDir: os.UserHomeDir,
		runCommand: func(ctx context.Context, path string, env []string, args ...string) ([]byte, []byte, error) {
			cmd := exec.CommandContext(ctx, path, args...)
			cmd.Env = env
			var stderr bytes.Buffer
			cmd.Stderr = &stderr
			stdout, err := cmd.Output()
			return stdout, stderr.Bytes(), err
		},
	}
}

func (g *forgeCLI) run(ctx context.Context, args ...string) (string, error) {
	path, err := g.executablePath()
	if err != nil {
		return "", err
	}
	stdout, stderr, err := g.runCommand(ctx, path, g.commandEnv(), args...)
	if err != nil {
		msg := strings.TrimSpace(string(stderr))
		if msg == "" {
			msg = strings.TrimSpace(string(stdout))
		}
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s %s failed: %s", g.forge.binary, strings.Join(args, " "), msg)
	}
	return string(stdout), nil
}

func (g *forgeCLI) executablePath() (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.resolvedPath != "" {
		return g.resolvedPath, nil
	}

	binary := g.forge.binary
	if path, err := g.lookPath(binary); err == nil && path != "" {
		g.resolvedPath = path
		return g.resolvedPath, nil
	}

	home, _ := g.userHomeDir()
	candidates := []string{
		"/usr/bin/" + binary,
		"/usr/local/bin/" + binary,
		"/opt/homebrew/bin/" + binary,
		"~/.local/bin/" + binary,
		"~/bin/" + binary,
	}
	checked := make([]string, 0, len(candidates)+1)
	checked = append(checked, "PATH")
	for _, candidate := range candidates {
		resolved := expandForgeCLIPath(candidate, home)
		checked = append(checked, resolved)
		if resolved == "" {
			continue
		}
		if path, err := g.lookPath(resolved); err == nil && path != "" {
			g.resolvedPath = path
			return g.resolvedPath, nil
		}
	}

	return "", fmt.Errorf("%s executable not found; searched %s", binary, strings.Join(checked, ", "))
}

func (g *forgeCLI) commandEnv() []string {
	if g.environ == nil {
		return nil
	}
	env := g.environ()
	if len(env) == 0 {
		return nil
	}
	selected := make([]string, 0, len(env))
	for _, item := range env {
		key, _, found := strings.Cut(item, "=")
		if found && g.passesEnv(key) {
			selected = append(selected, item)
		}
	}
	return selected
}

func (g *forgeCLI) passesEnv(key string) bool {
	for _, allowed := range forgeCommonEnvKeys {
		if key == allowed {
			return true
		}
	}
	for _, allowed := range g.forge.envKeys {
		if key == allowed {
			return true
		}
	}
	for _, prefix := range g.forge.envPrefixes {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}

func expandForgeCLIPath(path, home string) string {
	switch {
	case path == "~":
		return home
	case strings.HasPrefix(path, "~/"):
		if home == "" {
			return ""
		}
		return filepath.Join(home, path[2:])
	default:
		return path
	}
}

// runPaginatedForgeAPI decodes `gh api --paginate`, which prints one JSON
// array per page, and `glab api --paginate`, which merges them into one.
func runPaginatedForgeAPI[T any](ctx context.Context, cli *forgeCLI, host string, args ...string) ([]T, error) {
	out, err := cli.run(ctx, args...)
	if err != nil {
		return nil, err
	}
	items, err := decodePaginatedJSONArray[T](out)
	if err != nil {
		return nil, fmt.Errorf("failed to decode %s response: %w", host, err)
	}
	return items, nil
}

func decodePaginatedJSONArray[T any](raw string) ([]T, error) {
	decoder := json.NewDecoder(strings.NewReader(raw))
	items := make([]T, 0)
	for {
		var pageItems []T
		if err := decoder.Decode(&pageItems); err != nil {
			if err == io.EOF {
				return items, nil
			}
			return nil, err
		}
		items = append(items, pageItems...)
	}
}

// createdOnLocalDay reports whether an RFC 3339 timestamp falls on now's
// calendar day in now's time zone.
func createdOnLocalDay(createdAt string, now time.Time) bool {
	if strings.TrimSpace(createdAt) == "" {
		return false
	}
	created, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		return false
	}
	created = created.In(now.Location())
	return created.Year() == now.Year() && created.YearDay() == now.YearDay()
}

func isForgeAuthError(err error) bool {
	if err == nil {
		return false
	}
	lower := strings.ToLower(err.Error())
	for _, token := range []string{
		"401", "403", "unauthorized", "forbidden", "authentication",
		"not logged in", "auth login", "bad credentials",
	} {
		if strings.Contains(lower, token) {
			return true
		}
	}
	return false
}
