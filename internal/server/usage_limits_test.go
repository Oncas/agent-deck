package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func codexRateLimitLine(t *testing.T, ts string, primary, secondary any) string {
	t.Helper()
	data, err := json.Marshal(map[string]any{
		"type":      "event_msg",
		"timestamp": ts,
		"payload": map[string]any{
			"type":        "token_count",
			"rate_limits": map[string]any{"primary": primary, "secondary": secondary},
		},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(data)
}

func writeSessionFile(t *testing.T, path string, mtime time.Time, lines ...string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
}

func TestLatestCodexLimitsReadsTheNewestReportedWindows(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	sessions := filepath.Join(t.TempDir(), "sessions")
	reset5h := now.Add(90 * time.Minute)
	resetWeek := now.Add(72 * time.Hour)

	writeSessionFile(t, filepath.Join(sessions, "2026", "10", "06", "old.jsonl"), now.Add(-20*time.Hour),
		codexRateLimitLine(t, "2026-10-06T16:00:00Z",
			map[string]any{"used_percent": 90.0, "window_minutes": 300, "resets_at": now.Add(-10 * time.Hour).Unix()},
			nil),
	)
	writeSessionFile(t, filepath.Join(sessions, "2026", "10", "07", "new.jsonl"), now.Add(-time.Minute),
		codexRateLimitLine(t, "2026-10-07T11:00:00Z",
			map[string]any{"used_percent": 10.0, "window_minutes": 300, "resets_at": reset5h.Unix()},
			map[string]any{"used_percent": 5.0, "window_minutes": 10080, "resets_at": resetWeek.Unix()}),
		codexRateLimitLine(t, "2026-10-07T11:58:00Z",
			map[string]any{"used_percent": 42.5, "window_minutes": 300, "resets_at": reset5h.Unix()},
			map[string]any{"used_percent": 18.0, "window_minutes": 10080, "resets_at": resetWeek.Unix()}),
		// An API-key session reports no windows; it must not hide the last real ones.
		codexRateLimitLine(t, "2026-10-07T11:59:00Z", nil, nil),
	)

	limits, err := latestCodexLimits(sessions, now)
	if err != nil {
		t.Fatalf("latestCodexLimits: %v", err)
	}
	if limits == nil {
		t.Fatal("limits = nil, want the newest reported windows")
	}
	if limits.ObservedAt != "2026-10-07T11:58:00Z" {
		t.Fatalf("observed_at = %q", limits.ObservedAt)
	}
	want := []usageLimitWindow{
		{Key: "five_hour", Label: "5h", UsedPercent: 42.5, ResetsAt: reset5h.Format(time.RFC3339)},
		{Key: "weekly", Label: "Week", UsedPercent: 18, ResetsAt: resetWeek.Format(time.RFC3339)},
	}
	assertLimitWindows(t, limits.Windows, want)
}

func TestLatestCodexLimitsHandlesRelativeResetsAndElapsedWindows(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	sessions := filepath.Join(t.TempDir(), "sessions")
	writeSessionFile(t, filepath.Join(sessions, "s.jsonl"), now.Add(-time.Hour),
		codexRateLimitLine(t, "2026-10-07T06:00:00Z",
			// Older Codex versions report seconds until reset instead of a time.
			map[string]any{"used_percent": 70.0, "window_minutes": 300, "resets_in_seconds": 3600},
			map[string]any{"used_percent": 30.0, "window_minutes": 10080, "resets_in_seconds": 86400}),
	)

	limits, err := latestCodexLimits(sessions, now)
	if err != nil || limits == nil {
		t.Fatalf("latestCodexLimits = %v, %v", limits, err)
	}
	assertLimitWindows(t, limits.Windows, []usageLimitWindow{
		// The 5h window reset at 07:00, so nothing is used in the current one.
		{Key: "five_hour", Label: "5h", UsedPercent: 0},
		{Key: "weekly", Label: "Week", UsedPercent: 30, ResetsAt: "2026-10-08T06:00:00Z"},
	})
}

func TestLatestCodexLimitsIsNilWithoutReportedWindows(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	sessions := filepath.Join(t.TempDir(), "sessions")
	writeSessionFile(t, filepath.Join(sessions, "s.jsonl"), now,
		codexRateLimitLine(t, "2026-10-07T11:00:00Z", nil, nil))
	limits, err := latestCodexLimits(sessions, now)
	if err != nil || limits != nil {
		t.Fatalf("latestCodexLimits = %#v, %v; want nil, nil", limits, err)
	}
}

func assertLimitWindows(t *testing.T, got, want []usageLimitWindow) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("windows = %#v, want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("window %d = %#v, want %#v", i, got[i], want[i])
		}
	}
}

