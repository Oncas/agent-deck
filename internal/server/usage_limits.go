package server

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Plan usage limits: the rolling 5-hour and weekly windows that ChatGPT and
// Claude subscriptions put on Codex and Claude Code. API-key use has no such
// windows, so these stay empty there.

type usageLimits struct {
	ObservedAt string             `json:"observed_at"`
	Windows    []usageLimitWindow `json:"windows"`
}

type usageLimitWindow struct {
	Key         string  `json:"key"`
	Label       string  `json:"label"`
	UsedPercent float64 `json:"used_percent"`
	ResetsAt    string  `json:"resets_at,omitempty"`
}

func cloneUsageLimits(src *usageLimits) *usageLimits {
	if src == nil {
		return nil
	}
	dst := *src
	dst.Windows = append([]usageLimitWindow(nil), src.Windows...)
	return &dst
}

// newUsageLimitWindow reports a window as unused once its reset time has
// passed, since the snapshot predates the new window.
func newUsageLimitWindow(minutes int, usedPercent float64, resetsAt time.Time, now time.Time) usageLimitWindow {
	window := usageLimitWindow{UsedPercent: usedPercent}
	switch {
	case minutes == 300:
		window.Key, window.Label = "five_hour", "5h"
	case minutes == 7*24*60:
		window.Key, window.Label = "weekly", "Week"
	case minutes%(24*60) == 0:
		window.Key, window.Label = fmt.Sprintf("window_%dm", minutes), fmt.Sprintf("%dd", minutes/(24*60))
	default:
		window.Key, window.Label = fmt.Sprintf("window_%dm", minutes), fmt.Sprintf("%dh", (minutes+59)/60)
	}
	if resetsAt.IsZero() {
		return window
	}
	if !resetsAt.After(now) {
		window.UsedPercent = 0
		return window
	}
	window.ResetsAt = resetsAt.UTC().Format(time.RFC3339)
	return window
}

type codexRateLimitWindow struct {
	UsedPercent     *float64 `json:"used_percent"`
	WindowMinutes   int      `json:"window_minutes"`
	ResetsAt        *int64   `json:"resets_at"`
	ResetsInSeconds *int64   `json:"resets_in_seconds"`
}

type codexRateLimitEvent struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	Payload   struct {
		Type       string `json:"type"`
		RateLimits *struct {
			Primary   *codexRateLimitWindow `json:"primary"`
			Secondary *codexRateLimitWindow `json:"secondary"`
		} `json:"rate_limits"`
	} `json:"payload"`
}

// latestCodexLimits returns the most recent windows Codex logged. Codex writes
// them with every token count while signed in with ChatGPT; API-key sessions
// log empty windows, which are skipped so they don't hide the last real ones.
func latestCodexLimits(sessionsDir string, now time.Time) (*usageLimits, error) {
	type candidate struct {
		path    string
		modTime time.Time
	}
	// The weekly window is the longest, so older files can't hold a live one.
	oldest := now.Add(-8 * 24 * time.Hour)
	var files []candidate
	err := filepath.WalkDir(sessionsDir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.ModTime().Before(oldest) {
			files = append(files, candidate{path: path, modTime: info.ModTime()})
		}
		return nil
	})
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].modTime.After(files[j].modTime) })

	for _, file := range files {
		limits, err := lastCodexLimitsInFile(file.path, now)
		if err != nil {
			return nil, err
		}
		if limits != nil {
			return limits, nil
		}
	}
	return nil, nil
}

func lastCodexLimitsInFile(path string, now time.Time) (*usageLimits, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var latest *usageLimits
	reader := bufio.NewReader(file)
	for {
		line, readErr := reader.ReadBytes('\n')
		if len(line) > 0 && strings.Contains(string(line), `"rate_limits"`) {
			if limits := parseCodexLimitsLine(line, now); limits != nil {
				latest = limits
			}
		}
		if readErr == io.EOF {
			return latest, nil
		}
		if readErr != nil {
			return nil, readErr
		}
	}
}

