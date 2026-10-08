package server

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"agentdeck/internal/config"
)

func TestGitlabCLICommandEnv(t *testing.T) {
	cli := &forgeCLI{
		forge: gitlabForge,
		environ: func() []string {
			return []string{
				"HOME=/home/tester",
				"PATH=/usr/bin:/bin",
				"XDG_CONFIG_HOME=/tmp/config",
				"GITLAB_TOKEN=gitlab-token",
				"GITLAB_HOST=gitlab.example.com",
				"GLAB_CONFIG_DIR=/tmp/glab",
				"GH_TOKEN=gh-token",
				"GITHUB_TOKEN=github-token",
				"UNRELATED=drop-me",
			}
		},
	}

	got := cli.commandEnv()
	for _, item := range []string{
		"HOME=/home/tester",
		"PATH=/usr/bin:/bin",
		"XDG_CONFIG_HOME=/tmp/config",
		"GITLAB_TOKEN=gitlab-token",
		"GITLAB_HOST=gitlab.example.com",
		"GLAB_CONFIG_DIR=/tmp/glab",
	} {
		if !containsString(got, item) {
			t.Fatalf("commandEnv missing %q: %v", item, got)
		}
	}
	for _, item := range []string{"GH_TOKEN=gh-token", "GITHUB_TOKEN=github-token", "UNRELATED=drop-me"} {
		if containsString(got, item) {
			t.Fatalf("commandEnv unexpectedly included %q: %v", item, got)
		}
	}
}

func TestGitLabTodayActivityUsesEventsEndpoint(t *testing.T) {
	var eventsArgs []string
	var eventsQuery url.Values

	a := &apiHandler{
		cfg: &config.Config{},
		gitlabCLI: fakeGitlabCLI(func(args []string) ([]byte, error) {
			if len(args) < 2 || args[0] != "api" {
				return nil, errors.New("unexpected glab command")
			}
			switch endpoint := args[1]; {
			case endpoint == "user":
				return mustJSON(t, gitlabCurrentUser{ID: 7, Username: "activity-user"}), nil
			case strings.HasPrefix(endpoint, "events?"):
				var err error
				eventsArgs = append([]string(nil), args...)
				eventsQuery, err = url.ParseQuery(strings.TrimPrefix(endpoint, "events?"))
				if err != nil {
					t.Fatalf("ParseQuery failed: %v", err)
				}
				return mustJSON(t, []gitlabEvent{
					{ID: 1, ActionName: "pushed to", CreatedAt: "2026-05-29T07:00:00.123Z"},
					{ID: 2, ActionName: "pushed new", CreatedAt: "2026-05-29T07:10:00Z"},
					{ID: 3, ActionName: "opened", TargetType: "MergeRequest", CreatedAt: "2026-05-29T08:00:00Z"},
					{ID: 4, ActionName: "approved", TargetType: "MergeRequest", CreatedAt: "2026-05-29T08:30:00Z"},
					{ID: 5, ActionName: "closed", TargetType: "Issue", CreatedAt: "2026-05-29T09:00:00Z"},
					{ID: 6, ActionName: "commented on", TargetType: "DiffNote", CreatedAt: "2026-05-29T10:00:00Z"},
					{ID: 7, ActionName: "joined", CreatedAt: "2026-05-29T11:00:00Z"},
					{ID: 8, ActionName: "deleted", CreatedAt: "2026-05-29T12:00:00Z"},
					{ID: 9, ActionName: "pushed to", CreatedAt: "2026-05-28T20:00:00Z"},
					{ID: 10, ActionName: "pushed to", CreatedAt: "not-a-date"},
				}), nil
			default:
				return nil, errors.New("unexpected endpoint: " + endpoint)
			}
		}),
	}

	resp, err := a.gitlabTodayActivity(context.Background(), time.Date(2026, 5, 29, 12, 0, 0, 0, time.FixedZone("EEST", 3*60*60)))
	if err != nil {
		t.Fatalf("gitlabTodayActivity returned error: %v", err)
	}
	if len(eventsArgs) != 3 || eventsArgs[2] != "--paginate" {
		t.Fatalf("unexpected glab args: %v", eventsArgs)
	}
	// GitLab's after/before are exclusive dates on the server's clock, so the
	// window is wide enough for any time zone and the exact day is kept here.
	if got := eventsQuery.Get("after"); got != "2026-05-27" {
		t.Fatalf("after = %q, want 2026-05-27", got)
	}
	if got := eventsQuery.Get("before"); got != "2026-05-31" {
		t.Fatalf("before = %q, want 2026-05-31", got)
	}
	if got := eventsQuery.Get("per_page"); got != "100" {
		t.Fatalf("per_page = %q, want 100", got)
	}
	if resp.Username != "activity-user" || resp.Date != "2026-05-29" {
		t.Fatalf("unexpected identity fields: %+v", resp)
	}
	if resp.Total != 7 || resp.Pushes != 2 || resp.PullRequests != 2 || resp.Issues != 1 || resp.Comments != 1 || resp.Other != 1 {
		t.Fatalf("unexpected activity totals: %+v", resp)
	}
}

