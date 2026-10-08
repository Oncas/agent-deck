package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestGithubCLICommandEnv(t *testing.T) {
	cli := &forgeCLI{forge: githubForge,
		environ: func() []string {
			return []string{
				"HOME=/home/tester",
				"PATH=/usr/bin:/bin",
				"XDG_CONFIG_HOME=/tmp/config",
				"XDG_CACHE_HOME=/tmp/cache",
				"XDG_STATE_HOME=/tmp/state",
				"GH_CONFIG_DIR=/tmp/gh",
				"GH_TOKEN=gh-token",
				"GH_HOST=github.example.com",
				"GITHUB_TOKEN=github-token",
				"GITHUB_HOST=github.example.com",
				"GITHUB_ENTERPRISE_TOKEN=enterprise-token",
				"HTTP_PROXY=http://proxy",
				"HTTPS_PROXY=https://secure-proxy",
				"NO_PROXY=localhost,127.0.0.1",
				"ALL_PROXY=socks5://proxy",
				"SSL_CERT_FILE=/tmp/cert.pem",
				"SSL_CERT_DIR=/tmp/certs",
				"http_proxy=http://proxy-lower",
				"https_proxy=https://secure-proxy-lower",
				"no_proxy=localhost",
				"all_proxy=socks5://proxy-lower",
				"UNRELATED=drop-me",
			}
		},
	}

	got := cli.commandEnv()
	wantPresent := []string{
		"HOME=/home/tester",
		"PATH=/usr/bin:/bin",
		"XDG_CONFIG_HOME=/tmp/config",
		"XDG_CACHE_HOME=/tmp/cache",
		"XDG_STATE_HOME=/tmp/state",
		"GH_CONFIG_DIR=/tmp/gh",
		"GH_TOKEN=gh-token",
		"GH_HOST=github.example.com",
		"GITHUB_TOKEN=github-token",
		"GITHUB_HOST=github.example.com",
		"GITHUB_ENTERPRISE_TOKEN=enterprise-token",
		"HTTP_PROXY=http://proxy",
		"HTTPS_PROXY=https://secure-proxy",
		"NO_PROXY=localhost,127.0.0.1",
		"ALL_PROXY=socks5://proxy",
		"SSL_CERT_FILE=/tmp/cert.pem",
		"SSL_CERT_DIR=/tmp/certs",
		"http_proxy=http://proxy-lower",
		"https_proxy=https://secure-proxy-lower",
		"no_proxy=localhost",
		"all_proxy=socks5://proxy-lower",
	}

	for _, item := range wantPresent {
		if !containsString(got, item) {
			t.Fatalf("commandEnv missing %q: %v", item, got)
		}
	}
	if containsString(got, "UNRELATED=drop-me") {
		t.Fatalf("commandEnv unexpectedly included unrelated env: %v", got)
	}
}