func parseCodexLimitsLine(line []byte, now time.Time) *usageLimits {
	var event codexRateLimitEvent
	if err := json.Unmarshal(line, &event); err != nil || event.Payload.RateLimits == nil {
		return nil
	}
	ts, err := parseUsageTimestamp(event.Timestamp)
	if err != nil {
		return nil
	}
	limits := &usageLimits{ObservedAt: ts.UTC().Format(time.RFC3339)}
	for _, window := range []*codexRateLimitWindow{event.Payload.RateLimits.Primary, event.Payload.RateLimits.Secondary} {
		if window == nil || window.UsedPercent == nil || window.WindowMinutes <= 0 {
			continue
		}
		var resetsAt time.Time
		switch {
		case window.ResetsAt != nil:
			resetsAt = time.Unix(*window.ResetsAt, 0)
		case window.ResetsInSeconds != nil:
			resetsAt = ts.Add(time.Duration(*window.ResetsInSeconds) * time.Second)
		}
		limits.Windows = append(limits.Windows, newUsageLimitWindow(window.WindowMinutes, *window.UsedPercent, resetsAt, now))
	}
	if len(limits.Windows) == 0 {
		return nil
	}
	return limits
}

// Live plan limits. Claude Code and Codex each read their plan windows from
// an undocumented usage endpoint with the login they save locally; Agent Deck
// asks the same endpoints with those logins, so the limits appear without any
// setup. A failure only means no fresh reading.

var limitsHTTPClient = &http.Client{Timeout: 10 * time.Second}

var claudeLimits = &liveLimitsSource{
	client:  limitsHTTPClient,
	apiBase: "https://api.anthropic.com",
	fetch:   fetchClaudeLimits,
}

var codexLimits = &liveLimitsSource{
	client:  limitsHTTPClient,
	apiBase: "https://chatgpt.com/backend-api",
	fetch:   fetchCodexLimits,
}

type limitsFetcher func(ctx context.Context, client *http.Client, apiBase, home string, now time.Time) *usageLimits

// liveLimitsSource keeps the last reading per CLI data dir. Tokens expire
// while the CLI isn't running and the endpoints rate-limit, so a failed fetch
// falls back to that reading; its observed_at lets the panel mark it as old.
type liveLimitsSource struct {
	client  *http.Client
	apiBase string
	fetch   limitsFetcher

	mu   sync.Mutex
	last map[string]*usageLimits
}

func (s *liveLimitsSource) load(ctx context.Context, home string, now time.Time) *usageLimits {
	fresh := s.fetch(ctx, s.client, s.apiBase, home, now)
	s.mu.Lock()
	defer s.mu.Unlock()
	if fresh != nil {
		if s.last == nil {
			s.last = map[string]*usageLimits{}
		}
		s.last[home] = fresh
		return cloneUsageLimits(fresh)
	}
	last := cloneUsageLimits(s.last[home])
	if last == nil {
		return nil
	}
	for i, window := range last.Windows {
		if resetsAt, err := time.Parse(time.RFC3339, window.ResetsAt); err == nil && !resetsAt.After(now) {
			last.Windows[i].UsedPercent = 0
			last.Windows[i].ResetsAt = ""
		}
	}
	return last
}

// newerUsageLimits returns whichever reading was observed later.
func newerUsageLimits(a, b *usageLimits) *usageLimits {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	aAt, _ := time.Parse(time.RFC3339, a.ObservedAt)
	bAt, _ := time.Parse(time.RFC3339, b.ObservedAt)
	if bAt.After(aAt) {
		return b
	}
	return a
}

// getLimitsJSON sends an authorized GET and decodes a 200 response into out.
func getLimitsJSON(ctx context.Context, client *http.Client, url, token string, headers map[string]string, out any) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+token)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out) == nil
}

// claudeOAuthToken returns the access token Claude Code saved at login, or ""
// when there is none or it has expired. Renewing it is left to Claude Code.
func claudeOAuthToken(claudeHome string, now time.Time) string {
	data, err := os.ReadFile(filepath.Join(claudeHome, ".credentials.json"))
	if err != nil {
		return ""
	}
	var creds struct {
		OAuth *struct {
			AccessToken string `json:"accessToken"`
			ExpiresAt   int64  `json:"expiresAt"` // Unix milliseconds
		} `json:"claudeAiOauth"`
	}
	if json.Unmarshal(data, &creds) != nil || creds.OAuth == nil {
		return ""
	}
	if creds.OAuth.ExpiresAt > 0 && !time.UnixMilli(creds.OAuth.ExpiresAt).After(now) {
		return ""
	}
	return strings.TrimSpace(creds.OAuth.AccessToken)
}

