package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type githubUserCacheState struct {
	user   githubCurrentUser
	cached bool
}

type githubCurrentUser struct {
	ID    int    `json:"id"`
	Login string `json:"login"`
}

type githubEventPayload struct {
	Action string `json:"action"`
	Size   int    `json:"size"`
	Ref    string `json:"ref"`
}

type githubUserEvent struct {
	ID        string             `json:"id"`
	Type      string             `json:"type"`
	CreatedAt string             `json:"created_at"`
	Payload   githubEventPayload `json:"payload"`
}

type githubTodayActivityResponse struct {
	Date         string `json:"date"`
	Username     string `json:"username"`
	Total        int    `json:"total"`
	Pushes       int    `json:"pushes"`
	PullRequests int    `json:"pull_requests"`
	Issues       int    `json:"issues"`
	Comments     int    `json:"comments"`
	Other        int    `json:"other"`
}

type githubCLI struct {
	environ      func() []string
	lookPath     func(string) (string, error)
	userHomeDir  func() (string, error)
	runCommand   func(context.Context, string, []string, ...string) ([]byte, []byte, error)
	mu           sync.Mutex
	resolvedPath string
}

func newGithubCLI() *githubCLI {
	return &githubCLI{
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

func (g *githubCLI) run(ctx context.Context, args ...string) (string, error) {
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
		return "", fmt.Errorf("gh %s failed: %s", strings.Join(args, " "), msg)
	}
	return string(stdout), nil
}

func (g *githubCLI) executablePath() (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.resolvedPath != "" {
		return g.resolvedPath, nil
	}

	if path, err := g.lookPath("gh"); err == nil && path != "" {
		g.resolvedPath = path
		return g.resolvedPath, nil
	}

	home, _ := g.userHomeDir()
	candidates := []string{
		"/usr/bin/gh",
		"/usr/local/bin/gh",
		"/opt/homebrew/bin/gh",
		"~/.local/bin/gh",
		"~/bin/gh",
	}
	checked := make([]string, 0, len(candidates)+1)
	checked = append(checked, "PATH")
	for _, candidate := range candidates {
		resolved := expandGithubCLIPath(candidate, home)
		checked = append(checked, resolved)
		if resolved == "" {
			continue
		}
		if path, err := g.lookPath(resolved); err == nil && path != "" {
			g.resolvedPath = path
			return g.resolvedPath, nil
		}
	}

	return "", fmt.Errorf("gh executable not found; searched %s", strings.Join(checked, ", "))
}

func (g *githubCLI) commandEnv() []string {
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
		if !found {
			continue
		}
		switch {
		case key == "HOME",
			key == "PATH",
			key == "XDG_CONFIG_HOME",
			key == "XDG_CACHE_HOME",
			key == "XDG_STATE_HOME",
			key == "GITHUB_TOKEN",
			key == "GITHUB_HOST",
			key == "GITHUB_ENTERPRISE_TOKEN",
			key == "HTTP_PROXY",
			key == "HTTPS_PROXY",
			key == "NO_PROXY",
			key == "ALL_PROXY",
			key == "SSL_CERT_FILE",
			key == "SSL_CERT_DIR",
			key == "http_proxy",
			key == "https_proxy",
			key == "no_proxy",
			key == "all_proxy",
			strings.HasPrefix(key, "GH_"):
			selected = append(selected, item)
		}
	}
	return selected
}

func expandGithubCLIPath(path, home string) string {
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

func (a *apiHandler) handleGitHubTodayActivity(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	resp, err := a.githubTodayActivity(ctx, time.Now())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, resp)
}

func (a *apiHandler) githubTodayActivity(ctx context.Context, now time.Time) (githubTodayActivityResponse, error) {
	user, err := a.githubCurrentUser(ctx)
	if err != nil {
		return githubTodayActivityResponse{}, err
	}

	today := now.Format("2006-01-02")
	query := url.Values{}
	// The GitHub events feed takes no date filter — it returns the most recent
	// events (up to 300, 90 days) newest first, so page through it and keep the
	// exact local day below.
	query.Set("per_page", "100")

	endpoint := fmt.Sprintf("/users/%s/events?%s", url.PathEscape(user.Login), query.Encode())
	events, err := runPaginatedGhAPI[githubUserEvent](ctx, a.githubRuntime(), endpoint)
	if err != nil {
		if isGitHubAuthError(err) {
			a.clearCachedGitHubUser()
		}
		return githubTodayActivityResponse{}, err
	}

	resp := githubTodayActivityResponse{
		Date:     today,
		Username: user.Login,
	}
	for _, event := range events {
		if !githubEventFallsOnDate(event, now) || !githubEventCountsAsContribution(event) {
			continue
		}
		// Count events, not the number of commits carried by a push event, so
		// the tile matches what the profile activity feed shows.
		resp.Total++
		switch githubEventContributionBucket(event) {
		case "push":
			resp.Pushes++
		case "pull_request":
			resp.PullRequests++
		case "issue":
			resp.Issues++
		case "comment":
			resp.Comments++
		default:
			resp.Other++
		}
	}
	return resp, nil
}