func TestGithubCLIExecutablePath(t *testing.T) {
	t.Run("prefers PATH lookup first", func(t *testing.T) {
		var lookedUp []string
		cli := &forgeCLI{forge: githubForge,
			lookPath: func(path string) (string, error) {
				lookedUp = append(lookedUp, path)
				if path == "gh" {
					return "/custom/bin/gh", nil
				}
				return "", exec.ErrNotFound
			},
			userHomeDir: func() (string, error) { return "/home/tester", nil },
		}

		got, err := cli.executablePath()
		if err != nil {
			t.Fatalf("executablePath returned error: %v", err)
		}
		if got != "/custom/bin/gh" {
			t.Fatalf("executablePath = %q, want %q", got, "/custom/bin/gh")
		}
		if len(lookedUp) != 1 || lookedUp[0] != "gh" {
			t.Fatalf("unexpected lookup order: %v", lookedUp)
		}
	})

	t.Run("falls back through common paths and expands tilde", func(t *testing.T) {
		var lookedUp []string
		cli := &forgeCLI{forge: githubForge,
			lookPath: func(path string) (string, error) {
				lookedUp = append(lookedUp, path)
				if path == "/home/tester/.local/bin/gh" {
					return path, nil
				}
				return "", exec.ErrNotFound
			},
			userHomeDir: func() (string, error) { return "/home/tester", nil },
		}

		got, err := cli.executablePath()
		if err != nil {
			t.Fatalf("executablePath returned error: %v", err)
		}
		if got != "/home/tester/.local/bin/gh" {
			t.Fatalf("executablePath = %q, want %q", got, "/home/tester/.local/bin/gh")
		}

		wantOrder := []string{
			"gh",
			"/usr/bin/gh",
			"/usr/local/bin/gh",
			"/opt/homebrew/bin/gh",
			"/home/tester/.local/bin/gh",
		}
		if strings.Join(lookedUp, "|") != strings.Join(wantOrder, "|") {
			t.Fatalf("lookup order = %v, want %v", lookedUp, wantOrder)
		}
	})

	t.Run("retries lookup after initial failure", func(t *testing.T) {
		attempts := 0
		cli := &forgeCLI{forge: githubForge,
			lookPath: func(path string) (string, error) {
				if path != "gh" {
					return "", exec.ErrNotFound
				}
				attempts++
				if attempts == 1 {
					return "", exec.ErrNotFound
				}
				return "/custom/bin/gh", nil
			},
			userHomeDir: func() (string, error) { return "/home/tester", nil },
		}

		_, err := cli.executablePath()
		if err == nil {
			t.Fatal("first executablePath call returned nil error, want failure")
		}

		got, err := cli.executablePath()
		if err != nil {
			t.Fatalf("second executablePath returned error: %v", err)
		}
		if got != "/custom/bin/gh" {
			t.Fatalf("second executablePath = %q, want %q", got, "/custom/bin/gh")
		}
		if attempts != 2 {
			t.Fatalf("lookPath called %d times, want 2", attempts)
		}
	})
}

func TestGithubCLIRun(t *testing.T) {
	t.Run("returns stdout without stderr warnings on success", func(t *testing.T) {
		cli := &forgeCLI{forge: githubForge,
			lookPath:    func(path string) (string, error) { return "/usr/bin/gh", nil },
			userHomeDir: func() (string, error) { return "/tmp/home", nil },
			runCommand: func(_ context.Context, _ string, _ []string, args ...string) ([]byte, []byte, error) {
				if strings.Join(args, " ") != "api /user" {
					t.Fatalf("unexpected args: %v", args)
				}
				return []byte(`{"login":"reviewer"}`), []byte("warning: token expires soon\n"), nil
			},
		}

		got, err := cli.run(context.Background(), "api", "/user")
		if err != nil {
			t.Fatalf("run returned error: %v", err)
		}
		if got != `{"login":"reviewer"}` {
			t.Fatalf("run = %q, want clean stdout JSON", got)
		}
	})

	t.Run("prefers stderr in failure message", func(t *testing.T) {
		cli := &forgeCLI{forge: githubForge,
			lookPath:    func(path string) (string, error) { return "/usr/bin/gh", nil },
			userHomeDir: func() (string, error) { return "/tmp/home", nil },
			runCommand: func(_ context.Context, _ string, _ []string, _ ...string) ([]byte, []byte, error) {
				return nil, []byte("gh: Bad credentials\n"), errors.New("exit status 1")
			},
		}

		_, err := cli.run(context.Background(), "api", "/user")
		if err == nil {
			t.Fatal("run returned nil error, want failure")
		}
		if !strings.Contains(err.Error(), "gh: Bad credentials") {
			t.Fatalf("error = %q, want stderr text", err)
		}
	})
}

func TestRunGhAPIIgnoresStderrWarningsOnSuccess(t *testing.T) {
	a := &apiHandler{
		githubCLI: &forgeCLI{forge: githubForge,
			lookPath:    func(path string) (string, error) { return "/usr/bin/gh", nil },
			userHomeDir: func() (string, error) { return "/tmp/home", nil },
			runCommand: func(_ context.Context, _ string, _ []string, args ...string) ([]byte, []byte, error) {
				if strings.Join(args, " ") != "api /user" {
					t.Fatalf("unexpected args: %v", args)
				}
				return mustJSON(t, githubCurrentUser{Login: "reviewer"}), []byte("warning: token expires soon\n"), nil
			},
		},
	}

	var user githubCurrentUser
	if err := a.runGhAPI(context.Background(), "/user", &user); err != nil {
		t.Fatalf("runGhAPI returned error: %v", err)
	}
	if user.Login != "reviewer" {
		t.Fatalf("user.Login = %q, want %q", user.Login, "reviewer")
	}
}

