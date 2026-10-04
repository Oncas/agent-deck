package server

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Claude usage reads Claude Code's own transcripts, one JSONL file per session
// under <config dir>/projects/, and prices every API request in them. It shares
// the response shape, periods and cache with Codex usage.

type claudeUsageRate struct {
	input  float64 // $/MTok; cache writes are 1.25x (5m) and 2x (1h) of this
	read   float64 // cache hits and refreshes, $/MTok
	output float64
}

// https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-04).
// Estimates use current prices for all loaded history.
var claudeUsageRates = map[string]claudeUsageRate{
	"claude-fable-5-1":  {input: 10, read: 0.25, output: 50},
	"claude-mythos-5-1": {input: 10, read: 0.25, output: 50},
	"claude-fable-5":    {input: 10, read: 1, output: 50},
	"claude-mythos-5":   {input: 10, read: 1, output: 50},
	"claude-opus-5-5":   {input: 4, read: 0.20, output: 20},
	"claude-opus-5":     {input: 5, read: 0.50, output: 25},
	"claude-opus-4-8":   {input: 5, read: 0.50, output: 25},
	"claude-opus-4-7":   {input: 5, read: 0.50, output: 25},
	"claude-opus-4-6":   {input: 5, read: 0.50, output: 25},
	"claude-opus-4-5":   {input: 5, read: 0.50, output: 25},
	"claude-opus-4-1":   {input: 15, read: 1.50, output: 75},
	"claude-opus-4":     {input: 15, read: 1.50, output: 75},
	"claude-sonnet-5-5": {input: 2, read: 0.20, output: 10},
	"claude-sonnet-5":   {input: 2, read: 0.20, output: 10},
	"claude-sonnet-4-6": {input: 3, read: 0.30, output: 15},
	"claude-sonnet-4-5": {input: 3, read: 0.30, output: 15},
	"claude-sonnet-4":   {input: 3, read: 0.30, output: 15},
	"claude-haiku-4-5":  {input: 1, read: 0.10, output: 5},
	"claude-3-5-haiku":  {input: 0.80, read: 0.08, output: 4},
}

// Fast mode replaces the base input and output prices; cache multipliers apply
// on top of the fast input price, keeping each model's cache-read ratio.
var claudeUsageFastRates = map[string]claudeUsageRate{
	"claude-opus-5-5": {input: 8, output: 40},
	"claude-opus-5":   {input: 10, output: 50},
	"claude-opus-4-8": {input: 10, output: 50},
}

var claudeUsageDateSuffix = regexp.MustCompile(`-\d{8}$`)

type claudeUsageTokens struct {
	input        int64
	cacheWrite5m int64
	cacheWrite1h int64
	cacheRead    int64
	output       int64
	fast         bool
}

func claudeUsageModelRate(model string) (string, claudeUsageRate, bool) {
	model = claudeUsageDateSuffix.ReplaceAllString(model, "")
	rate, ok := claudeUsageRates[model]
	return model, rate, ok
}

func claudeUsageCost(model string, tokens claudeUsageTokens) float64 {
	model, rate, ok := claudeUsageModelRate(model)
	if !ok {
		return 0
	}
	if fast, ok := claudeUsageFastRates[model]; ok && tokens.fast {
		readRatio := rate.read / rate.input
		rate = claudeUsageRate{input: fast.input, read: fast.input * readRatio, output: fast.output}
	}
	return (float64(tokens.input)*rate.input +
		float64(tokens.cacheWrite5m)*rate.input*1.25 +
		float64(tokens.cacheWrite1h)*rate.input*2 +
		float64(tokens.cacheRead)*rate.read +
		float64(tokens.output)*rate.output) / 1_000_000
}

type claudeUsageLine struct {
	Type        string `json:"type"`
	Timestamp   string `json:"timestamp"`
	SessionID   string `json:"sessionId"`
	UUID        string `json:"uuid"`
	RequestID   string `json:"requestId"`
	IsMeta      bool   `json:"isMeta"`
	IsSidechain bool   `json:"isSidechain"`
	IsSummary   bool   `json:"isCompactSummary"`
	Message     struct {
		ID      string          `json:"id"`
		Model   string          `json:"model"`
		Content json.RawMessage `json:"content"`
		Usage   *struct {
			InputTokens         int64  `json:"input_tokens"`
			CacheCreationTokens int64  `json:"cache_creation_input_tokens"`
			CacheReadTokens     int64  `json:"cache_read_input_tokens"`
			OutputTokens        int64  `json:"output_tokens"`
			Speed               string `json:"speed"`
			CacheCreation       *struct {
				FiveMinute int64 `json:"ephemeral_5m_input_tokens"`
				OneHour    int64 `json:"ephemeral_1h_input_tokens"`
			} `json:"cache_creation"`
		} `json:"usage"`
	} `json:"message"`
}