// fetchClaudeLimits asks the endpoint behind Claude Code's /usage.
func fetchClaudeLimits(ctx context.Context, client *http.Client, apiBase, claudeHome string, now time.Time) *usageLimits {
	token := claudeOAuthToken(claudeHome, now)
	if token == "" {
		return nil
	}
	// The response carries many other fields of varying shapes; only these
	// two windows are read.
	type window struct {
		Utilization *float64 `json:"utilization"`
		ResetsAt    string   `json:"resets_at"`
	}
	var body struct {
		FiveHour *window `json:"five_hour"`
		SevenDay *window `json:"seven_day"`
	}
	url := strings.TrimRight(apiBase, "/") + "/api/oauth/usage"
	if !getLimitsJSON(ctx, client, url, token, map[string]string{"anthropic-beta": "oauth-2025-04-20"}, &body) {
		return nil
	}
	limits := &usageLimits{ObservedAt: now.UTC().Format(time.RFC3339)}
	for _, entry := range []struct {
		window  *window
		minutes int
	}{{body.FiveHour, 300}, {body.SevenDay, 7 * 24 * 60}} {
		if entry.window == nil || entry.window.Utilization == nil {
			continue
		}
		resetsAt, _ := time.Parse(time.RFC3339Nano, entry.window.ResetsAt)
		limits.Windows = append(limits.Windows, newUsageLimitWindow(entry.minutes, *entry.window.Utilization, resetsAt, now))
	}
	if len(limits.Windows) == 0 {
		return nil
	}
	return limits
}

// codexChatGPTLogin returns the ChatGPT access token and account Codex saved
// at login, or "" when it uses an API key or the token has expired. Renewing
// it is left to Codex.
func codexChatGPTLogin(codexHome string, now time.Time) (token, accountID string) {
	data, err := os.ReadFile(filepath.Join(codexHome, "auth.json"))
	if err != nil {
		return "", ""
	}
	var auth struct {
		Tokens *struct {
			AccessToken string `json:"access_token"`
			AccountID   string `json:"account_id"`
		} `json:"tokens"`
	}
	if json.Unmarshal(data, &auth) != nil || auth.Tokens == nil {
		return "", ""
	}
	token = strings.TrimSpace(auth.Tokens.AccessToken)
	if expiresAt, ok := jwtExpiry(token); ok && !expiresAt.After(now) {
		return "", ""
	}
	return token, strings.TrimSpace(auth.Tokens.AccountID)
}

// jwtExpiry reads a JWT's exp claim without verifying the token, which only
// the server that issued it can do.
func jwtExpiry(token string) (time.Time, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return time.Time{}, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return time.Time{}, false
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if json.Unmarshal(payload, &claims) != nil || claims.Exp == 0 {
		return time.Time{}, false
	}
	return time.Unix(claims.Exp, 0), true
}

// fetchCodexLimits asks the endpoint behind Codex's /status. Codex also logs
// the windows with each reply, but only while it talks to OpenAI itself:
// through a custom model provider they come back empty.
func fetchCodexLimits(ctx context.Context, client *http.Client, apiBase, codexHome string, now time.Time) *usageLimits {
	token, accountID := codexChatGPTLogin(codexHome, now)
	if token == "" {
		return nil
	}
	type window struct {
		UsedPercent   *float64 `json:"used_percent"`
		WindowSeconds int      `json:"limit_window_seconds"`
		ResetAt       int64    `json:"reset_at"`
	}
	var body struct {
		RateLimit *struct {
			Primary   *window `json:"primary_window"`
			Secondary *window `json:"secondary_window"`
		} `json:"rate_limit"`
	}
	headers := map[string]string{}
	if accountID != "" {
		headers["ChatGPT-Account-Id"] = accountID
	}
	url := strings.TrimRight(apiBase, "/") + "/wham/usage"
	if !getLimitsJSON(ctx, client, url, token, headers, &body) || body.RateLimit == nil {
		return nil
	}
	limits := &usageLimits{ObservedAt: now.UTC().Format(time.RFC3339)}
	for _, w := range []*window{body.RateLimit.Primary, body.RateLimit.Secondary} {
		if w == nil || w.UsedPercent == nil || w.WindowSeconds <= 0 {
			continue
		}
		var resetsAt time.Time
		if w.ResetAt > 0 {
			resetsAt = time.Unix(w.ResetAt, 0)
		}
		limits.Windows = append(limits.Windows, newUsageLimitWindow(w.WindowSeconds/60, *w.UsedPercent, resetsAt, now))
	}
	if len(limits.Windows) == 0 {
		return nil
	}
	return limits
}