func writeClaudeCredentials(t *testing.T, home, token string, expiresAt time.Time) {
	t.Helper()
	data := mustJSON(t, map[string]any{"claudeAiOauth": map[string]any{
		"accessToken": token, "refreshToken": "refresh", "expiresAt": expiresAt.UnixMilli(),
	}})
	if err := os.WriteFile(filepath.Join(home, ".credentials.json"), data, 0o600); err != nil {
		t.Fatalf("write credentials: %v", err)
	}
}

func TestFetchClaudeLimitsReadsThePlanWindows(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	var gotAuth, gotBeta, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotBeta, gotPath = r.Header.Get("Authorization"), r.Header.Get("anthropic-beta"), r.URL.Path
		w.Write([]byte(`{
			"five_hour": {"utilization": 55.0, "resets_at": "2026-10-07T13:29:59.530695+00:00"},
			"seven_day": {"utilization": 71.0, "resets_at": "2026-10-07T11:00:00+00:00"},
			"seven_day_opus": null,
			"extra_usage": {"is_enabled": false, "utilization": null},
			"limits": [{"kind": "session", "percent": 55}],
			"member_dashboard_available": false
		}`))
	}))
	defer srv.Close()
	home := t.TempDir()
	writeClaudeCredentials(t, home, "tok-123", now.Add(time.Hour))

	limits := fetchClaudeLimits(context.Background(), srv.Client(), srv.URL, home, now)
	if limits == nil {
		t.Fatal("limits = nil")
	}
	if gotAuth != "Bearer tok-123" || gotBeta != "oauth-2025-04-20" || gotPath != "/api/oauth/usage" {
		t.Fatalf("request = %q %q %q", gotAuth, gotBeta, gotPath)
	}
	if limits.ObservedAt != now.Format(time.RFC3339) {
		t.Fatalf("observed_at = %q", limits.ObservedAt)
	}
	assertLimitWindows(t, limits.Windows, []usageLimitWindow{
		{Key: "five_hour", Label: "5h", UsedPercent: 55, ResetsAt: "2026-10-07T13:29:59Z"},
		// This window reset an hour ago, so nothing is used in the new one yet.
		{Key: "weekly", Label: "Week", UsedPercent: 0},
	})
}

func TestFetchClaudeLimitsSkipsWithoutAUsableLogin(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer srv.Close()

	// No credentials file: an API-key user, or a machine without Claude Code.
	if got := fetchClaudeLimits(context.Background(), srv.Client(), srv.URL, t.TempDir(), now); got != nil {
		t.Fatalf("without credentials = %#v", got)
	}
	// An expired token is left for Claude Code to renew; nothing is sent.
	expired := t.TempDir()
	writeClaudeCredentials(t, expired, "old", now.Add(-time.Minute))
	if got := fetchClaudeLimits(context.Background(), srv.Client(), srv.URL, expired, now); got != nil {
		t.Fatalf("with expired token = %#v", got)
	}
	if calls != 0 {
		t.Fatalf("requests sent = %d, want 0", calls)
	}
	// A rejected token yields no limits rather than an error.
	valid := t.TempDir()
	writeClaudeCredentials(t, valid, "tok", now.Add(time.Hour))
	if got := fetchClaudeLimits(context.Background(), srv.Client(), srv.URL, valid, now); got != nil || calls != 1 {
		t.Fatalf("with rejected token = %#v after %d calls", got, calls)
	}
}