func TestRunPaginatedGhAPIIgnoresStderrWarningsOnSuccess(t *testing.T) {
	cli := &forgeCLI{forge: githubForge,
		lookPath:    func(path string) (string, error) { return "/usr/bin/gh", nil },
		userHomeDir: func() (string, error) { return "/tmp/home", nil },
		runCommand: func(_ context.Context, _ string, _ []string, args ...string) ([]byte, []byte, error) {
			if strings.Join(args, " ") != "api /users/reviewer/events --paginate" {
				t.Fatalf("unexpected args: %v", args)
			}
			return appendPaginatedJSON(t,
				[]githubUserEvent{{ID: "1", Type: "PushEvent"}},
				[]githubUserEvent{{ID: "2", Type: "IssuesEvent"}},
			), []byte("warning: token expires soon\n"), nil
		},
	}

	items, err := runPaginatedGhAPI[githubUserEvent](context.Background(), cli, "/users/reviewer/events")
	if err != nil {
		t.Fatalf("runPaginatedGhAPI returned error: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2", len(items))
	}
}

func TestGitHubTodayActivityUsesUserEventsEndpoint(t *testing.T) {
	const username = "activity-user"
	eventsPrefix := "/users/" + username + "/events?"
	var eventsQuery url.Values
	var eventsArgs []string

	a := &apiHandler{
		githubCLI: fakeGithubCLI(func(args []string) ([]byte, error) {
			if len(args) < 2 || args[0] != "api" {
				return nil, errors.New("unexpected gh command")
			}
			switch endpoint := args[1]; {
			case endpoint == "/user":
				return mustJSON(t, githubCurrentUser{ID: 424242, Login: username}), nil
			case strings.HasPrefix(endpoint, eventsPrefix):
				var err error
				eventsArgs = append([]string(nil), args...)
				eventsQuery, err = url.ParseQuery(strings.TrimPrefix(endpoint, eventsPrefix))
				if err != nil {
					t.Fatalf("ParseQuery failed: %v", err)
				}
				return mustJSON(t, []githubUserEvent{
					{ID: "1", Type: "PushEvent", CreatedAt: "2026-05-29T07:00:00Z", Payload: githubEventPayload{Size: 3}},
					{ID: "2", Type: "PullRequestReviewEvent", CreatedAt: "2026-05-29T08:00:00Z", Payload: githubEventPayload{Action: "submitted"}},
					{ID: "3", Type: "IssuesEvent", CreatedAt: "2026-05-29T09:00:00Z", Payload: githubEventPayload{Action: "opened"}},
					{ID: "4", Type: "IssueCommentEvent", CreatedAt: "2026-05-29T10:00:00Z", Payload: githubEventPayload{Action: "created"}},
					{ID: "5", Type: "WatchEvent", CreatedAt: "2026-05-29T11:00:00Z", Payload: githubEventPayload{Action: "started"}},
					{ID: "6", Type: "PushEvent", CreatedAt: "2026-05-28T23:00:00Z", Payload: githubEventPayload{Size: 9}},
					{ID: "7", Type: "DeleteEvent", CreatedAt: "2026-05-29T12:00:00Z", Payload: githubEventPayload{Ref: "feature"}},
					{ID: "8", Type: "IssueCommentEvent", CreatedAt: "not-a-date"},
					{ID: "9", Type: "PushEvent", CreatedAt: "2026-05-27T10:00:00Z"},
				}), nil
			default:
				return nil, errors.New("unexpected endpoint: " + endpoint)
			}
		}),
	}

	resp, err := a.githubTodayActivity(context.Background(), time.Date(2026, 5, 29, 12, 0, 0, 0, time.FixedZone("EEST", 3*60*60)))
	if err != nil {
		t.Fatalf("githubTodayActivity returned error: %v", err)
	}
	if len(eventsArgs) != 3 || eventsArgs[0] != "api" || eventsArgs[2] != "--paginate" {
		t.Fatalf("unexpected gh args: %v", eventsArgs)
	}
	if got := eventsQuery.Get("per_page"); got != "100" {
		t.Fatalf("per_page query = %q, want %q", got, "100")
	}
	if resp.Username != username || resp.Date != "2026-05-29" {
		t.Fatalf("unexpected identity fields: %+v", resp)
	}
	if resp.Total != 6 || resp.Pushes != 2 || resp.PullRequests != 1 || resp.Issues != 1 || resp.Comments != 1 || resp.Other != 1 {
		t.Fatalf("unexpected activity totals: %+v", resp)
	}
}

