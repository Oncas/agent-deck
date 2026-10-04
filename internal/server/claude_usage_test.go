package server

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// claudeTestLine builds one transcript line the way Claude Code writes it.
func claudeTestLine(t *testing.T, fields map[string]any) string {
	t.Helper()
	data, err := json.Marshal(fields)
	if err != nil {
		t.Fatalf("marshal line: %v", err)
	}
	return string(data)
}

func claudeAssistantLine(t *testing.T, ts, session, msgID, reqID, model string, usage map[string]any) string {
	return claudeTestLine(t, map[string]any{
		"type":      "assistant",
		"timestamp": ts,
		"sessionId": session,
		"requestId": reqID,
		"message":   map[string]any{"id": msgID, "model": model, "usage": usage},
	})
}

func claudeUserLine(t *testing.T, ts, session, uuid string, content any) string {
	return claudeTestLine(t, map[string]any{
		"type":      "user",
		"timestamp": ts,
		"sessionId": session,
		"uuid":      uuid,
		"message":   map[string]any{"role": "user", "content": content},
	})
}

func writeClaudeTranscript(t *testing.T, path string, lines ...string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatalf("write transcript: %v", err)
	}
}

func claudeUsagePeriodTotal(t *testing.T, resp *usageResponse, key string) *usageTotals {
	t.Helper()
	for _, period := range resp.Periods {
		if period.Key == key {
			return period.Total
		}
	}
	t.Fatalf("period %q missing", key)
	return nil
}

func assertCost(t *testing.T, label string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("%s cost = %.9f, want %.9f", label, got, want)
	}
}

func TestClaudeUsageCostUsesCacheAndSpeedRates(t *testing.T) {
	tests := []struct {
		name  string
		model string
		usage claudeUsageTokens
		want  float64
	}{
		{
			name:  "opus 5.5 with 1h cache write and cheap cache reads",
			model: "claude-opus-5-5",
			usage: claudeUsageTokens{input: 1_000_000, cacheWrite1h: 1_000_000, cacheRead: 1_000_000, output: 1_000_000},
			want:  4 + 8 + 0.20 + 20,
		},
		{
			name:  "sonnet 4.5 dated snapshot with 5m cache write",
			model: "claude-sonnet-4-5-20250929",
			usage: claudeUsageTokens{input: 1_000_000, cacheWrite5m: 1_000_000, cacheRead: 1_000_000, output: 1_000_000},
			want:  3 + 3.75 + 0.30 + 15,
		},
		{
			name:  "fable 5.1 cache reads at 0.025x",
			model: "claude-fable-5-1",
			usage: claudeUsageTokens{cacheRead: 1_000_000},
			want:  0.25,
		},
		{
			name:  "opus 5.5 fast mode doubles the base rates",
			model: "claude-opus-5-5",
			usage: claudeUsageTokens{input: 1_000_000, cacheWrite5m: 1_000_000, cacheRead: 1_000_000, output: 1_000_000, fast: true},
			want:  8 + 10 + 0.40 + 40,
		},
		{
			name:  "fast mode is ignored on models without it",
			model: "claude-sonnet-5-5",
			usage: claudeUsageTokens{output: 1_000_000, fast: true},
			want:  10,
		},
		{
			name:  "legacy haiku 3.5 id",
			model: "claude-3-5-haiku-20241022",
			usage: claudeUsageTokens{input: 1_000_000},
			want:  0.80,
		},
		{
			name:  "unknown models cost nothing",
			model: "<synthetic>",
			usage: claudeUsageTokens{input: 1_000_000, output: 1_000_000},
			want:  0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assertCost(t, tt.name, claudeUsageCost(tt.model, tt.usage), tt.want)
		})
	}
}