func TestLiveLimitsSourceKeepsTheLastReadingWhenAFetchFails(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	fail := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			http.Error(w, "rate limited", http.StatusTooManyRequests)
			return
		}
		w.Write([]byte(`{
			"five_hour": {"utilization": 40.0, "resets_at": "2026-10-07T13:00:00+00:00"},
			"seven_day": {"utilization": 20.0, "resets_at": "2026-10-09T00:00:00+00:00"}
		}`))
	}))
	defer srv.Close()
	home := t.TempDir()
	writeClaudeCredentials(t, home, "tok", now.Add(10*time.Hour))
	source := &liveLimitsSource{client: srv.Client(), apiBase: srv.URL, fetch: fetchClaudeLimits}

	if got := source.load(context.Background(), home, now); got == nil || len(got.Windows) != 2 {
		t.Fatalf("first load = %#v", got)
	}
	fail = true
	later := now.Add(2 * time.Hour)
	got := source.load(context.Background(), home, later)
	if got == nil {
		t.Fatal("failed fetch dropped the last reading")
	}
	if got.ObservedAt != now.Format(time.RFC3339) {
		t.Fatalf("observed_at = %q, want the original reading's time", got.ObservedAt)
	}
	assertLimitWindows(t, got.Windows, []usageLimitWindow{
		// The 5-hour window reset since the reading, so it starts over.
		{Key: "five_hour", Label: "5h", UsedPercent: 0},
		{Key: "weekly", Label: "Week", UsedPercent: 20, ResetsAt: "2026-10-09T00:00:00Z"},
	})

	// Another Claude config dir has its own login and no reading yet.
	if got := source.load(context.Background(), t.TempDir(), later); got != nil {
		t.Fatalf("other config dir = %#v", got)
	}
}