func TestGitHubEventContributionBucketMapsEventTypes(t *testing.T) {
	tests := []struct {
		eventType string
		counts    bool
		bucket    string
	}{
		{"PushEvent", true, "push"},
		{"PullRequestEvent", true, "pull_request"},
		{"PullRequestReviewEvent", true, "pull_request"},
		{"PullRequestReviewCommentEvent", true, "comment"},
		{"IssueCommentEvent", true, "comment"},
		{"CommitCommentEvent", true, "comment"},
		{"IssuesEvent", true, "issue"},
		{"CreateEvent", true, "other"},
		{"DeleteEvent", true, "other"},
		{"ReleaseEvent", true, "other"},
		{"WatchEvent", false, "other"},
		{"ForkEvent", false, "other"},
		{"MemberEvent", false, "other"},
	}

	for _, test := range tests {
		t.Run(test.eventType, func(t *testing.T) {
			event := githubUserEvent{Type: test.eventType}
			if got := githubEventCountsAsContribution(event); got != test.counts {
				t.Fatalf("githubEventCountsAsContribution() = %t, want %t", got, test.counts)
			}
			if got := githubEventContributionBucket(event); got != test.bucket {
				t.Fatalf("githubEventContributionBucket() = %q, want %q", got, test.bucket)
			}
		})
	}
}

func TestGitHubTodayActivityCachesUserAcrossRequests(t *testing.T) {
	var userCalls int
	var eventCalls int

	a := &apiHandler{
		githubCLI: fakeGithubCLI(func(args []string) ([]byte, error) {
			if len(args) < 2 || args[0] != "api" {
				return nil, errors.New("unexpected gh command")
			}
			switch endpoint := args[1]; {
			case endpoint == "/user":
				userCalls++
				return mustJSON(t, githubCurrentUser{ID: 1, Login: "reviewer"}), nil
			case strings.HasPrefix(endpoint, "/users/reviewer/events?"):
				eventCalls++
				return mustJSON(t, []githubUserEvent{}), nil
			default:
				return nil, errors.New("unexpected endpoint: " + endpoint)
			}
		}),
	}

	now := time.Now()
	if _, err := a.githubTodayActivity(context.Background(), now); err != nil {
		t.Fatalf("first activity call failed: %v", err)
	}
	if _, err := a.githubTodayActivity(context.Background(), now); err != nil {
		t.Fatalf("second activity call failed: %v", err)
	}

	if userCalls != 1 {
		t.Fatalf("/user calls = %d, want 1", userCalls)
	}
	if eventCalls != 2 {
		t.Fatalf("event calls = %d, want 2", eventCalls)
	}
}

func TestGitHubTodayActivityClearsCachedUserAfterAuthFailure(t *testing.T) {
	var userCalls int
	var eventCalls int

	a := &apiHandler{
		githubCLI: fakeGithubCLI(func(args []string) ([]byte, error) {
			if len(args) < 2 || args[0] != "api" {
				return nil, errors.New("unexpected gh command")
			}
			switch endpoint := args[1]; {
			case endpoint == "/user":
				userCalls++
				return mustJSON(t, githubCurrentUser{ID: 1, Login: "reviewer"}), nil
			case strings.HasPrefix(endpoint, "/users/reviewer/events?"):
				eventCalls++
				if eventCalls == 2 {
					return []byte("401 Unauthorized"), errors.New("exit 1")
				}
				return mustJSON(t, []githubUserEvent{}), nil
			default:
				return nil, errors.New("unexpected endpoint: " + endpoint)
			}
		}),
	}

	now := time.Now()
	if _, err := a.githubTodayActivity(context.Background(), now); err != nil {
		t.Fatalf("first activity call failed: %v", err)
	}
	if _, err := a.githubTodayActivity(context.Background(), now); err == nil {
		t.Fatal("second activity call should fail")
	}
	if _, err := a.githubTodayActivity(context.Background(), now); err != nil {
		t.Fatalf("third activity call failed: %v", err)
	}

	if userCalls != 2 {
		t.Fatalf("/user calls = %d, want 2 after auth failure invalidation", userCalls)
	}
}