func TestLoadClaudeUsageCountsEachRequestOnceAndSplitsPeriods(t *testing.T) {
	loc := time.FixedZone("EEST", 3*60*60)
	// Wednesday 2026-10-07 15:00 local: week starts Monday 10-05, month on 10-01.
	now := time.Date(2026, 10, 7, 15, 0, 0, 0, loc)
	home := t.TempDir()
	projects := filepath.Join(home, "projects", "-home-user-app")

	usage := map[string]any{
		"input_tokens":                1_000,
		"cache_creation_input_tokens": 2_000,
		"cache_read_input_tokens":     3_000,
		"output_tokens":               4_000,
		"cache_creation":              map[string]any{"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 2_000},
	}
	requestCost := claudeUsageCost("claude-opus-5-5", claudeUsageTokens{input: 1_000, cacheWrite1h: 2_000, cacheRead: 3_000, output: 4_000})

	today := "2026-10-07T10:00:00Z"    // 13:00 local, today
	thisWeek := "2026-10-05T09:00:00Z" // Monday, this week
	thisMonth := "2026-10-02T09:00:00Z"
	lastMonth := "2026-09-28T09:00:00Z"

	writeClaudeTranscript(t, filepath.Join(projects, "s1.jsonl"),
		claudeUserLine(t, today, "s1", "u1", "fix the bug"),
		// Claude Code writes one line per content block, all with the same usage.
		claudeAssistantLine(t, today, "s1", "msg_a", "req_a", "claude-opus-5-5", usage),
		claudeAssistantLine(t, today, "s1", "msg_a", "req_a", "claude-opus-5-5", usage),
		claudeAssistantLine(t, today, "s1", "msg_a", "req_a", "claude-opus-5-5", usage),
		// Tool results and meta lines are not messages the user typed.
		claudeUserLine(t, today, "s1", "u2", []any{map[string]any{"type": "tool_result", "content": "ok"}}),
		claudeTestLine(t, map[string]any{"type": "user", "timestamp": today, "sessionId": "s1", "uuid": "u3", "isMeta": true,
			"message": map[string]any{"role": "user", "content": "caveat"}}),
		claudeUserLine(t, today, "s1", "u4", []any{map[string]any{"type": "text", "text": "and add a test"}}),
		claudeAssistantLine(t, today, "s1", "msg_b", "req_b", "<synthetic>", usage),
	)
	writeClaudeTranscript(t, filepath.Join(projects, "s2.jsonl"),
		claudeUserLine(t, thisWeek, "s2", "u5", "week task"),
		claudeAssistantLine(t, thisWeek, "s2", "msg_c", "req_c", "claude-opus-5-5", usage),
		claudeUserLine(t, thisMonth, "s2", "u6", "month task"),
		claudeAssistantLine(t, thisMonth, "s2", "msg_d", "req_d", "claude-opus-5-5", usage),
		claudeUserLine(t, lastMonth, "s2", "u7", "old task"),
		claudeAssistantLine(t, lastMonth, "s2", "msg_e", "req_e", "claude-opus-5-5", usage),
	)
	// A resumed session copies earlier lines into a new file; they must not count twice.
	writeClaudeTranscript(t, filepath.Join(projects, "s3.jsonl"),
		claudeUserLine(t, today, "s1", "u1", "fix the bug"),
		claudeAssistantLine(t, today, "s1", "msg_a", "req_a", "claude-opus-5-5", usage),
	)
	// Subagent work costs money but is not a conversation or a typed message.
	writeClaudeTranscript(t, filepath.Join(projects, "s1", "subagents", "agent-1.jsonl"),
		claudeTestLine(t, map[string]any{"type": "user", "timestamp": today, "sessionId": "s1", "uuid": "u8", "isSidechain": true,
			"message": map[string]any{"role": "user", "content": "subagent prompt"}}),
		claudeAssistantLine(t, today, "s1", "msg_f", "req_f", "claude-opus-5-5", usage),
	)

	resp, err := loadClaudeUsageContext(context.Background(), home, now)
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	todayTotal := claudeUsagePeriodTotal(t, resp, "today")
	assertCost(t, "today", todayTotal.Cost, 2*requestCost)
	if todayTotal.Messages != 2 || todayTotal.Conversations != 1 {
		t.Fatalf("today messages/conversations = %d/%d, want 2/1", todayTotal.Messages, todayTotal.Conversations)
	}

	week := claudeUsagePeriodTotal(t, resp, "week")
	assertCost(t, "week", week.Cost, 3*requestCost)
	if week.Messages != 3 || week.Conversations != 2 {
		t.Fatalf("week messages/conversations = %d/%d, want 3/2", week.Messages, week.Conversations)
	}

	month := claudeUsagePeriodTotal(t, resp, "month")
	assertCost(t, "month", month.Cost, 4*requestCost)
	if month.Messages != 4 || month.Conversations != 2 {
		t.Fatalf("month messages/conversations = %d/%d, want 4/2", month.Messages, month.Conversations)
	}
}

func TestLoadClaudeUsageTreatsUnsplitCacheWritesAsFiveMinute(t *testing.T) {
	now := time.Date(2026, 10, 7, 15, 0, 0, 0, time.UTC)
	home := t.TempDir()
	writeClaudeTranscript(t, filepath.Join(home, "projects", "p", "s.jsonl"),
		claudeAssistantLine(t, "2026-10-07T10:00:00Z", "s", "msg", "req", "claude-sonnet-5-5", map[string]any{
			"cache_creation_input_tokens": 1_000_000,
		}),
	)
	resp, err := loadClaudeUsageContext(context.Background(), home, now)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	assertCost(t, "today", claudeUsagePeriodTotal(t, resp, "today").Cost, 2.50)
}

func TestLoadClaudeUsageSkipsMalformedLines(t *testing.T) {
	now := time.Date(2026, 10, 7, 15, 0, 0, 0, time.UTC)
	home := t.TempDir()
	writeClaudeTranscript(t, filepath.Join(home, "projects", "p", "s.jsonl"),
		"{not json",
		claudeAssistantLine(t, "2026-10-07T10:00:00Z", "s", "msg", "req", "claude-haiku-4-5", map[string]any{"output_tokens": 1_000_000}),
		claudeAssistantLine(t, "not a time", "s", "msg2", "req2", "claude-haiku-4-5", map[string]any{"output_tokens": 1_000_000}),
	)
	resp, err := loadClaudeUsageContext(context.Background(), home, now)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	assertCost(t, "today", claudeUsagePeriodTotal(t, resp, "today").Cost, 5)
}

func TestLoadClaudeUsageReportsMissingProjectsDir(t *testing.T) {
	_, err := loadClaudeUsageContext(context.Background(), t.TempDir(), time.Now())
	if err == nil || !strings.Contains(err.Error(), "Claude Code projects directory not found") {
		t.Fatalf("err = %v, want missing projects directory", err)
	}
}

func TestClaudeUsageHomeHonoursConfigDir(t *testing.T) {
	t.Setenv("CLAUDE_CONFIG_DIR", "/custom/claude")
	got, err := claudeUsageHome()
	if err != nil || got != "/custom/claude" {
		t.Fatalf("claudeUsageHome() = %q, %v; want /custom/claude", got, err)
	}
}

func TestLoadClaudeUsageListsModelsWithoutAPrice(t *testing.T) {
	now := time.Date(2026, 10, 7, 15, 0, 0, 0, time.UTC)
	home := t.TempDir()
	usage := map[string]any{"output_tokens": 1_000}
	writeClaudeTranscript(t, filepath.Join(home, "projects", "p", "s.jsonl"),
		claudeAssistantLine(t, "2026-10-07T10:00:00Z", "s", "m1", "r1", "claude-future-9", usage),
		// Synthetic entries are placeholders Claude Code writes itself, not API calls.
		claudeAssistantLine(t, "2026-10-07T10:01:00Z", "s", "m2", "r2", "<synthetic>", usage),
	)
	resp, err := loadClaudeUsageContext(context.Background(), home, now)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := claudeUsagePeriodTotal(t, resp, "today").UnpricedModels; len(got) != 1 || got[0] != "claude-future-9" {
		t.Fatalf("unpriced models = %v, want [claude-future-9]", got)
	}
}