func githubEventFallsOnDate(event githubUserEvent, now time.Time) bool {
	if strings.TrimSpace(event.CreatedAt) == "" {
		return false
	}
	created, err := time.Parse(time.RFC3339, event.CreatedAt)
	if err != nil {
		return false
	}
	created = created.In(now.Location())
	return created.Year() == now.Year() && created.YearDay() == now.YearDay()
}

func githubEventCountsAsContribution(event githubUserEvent) bool {
	switch normalizeGitHubEventType(event.Type) {
	case "push",
		"pullrequest",
		"pullrequestreview",
		"pullrequestreviewcomment",
		"pullrequestreviewthread",
		"issues",
		"issuecomment",
		"commitcomment",
		"create",
		"delete",
		"release",
		"gollum":
		return true
	default:
		return false
	}
}

func githubEventContributionBucket(event githubUserEvent) string {
	switch normalizeGitHubEventType(event.Type) {
	case "push":
		return "push"
	case "issuecomment", "commitcomment", "pullrequestreviewcomment", "pullrequestreviewthread":
		return "comment"
	case "pullrequest", "pullrequestreview":
		return "pull_request"
	case "issues":
		return "issue"
	default:
		return "other"
	}
}

// normalizeGitHubEventType turns "PullRequestReviewEvent" into
// "pullrequestreview" so the buckets above stay readable.
func normalizeGitHubEventType(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	return strings.TrimSuffix(value, "event")
}

func (a *apiHandler) githubCurrentUser(ctx context.Context) (githubCurrentUser, error) {
	if user, ok := a.cachedGitHubUser(); ok {
		return user, nil
	}

	var user githubCurrentUser
	if err := a.runGhAPI(ctx, "/user", &user); err != nil {
		if isGitHubAuthError(err) {
			a.clearCachedGitHubUser()
		}
		return githubCurrentUser{}, err
	}
	if strings.TrimSpace(user.Login) == "" {
		return githubCurrentUser{}, fmt.Errorf("GitHub user response did not include a login")
	}
	a.cacheGitHubUser(user)
	return user, nil
}

func (a *apiHandler) cachedGitHubUser() (githubCurrentUser, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if !a.githubUser.cached {
		return githubCurrentUser{}, false
	}
	return a.githubUser.user, true
}

func (a *apiHandler) cacheGitHubUser(user githubCurrentUser) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.githubUser = githubUserCacheState{
		user:   user,
		cached: true,
	}
}

func (a *apiHandler) clearCachedGitHubUser() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.githubUser = githubUserCacheState{}
}

func (a *apiHandler) runGhAPI(ctx context.Context, endpoint string, dest any) error {
	out, err := a.runGhRaw(ctx, endpoint)
	if err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(out), dest); err != nil {
		return fmt.Errorf("failed to decode GitHub response: %w", err)
	}
	return nil
}

func (a *apiHandler) runGhRaw(ctx context.Context, endpoint string) (string, error) {
	out, err := a.githubRuntime().run(ctx, "api", endpoint)
	if err != nil {
		return "", err
	}
	return out, nil
}

func runPaginatedGhAPI[T any](ctx context.Context, cli *githubCLI, endpoint string) ([]T, error) {
	out, err := cli.run(ctx, "api", endpoint, "--paginate")
	if err != nil {
		return nil, err
	}
	items, err := decodePaginatedJSONArray[T](out)
	if err != nil {
		return nil, fmt.Errorf("failed to decode GitHub response: %w", err)
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

func (a *apiHandler) githubRuntime() *githubCLI {
	if a.githubCLI == nil {
		a.githubCLI = newGithubCLI()
	}
	return a.githubCLI
}

func isGitHubAuthError(err error) bool {
	if err == nil {
		return false
	}
	lower := strings.ToLower(err.Error())
	for _, token := range []string{
		"401", "403", "unauthorized", "forbidden", "authentication",
		"not logged in", "gh auth login", "bad credentials",
	} {
		if strings.Contains(lower, token) {
			return true
		}
	}
	return false
}