func claudeUsageHome() (string, error) {
	if value := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR")); value != "" {
		return value, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".claude"), nil
}

// claudeUsageAccumulator adds Claude Code transcripts to the shared period
// totals. Resumed sessions copy earlier lines, so requests and prompts are
// counted once by id.
type claudeUsageAccumulator struct {
	*usageAccumulator
	seenRequests    map[string]struct{}
	seenMessages    map[string]struct{}
	sessionsCounted map[string]map[string]bool // session -> periods its conversation is counted in
}

func loadClaudeUsageContext(ctx context.Context, claudeHome string, now time.Time) (*usageResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	projectsDir := filepath.Join(claudeHome, "projects")
	info, err := os.Stat(projectsDir)
	if err != nil {
		return nil, fmt.Errorf("Claude Code projects directory not found: %s", projectsDir)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("Claude Code projects path is not a directory: %s", projectsDir)
	}

	periods := usagePeriods(now)
	acc := &claudeUsageAccumulator{
		usageAccumulator: newUsageAccumulator(periods),
		seenRequests:     map[string]struct{}{},
		seenMessages:     map[string]struct{}{},
		sessionsCounted:  map[string]map[string]bool{},
	}
	earliest := acc.earliest()

	if err := filepath.WalkDir(projectsDir, func(path string, entry os.DirEntry, err error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			return nil
		}
		fileInfo, err := entry.Info()
		if err != nil {
			return err
		}
		// A file untouched since the earliest period holds nothing in range.
		if fileInfo.ModTime().Before(earliest) {
			return nil
		}
		return scanClaudeUsageFile(ctx, path, acc)
	}); err != nil {
		return nil, err
	}

	return acc.response(now, claudeLimits.load(ctx, claudeHome, now)), nil
}

func scanClaudeUsageFile(ctx context.Context, path string, acc *claudeUsageAccumulator) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	// Subagent transcripts live under <session>/subagents/. Their requests cost
	// money, but their prompts were written by the main agent, not the user.
	subagent := strings.Contains(filepath.ToSlash(path), "/subagents/")

	reader := bufio.NewReader(file)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		line, readErr := reader.ReadBytes('\n')
		if len(line) > 0 {
			acc.addLine(line, subagent)
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

func (a *claudeUsageAccumulator) addLine(raw []byte, subagent bool) {
	var line claudeUsageLine
	if err := json.Unmarshal(raw, &line); err != nil {
		return
	}
	ts, err := parseUsageTimestamp(line.Timestamp)
	if err != nil {
		return
	}
	switch line.Type {
	case "assistant":
		usage := line.Message.Usage
		// Synthetic entries are placeholders Claude Code writes itself, such as
		// an interrupted turn, not API calls.
		if usage == nil || line.Message.Model == "<synthetic>" {
			return
		}
		// Claude Code writes one line per content block, each repeating the
		// request's usage, and resumed sessions copy earlier lines.
		key := line.Message.ID + "\x00" + line.RequestID
		if _, seen := a.seenRequests[key]; seen {
			return
		}
		a.seenRequests[key] = struct{}{}
		tokens := claudeUsageTokens{
			input:        usage.InputTokens,
			cacheWrite5m: usage.CacheCreationTokens,
			cacheRead:    usage.CacheReadTokens,
			output:       usage.OutputTokens,
			fast:         usage.Speed == "fast",
		}
		if split := usage.CacheCreation; split != nil && split.FiveMinute+split.OneHour > 0 {
			tokens.cacheWrite5m = split.FiveMinute
			tokens.cacheWrite1h = split.OneHour
		}
		_, _, priced := claudeUsageModelRate(line.Message.Model)
		a.addCost(ts, line.Message.Model, claudeUsageCost(line.Message.Model, tokens), priced)
	case "user":
		if subagent || line.IsSidechain || line.IsMeta || line.IsSummary || !claudeUsageTypedByUser(line.Message.Content) {
			return
		}
		if line.UUID != "" {
			if _, seen := a.seenMessages[line.UUID]; seen {
				return
			}
			a.seenMessages[line.UUID] = struct{}{}
		}
		session := line.SessionID
		if a.sessionsCounted[session] == nil {
			a.sessionsCounted[session] = map[string]bool{}
		}
		a.addUserMessage(ts, a.sessionsCounted[session])
	}
}

// claudeUsageTypedByUser reports whether a user entry is a prompt rather than
// tool results sent back to the model.
func claudeUsageTypedByUser(content json.RawMessage) bool {
	var text string
	if err := json.Unmarshal(content, &text); err == nil {
		return strings.TrimSpace(text) != ""
	}
	var blocks []struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(content, &blocks); err != nil {
		return false
	}
	hasText := false
	for _, block := range blocks {
		switch block.Type {
		case "tool_result":
			return false
		case "text":
			hasText = true
		}
	}
	return hasText
}
