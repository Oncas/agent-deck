package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
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

func (a *apiHandler) githubTodayActivity(ctx context.Context, now time.Time) (forgeActivityResponse, error) {
	user, err := a.githubCurrentUser(ctx)
	if err != nil {
		return forgeActivityResponse{}, err
	}

	today := now.Format("2006-01-02")
	events, err := a.githubUserEvents(ctx, user.Login)
	if err != nil && isForgeNotFoundError(err) {
		// A renamed account stops resolving under its old login, and the login
		// above may have been cached before the rename. Look it up again and
		// retry once if it changed.
		a.clearCachedGitHubUser()
		fresh, userErr := a.githubCurrentUser(ctx)
		if userErr != nil {
			return forgeActivityResponse{}, userErr
		}
		if fresh.Login != user.Login {
			user = fresh
			events, err = a.githubUserEvents(ctx, user.Login)
		}
	}
	if err != nil {
		if isForgeAuthError(err) {
			a.clearCachedGitHubUser()
		}
		return forgeActivityResponse{}, err
	}

	resp := forgeActivityResponse{
		Date:     today,
		Username: user.Login,
	}
	for _, event := range events {
		if !githubEventFallsOnDate(event, now) || !githubEventCountsAsContribution(event) {
			continue
		}
		// Count events, not the number of commits carried by a push event, so
		// the tile matches what the profile activity feed shows.
		resp.count(githubEventContributionBucket(event))
	}
	return resp, nil
}

func (a *apiHandler) githubUserEvents(ctx context.Context, login string) ([]githubUserEvent, error) {
	query := url.Values{}
	// The GitHub events feed takes no date filter — it returns the most recent
	// events (up to 300, 90 days) newest first, so page through it and keep the
	// exact local day in the caller.
	query.Set("per_page", "100")

	endpoint := fmt.Sprintf("/users/%s/events?%s", url.PathEscape(login), query.Encode())
	return runPaginatedGhAPI[githubUserEvent](ctx, a.githubRuntime(), endpoint)
}

func githubEventFallsOnDate(event githubUserEvent, now time.Time) bool {
	return createdOnLocalDay(event.CreatedAt, now)
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
		if isForgeAuthError(err) {
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

func runPaginatedGhAPI[T any](ctx context.Context, cli *forgeCLI, endpoint string) ([]T, error) {
	return runPaginatedForgeAPI[T](ctx, cli, "GitHub", "api", endpoint, "--paginate")
}

func (a *apiHandler) githubRuntime() *forgeCLI {
	if a.githubCLI == nil {
		a.githubCLI = newGithubCLI()
	}
	return a.githubCLI
}