func TestGitHubTodayActivityFollowsRenamedLogin(t *testing.T) {
	login := "old-login"
	var userCalls int

	a := &apiHandler{
		githubCLI: fakeGithubCLI(func(args []string) ([]byte, error) {
			if len(args) < 2 || args[0] != "api" {
				return nil, errors.New("unexpected gh command")
			}
			switch endpoint := args[1]; {
			case endpoint == "/user":
				userCalls++
				return mustJSON(t, githubCurrentUser{ID: 1, Login: login}), nil
			case strings.HasPrefix(endpoint, "/users/"+login+"/events?"):
				return mustJSON(t, []githubUserEvent{}), nil
			case strings.HasPrefix(endpoint, "/users/"):
				return []byte("gh: Not Found (HTTP 404)"), errors.New("exit 1")
			default:
				return nil, errors.New("unexpected endpoint: " + endpoint)
			}
		}),
	}

	now := time.Now()
	if _, err := a.githubTodayActivity(context.Background(), now); err != nil {
		t.Fatalf("first activity call failed: %v", err)
	}

	login = "new-login"
	resp, err := a.githubTodayActivity(context.Background(), now)
	if err != nil {
		t.Fatalf("activity call after rename failed: %v", err)
	}
	if resp.Username != "new-login" {
		t.Fatalf("username = %q, want new-login", resp.Username)
	}
	if userCalls != 2 {
		t.Fatalf("/user calls = %d, want 2 after the cached login stopped resolving", userCalls)
	}
}

func TestGitHubTodayActivityReturnsNotFoundWhenLoginIsUnchanged(t *testing.T) {
	var eventCalls int

	a := &apiHandler{
		githubCLI: fakeGithubCLI(func(args []string) ([]byte, error) {
			if len(args) < 2 || args[0] != "api" {
				return nil, errors.New("unexpected gh command")
			}
			switch endpoint := args[1]; {
			case endpoint == "/user":
				return mustJSON(t, githubCurrentUser{ID: 1, Login: "reviewer"}), nil
			case strings.HasPrefix(endpoint, "/users/reviewer/events?"):
				eventCalls++
				return []byte("gh: Not Found (HTTP 404)"), errors.New("exit 1")
			default:
				return nil, errors.New("unexpected endpoint: " + endpoint)
			}
		}),
	}

	if _, err := a.githubTodayActivity(context.Background(), time.Now()); err == nil {
		t.Fatal("activity call should fail when the events feed is missing")
	}
	if eventCalls != 1 {
		t.Fatalf("event calls = %d, want 1 when the login did not change", eventCalls)
	}
}

func fakeGithubCLI(run func(args []string) ([]byte, error)) *forgeCLI {
	return &forgeCLI{forge: githubForge,
		environ:     func() []string { return []string{"HOME=/tmp/home", "PATH=/usr/bin"} },
		lookPath:    func(path string) (string, error) { return "/usr/bin/gh", nil },
		userHomeDir: func() (string, error) { return "/tmp/home", nil },
		runCommand: func(_ context.Context, _ string, _ []string, args ...string) ([]byte, []byte, error) {
			stdout, err := run(args)
			return stdout, nil, err
		},
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	return data
}

func appendPaginatedJSON[T any](t *testing.T, pages ...[]T) []byte {
	t.Helper()
	var out []byte
	for _, page := range pages {
		out = append(out, mustJSON(t, page)...)
	}
	return out
}

func containsString(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}