// The token Claude Code saved expires while it isn't running, so after a
// restart the last reading on disk is all there is to show.
func TestLiveLimitsSourceRestoresTheLastReadingAfterARestart(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{
			"five_hour": {"utilization": 40.0, "resets_at": "2026-10-07T13:00:00+00:00"},
			"seven_day": {"utilization": 20.0, "resets_at": "2026-10-09T00:00:00+00:00"}
		}`))
	}))
	defer srv.Close()
	home := t.TempDir()
	writeClaudeCredentials(t, home, "tok", now.Add(time.Hour))
	path := filepath.Join(t.TempDir(), ".agentdeck", "claude-plan-limits.json")

	source := &liveLimitsSource{client: srv.Client(), apiBase: srv.URL, fetch: fetchClaudeLimits, path: path}
	if got := source.load(context.Background(), home, now); got == nil {
		t.Fatal("first load = nil")
	}
	if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("saved reading = %v, %v", info, err)
	}

	later := now.Add(3 * time.Hour)
	restarted := &liveLimitsSource{client: srv.Client(), apiBase: srv.URL, fetch: fetchClaudeLimits, path: path}
	got := restarted.load(context.Background(), home, later)
	if got == nil || got.ObservedAt != now.Format(time.RFC3339) {
		t.Fatalf("after restart = %#v, want the saved reading", got)
	}
	assertLimitWindows(t, got.Windows, []usageLimitWindow{
		{Key: "five_hour", Label: "5h", UsedPercent: 0},
		{Key: "weekly", Label: "Week", UsedPercent: 20, ResetsAt: "2026-10-09T00:00:00Z"},
	})

	// A missing or unreadable file only means there is nothing to fall back to.
	if err := os.WriteFile(path, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	broken := &liveLimitsSource{client: srv.Client(), apiBase: srv.URL, fetch: fetchClaudeLimits, path: path}
	if got := broken.load(context.Background(), home, later); got != nil {
		t.Fatalf("with a broken file = %#v", got)
	}
}

func fakeJWT(expiresAt time.Time) string {
	payload, _ := json.Marshal(map[string]any{"exp": expiresAt.Unix()})
	return "eyJhbGciOiJub25lIn0." + base64.RawURLEncoding.EncodeToString(payload) + ".sig"
}

func writeCodexAuth(t *testing.T, home string, auth map[string]any) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(home, "auth.json"), mustJSON(t, auth), 0o600); err != nil {
		t.Fatalf("write auth: %v", err)
	}
}

func chatGPTAuth(token string) map[string]any {
	return map[string]any{
		"auth_mode":      "chatgpt",
		"OPENAI_API_KEY": nil,
		"tokens":         map[string]any{"access_token": token, "refresh_token": "refresh", "account_id": "acct-1"},
	}
}

// codexUsageServer answers like ChatGPT's usage endpoint, including fields
// that aren't read.
func codexUsageServer(t *testing.T, primary, secondary float64, now time.Time) (*httptest.Server, *[]*http.Request) {
	t.Helper()
	var requests []*http.Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r)
		w.Write(mustJSON(t, map[string]any{
			"plan_type": "plus",
			"rate_limit": map[string]any{
				"allowed":          true,
				"primary_window":   map[string]any{"used_percent": primary, "limit_window_seconds": 18000, "reset_at": now.Add(2 * time.Hour).Unix()},
				"secondary_window": map[string]any{"used_percent": secondary, "limit_window_seconds": 604800, "reset_at": now.Add(-time.Minute).Unix()},
			},
			"model_usage": map[string]any{"gpt-6-astra": map[string]any{"available": true}},
			"credits":     map[string]any{"has_credits": false, "approx_local_messages": []int{0, 0}},
		}))
	}))
	t.Cleanup(srv.Close)
	return srv, &requests
}

func TestFetchCodexLimitsReadsThePlanWindows(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	srv, requests := codexUsageServer(t, 3, 8, now)
	home := t.TempDir()
	token := fakeJWT(now.Add(24 * time.Hour))
	writeCodexAuth(t, home, chatGPTAuth(token))

	limits := fetchCodexLimits(context.Background(), srv.Client(), srv.URL, home, now)
	if limits == nil {
		t.Fatal("limits = nil")
	}
	req := (*requests)[0]
	if req.URL.Path != "/wham/usage" || req.Header.Get("Authorization") != "Bearer "+token || req.Header.Get("ChatGPT-Account-Id") != "acct-1" {
		t.Fatalf("request = %s %q %q", req.URL.Path, req.Header.Get("Authorization"), req.Header.Get("ChatGPT-Account-Id"))
	}
	assertLimitWindows(t, limits.Windows, []usageLimitWindow{
		{Key: "five_hour", Label: "5h", UsedPercent: 3, ResetsAt: now.Add(2 * time.Hour).Format(time.RFC3339)},
		// This window reset a minute ago, so nothing is used in the new one yet.
		{Key: "weekly", Label: "Week", UsedPercent: 0},
	})
}

func TestFetchCodexLimitsSkipsWithoutAChatGPTLogin(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	srv, requests := codexUsageServer(t, 3, 8, now)

	apiKey := t.TempDir()
	writeCodexAuth(t, apiKey, map[string]any{"OPENAI_API_KEY": "sk-test", "tokens": nil})
	expired := t.TempDir()
	writeCodexAuth(t, expired, chatGPTAuth(fakeJWT(now.Add(-time.Minute))))

	for name, home := range map[string]string{"no auth.json": t.TempDir(), "API key": apiKey, "expired token": expired} {
		if got := fetchCodexLimits(context.Background(), srv.Client(), srv.URL, home, now); got != nil {
			t.Fatalf("%s: limits = %#v", name, got)
		}
	}
	if len(*requests) != 0 {
		t.Fatalf("requests sent = %d, want 0", len(*requests))
	}
}

// Through a custom model provider Codex logs empty windows, so the logs only
// hold an old reading; the live one wins whenever it can be fetched.
func TestLoadCodexUsagePrefersLiveLimitsOverTheLogs(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	home := t.TempDir()
	writeSessionFile(t, filepath.Join(home, "sessions", "2026", "10", "07", "s.jsonl"), now,
		codexRateLimitLine(t, now.Add(-20*time.Hour).Format(time.RFC3339),
			map[string]any{"used_percent": 7.0, "window_minutes": 300, "resets_at": now.Add(-15 * time.Hour).Unix()},
			map[string]any{"used_percent": 2.0, "window_minutes": 10080, "resets_at": now.Add(100 * time.Hour).Unix()}),
		codexRateLimitLine(t, now.Add(-time.Hour).Format(time.RFC3339), nil, nil),
	)
	writeCodexAuth(t, home, chatGPTAuth(fakeJWT(now.Add(24*time.Hour))))

	original := codexLimits
	t.Cleanup(func() { codexLimits = original })

	srv, _ := codexUsageServer(t, 3, 8, now.Add(200*time.Hour))
	codexLimits = &liveLimitsSource{client: srv.Client(), apiBase: srv.URL, fetch: fetchCodexLimits}
	resp, err := loadCodexUsageContext(context.Background(), home, now)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if resp.Limits == nil || resp.Limits.ObservedAt != now.Format(time.RFC3339) || resp.Limits.Windows[1].UsedPercent != 8 {
		t.Fatalf("limits = %#v, want the live reading", resp.Limits)
	}

	// Without a live reading, the newest logged windows still show.
	codexLimits = &liveLimitsSource{client: srv.Client(), apiBase: "http://127.0.0.1:1", fetch: fetchCodexLimits}
	resp, err = loadCodexUsageContext(context.Background(), home, now)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if resp.Limits == nil || resp.Limits.Windows[1].UsedPercent != 2 {
		t.Fatalf("limits = %#v, want the logged reading", resp.Limits)
	}
}
