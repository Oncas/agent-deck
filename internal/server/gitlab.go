package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"agentdeck/internal/config"
)

type gitlabUserCacheState struct {
	host   string
	user   gitlabCurrentUser
	cached bool
}

type gitlabCurrentUser struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
}

type gitlabEvent struct {
	ID         int    `json:"id"`
	ActionName string `json:"action_name"`
	TargetType string `json:"target_type"`
	CreatedAt  string `json:"created_at"`
}

func (a *apiHandler) handleGitLabTodayActivity(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	resp, err := a.gitlabTodayActivity(ctx, time.Now())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, resp)
}

func (a *apiHandler) gitlabTodayActivity(ctx context.Context, now time.Time) (forgeActivityResponse, error) {
	a.mu.RLock()
	host := a.cfg.GitLabHost
	a.mu.RUnlock()

	user, err := a.gitlabCurrentUser(ctx, host)
	if err != nil {
		return forgeActivityResponse{}, err
	}

	// /events lists the signed-in user's own events and, unlike GitHub's feed,
	// filters by date. after and before are exclusive and compare against the
	// server's calendar day, so ask for two days either side and keep the exact
	// local day below.
	query := url.Values{}
	query.Set("after", now.AddDate(0, 0, -2).Format("2006-01-02"))
	query.Set("before", now.AddDate(0, 0, 2).Format("2006-01-02"))
	query.Set("per_page", "100")

	args := gitlabAPIArgs(host, "events?"+query.Encode(), "--paginate")
	events, err := runPaginatedForgeAPI[gitlabEvent](ctx, a.gitlabRuntime(), "GitLab", args...)
	if err != nil {
		return forgeActivityResponse{}, a.gitlabError(err, host)
	}

	resp := forgeActivityResponse{
		Date:     now.Format("2006-01-02"),
		Username: user.Username,
	}
	for _, event := range events {
		if !createdOnLocalDay(event.CreatedAt, now) || !gitlabEventCountsAsContribution(event) {
			continue
		}
		resp.count(gitlabEventContributionBucket(event))
	}
	return resp, nil
}

// gitlabEventCountsAsContribution drops membership changes, which GitLab logs
// as events but are not work the user did.
func gitlabEventCountsAsContribution(event gitlabEvent) bool {
	switch strings.ToLower(strings.TrimSpace(event.ActionName)) {
	case "joined", "left", "expired":
		return false
	default:
		return true
	}
}

func gitlabEventContributionBucket(event gitlabEvent) string {
	action := strings.ToLower(strings.TrimSpace(event.ActionName))
	switch {
	case strings.HasPrefix(action, "pushed"):
		return "push"
	case action == "commented on":
		return "comment"
	}
	switch event.TargetType {
	case "MergeRequest":
		return "pull_request"
	case "Issue", "WorkItem":
		return "issue"
	case "Note", "DiffNote", "DiscussionNote":
		return "comment"
	default:
		return "other"
	}
}

func (a *apiHandler) gitlabCurrentUser(ctx context.Context, host string) (gitlabCurrentUser, error) {
	a.mu.RLock()
	cached := a.gitlabUser
	a.mu.RUnlock()
	if cached.cached && cached.host == host {
		return cached.user, nil
	}

	out, err := a.gitlabRuntime().run(ctx, gitlabAPIArgs(host, "user")...)
	if err != nil {
		return gitlabCurrentUser{}, a.gitlabError(err, host)
	}
	var user gitlabCurrentUser
	if err := json.Unmarshal([]byte(out), &user); err != nil {
		return gitlabCurrentUser{}, fmt.Errorf("failed to decode GitLab response: %w", err)
	}
	if strings.TrimSpace(user.Username) == "" {
		return gitlabCurrentUser{}, fmt.Errorf("GitLab user response did not include a username")
	}

	a.mu.Lock()
	a.gitlabUser = gitlabUserCacheState{host: host, user: user, cached: true}
	a.mu.Unlock()
	return user, nil
}

// gitlabError forgets the cached user after an auth failure and says how to
// log in, since glab itself only reports "401 Unauthorized".
func (a *apiHandler) gitlabError(err error, host string) error {
	if !isForgeAuthError(err) {
		return err
	}
	a.mu.Lock()
	a.gitlabUser = gitlabUserCacheState{}
	a.mu.Unlock()

	login := "glab auth login"
	if host != "" {
		login += " --hostname " + host
	}
	return fmt.Errorf("not logged in to GitLab: run `%s` (%w)", login, err)
}

// gitlabAPIArgs builds a `glab api` call. Without --hostname, glab uses
// GITLAB_HOST, or the GitLab remote of the current directory, or gitlab.com.
func gitlabAPIArgs(host, endpoint string, flags ...string) []string {
	args := append([]string{"api", endpoint}, flags...)
	if host != "" {
		args = append(args, "--hostname="+host)
	}
	return args
}

// normalizeActivityProvider turns anything but a known code host into "none".
func normalizeActivityProvider(raw string) string {
	switch provider := strings.ToLower(strings.TrimSpace(raw)); provider {
	case config.ActivityGitHub, config.ActivityGitLab:
		return provider
	default:
		return ""
	}
}

// normalizeGitLabHost turns a pasted URL like "https://gitlab.example.com/"
// into the bare host glab expects.
func normalizeGitLabHost(raw string) string {
	host := strings.ToLower(strings.TrimSpace(raw))
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimPrefix(host, "http://")
	host, _, _ = strings.Cut(host, "/")
	return host
}

func (a *apiHandler) gitlabRuntime() *forgeCLI {
	if a.gitlabCLI == nil {
		a.gitlabCLI = newGitlabCLI()
	}
	return a.gitlabCLI
}