func TestGitLabTodayActivityPassesConfiguredHost(t *testing.T) {
	var calls [][]string
	a := &apiHandler{
		cfg: &config.Config{GitLabHost: "gitlab.example.com"},
		gitlabCLI: fakeGitlabCLI(func(args []string) ([]byte, error) {
			calls = append(calls, append([]string(nil), args...))
			if args[1] == "user" {
				return mustJSON(t, gitlabCurrentUser{Username: "reviewer"}), nil
			}
			return mustJSON(t, []gitlabEvent{}), nil
		}),
	}

	if _, err := a.gitlabTodayActivity(context.Background(), time.Now()); err != nil {
		t.Fatalf("gitlabTodayActivity returned error: %v", err)
	}
	if len(calls) != 2 {
		t.Fatalf("glab calls = %v, want user and events", calls)
	}
	for _, args := range calls {
		if !containsString(args, "--hostname=gitlab.example.com") {
			t.Fatalf("glab args = %v, want --hostname=gitlab.example.com", args)
		}
	}
}

func TestGitLabTodayActivityRefetchesUserWhenHostChanges(t *testing.T) {
	userCalls := 0
	a := &apiHandler{
		cfg: &config.Config{},
		gitlabCLI: fakeGitlabCLI(func(args []string) ([]byte, error) {
			if args[1] == "user" {
				userCalls++
				return mustJSON(t, gitlabCurrentUser{Username: "reviewer"}), nil
			}
			return mustJSON(t, []gitlabEvent{}), nil
		}),
	}

	now := time.Now()
	for i := 0; i < 2; i++ {
		if _, err := a.gitlabTodayActivity(context.Background(), now); err != nil {
			t.Fatalf("activity call %d failed: %v", i, err)
		}
	}
	if userCalls != 1 {
		t.Fatalf("user calls = %d, want 1 while the host is unchanged", userCalls)
	}

	a.cfg.GitLabHost = "gitlab.example.com"
	if _, err := a.gitlabTodayActivity(context.Background(), now); err != nil {
		t.Fatalf("activity call after host change failed: %v", err)
	}
	if userCalls != 2 {
		t.Fatalf("user calls = %d, want 2 after the host changed", userCalls)
	}
}

func TestGitLabTodayActivityExplainsHowToLogIn(t *testing.T) {
	a := &apiHandler{
		cfg: &config.Config{GitLabHost: "gitlab.example.com"},
		gitlabCLI: fakeGitlabCLI(func(args []string) ([]byte, error) {
			return []byte(`{"message":"401 Unauthorized"}`), errors.New("exit status 1")
		}),
	}

	_, err := a.gitlabTodayActivity(context.Background(), time.Now())
	if err == nil {
		t.Fatal("gitlabTodayActivity returned nil error, want auth failure")
	}
	if !strings.Contains(err.Error(), "glab auth login --hostname gitlab.example.com") {
		t.Fatalf("error = %q, want a glab auth login hint for the host", err)
	}
}

func TestGitlabEventContributionBucket(t *testing.T) {
	tests := []struct {
		action string
		target string
		counts bool
		bucket string
	}{
		{"pushed to", "", true, "push"},
		{"pushed new", "", true, "push"},
		{"opened", "MergeRequest", true, "pull_request"},
		{"accepted", "MergeRequest", true, "pull_request"},
		{"approved", "MergeRequest", true, "pull_request"},
		{"opened", "Issue", true, "issue"},
		{"opened", "WorkItem", true, "issue"},
		{"commented on", "Note", true, "comment"},
		{"commented on", "DiscussionNote", true, "comment"},
		{"created", "WikiPage::Meta", true, "other"},
		{"deleted", "", true, "other"},
		{"joined", "", false, "other"},
		{"left", "", false, "other"},
		{"expired", "", false, "other"},
	}
	for _, test := range tests {
		t.Run(test.action+" "+test.target, func(t *testing.T) {
			event := gitlabEvent{ActionName: test.action, TargetType: test.target}
			if got := gitlabEventCountsAsContribution(event); got != test.counts {
				t.Fatalf("gitlabEventCountsAsContribution() = %t, want %t", got, test.counts)
			}
			if got := gitlabEventContributionBucket(event); got != test.bucket {
				t.Fatalf("gitlabEventContributionBucket() = %q, want %q", got, test.bucket)
			}
		})
	}
}

func TestNormalizeGitLabHost(t *testing.T) {
	for in, want := range map[string]string{
		"":                             "",
		"  gitlab.com ":                "gitlab.com",
		"https://gitlab.example.com/":  "gitlab.example.com",
		"http://gitlab.example.com":    "gitlab.example.com",
		"GitLab.Example.com:8443":      "gitlab.example.com:8443",
		"https://gitlab.example.com/x": "gitlab.example.com",
	} {
		if got := normalizeGitLabHost(in); got != want {
			t.Fatalf("normalizeGitLabHost(%q) = %q, want %q", in, got, want)
		}
	}
}

func fakeGitlabCLI(run func(args []string) ([]byte, error)) *forgeCLI {
	cli := fakeGithubCLI(run)
	cli.forge = gitlabForge
	return cli
}
