package server

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type codexUsageRate struct {
	input       float64
	cached      float64
	output      float64
	longContext bool
}

// codexUsageAccumulator adds Codex's token snapshots, which a session repeats
// when it is resumed or forked, to the shared period totals.
type codexUsageAccumulator struct {
	*usageAccumulator
	seenTotals map[string]map[codexUsageTokenTotals]struct{}
}

type codexUsageTokenTotals struct {
	input  int64
	cached int64
	output int64
}

type codexUsageSessionIdentity struct {
	id           string
	forkedFromID string
	excludeUsage bool
}

type codexUsageSessionScope struct {
	id           string
	parentPath   string
	excludeUsage bool
}

type codexUsageReplayMatcher struct {
	reader *bufio.Reader
	active bool
}

type codexUsageLogTokenTotals struct {
	InputTokens       int64 `json:"input_tokens"`
	CachedInputTokens int64 `json:"cached_input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
}

type codexUsageLogEvent struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	Payload   struct {
		Type           string          `json:"type"`
		ID             string          `json:"id"`
		SessionID      string          `json:"session_id"`
		ForkedFromID   string          `json:"forked_from_id"`
		Model          string          `json:"model"`
		CWD            string          `json:"cwd"`
		Source         json.RawMessage `json:"source"`
		ThreadSource   string          `json:"thread_source"`
		ParentThreadID string          `json:"parent_thread_id"`
		Info           struct {
			TotalTokenUsage *codexUsageLogTokenTotals `json:"total_token_usage"`
			LastTokenUsage  codexUsageLogTokenTotals  `json:"last_token_usage"`
		} `json:"info"`
		Item struct {
			Type string `json:"type"`
		} `json:"item"`
	} `json:"payload"`
}

// Standard API prices in USD per million tokens, checked 2026-10-04:
// https://developers.openai.com/api/docs/pricing
// Sol's promotional prices are available at least through 2026-11-21.
// These estimates use current prices for all loaded history. Cache-write fees
// are excluded because the supported Codex token_count schema has no write count.
var codexUsageRates = map[string]codexUsageRate{
	"gpt-6-astra":        {input: 10.00, cached: 1.00, output: 50.00, longContext: true},
	"gpt-6.1-sol":        {input: 2.00, cached: 0.10, output: 10.00, longContext: true},
	"gpt-6-sol":          {input: 2.00, cached: 0.20, output: 10.00, longContext: true},
	"gpt-6-luna":         {input: 0.10, cached: 0.01, output: 0.50, longContext: true},
	"gpt-5.6":            {input: 4.00, cached: 0.40, output: 20.00, longContext: true},
	"gpt-5.6-sol":        {input: 4.00, cached: 0.40, output: 20.00, longContext: true},
	"gpt-5.6-terra":      {input: 2.00, cached: 0.20, output: 12.00, longContext: true},
	"gpt-5.6-luna":       {input: 0.20, cached: 0.02, output: 1.20, longContext: true},
	"gpt-5.5":            {input: 5.00, cached: 0.50, output: 30.00, longContext: true},
	"gpt-5.4":            {input: 2.50, cached: 0.25, output: 15.00, longContext: true},
	"gpt-5.4-mini":       {input: 0.75, cached: 0.075, output: 4.50},
	"gpt-5.4-nano":       {input: 0.20, cached: 0.02, output: 1.25},
	"gpt-5.3-codex":      {input: 1.75, cached: 0.175, output: 14.00},
	"gpt-5.2-codex":      {input: 1.75, cached: 0.175, output: 14.00},
	"gpt-5.2":            {input: 1.75, cached: 0.175, output: 14.00},
	"gpt-5.1-codex":      {input: 1.25, cached: 0.125, output: 10.00},
	"gpt-5.1-codex-max":  {input: 1.25, cached: 0.125, output: 10.00},
	"gpt-5.1":            {input: 1.25, cached: 0.125, output: 10.00},
	"gpt-5-codex":        {input: 1.25, cached: 0.125, output: 10.00},
	"gpt-5":              {input: 1.25, cached: 0.125, output: 10.00},
	"gpt-5-mini":         {input: 0.25, cached: 0.025, output: 2.00},
	"gpt-5.1-codex-mini": {input: 0.25, cached: 0.025, output: 2.00},
	"gpt-5-nano":         {input: 0.05, cached: 0.005, output: 0.40},
	"codex-mini-latest":  {input: 1.50, cached: 0.375, output: 6.00},
}

func codexUsageHome() (string, error) {
	if value := strings.TrimSpace(os.Getenv("CODEX_HOME")); value != "" {
		return value, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".codex"), nil
}

func loadCodexUsageContext(ctx context.Context, codexHome string, now time.Time) (*usageResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	sessionsDir := filepath.Join(codexHome, "sessions")
	info, err := os.Stat(sessionsDir)
	if err != nil {
		return nil, fmt.Errorf("Codex sessions directory not found: %s", sessionsDir)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("Codex sessions path is not a directory: %s", sessionsDir)
	}

	periods := usagePeriods(now)
	acc := newCodexUsageAccumulator(periods)
	if err := scanCodexUsageSessions(ctx, sessionsDir, now, acc); err != nil {
		return nil, err
	}

	// The live reading is current even through a custom model provider; the
	// logs cover API keys and failed fetches. Limits are a bonus on top of
	// cost, so a log that can't be read for them doesn't hide the cost table.
	logged, _ := latestCodexLimits(sessionsDir, now)
	return acc.response(now, newerUsageLimits(codexLimits.load(ctx, codexHome, now), logged)), nil
}

func newCodexUsageAccumulator(periods []usagePeriodSpec) *codexUsageAccumulator {
	return &codexUsageAccumulator{
		usageAccumulator: newUsageAccumulator(periods),
		seenTotals:       map[string]map[codexUsageTokenTotals]struct{}{},
	}
}

func scanCodexUsageSessions(ctx context.Context, sessionsDir string, now time.Time, acc *codexUsageAccumulator) error {
	earliestPeriod := acc.earliest()

	paths := []string{}
	scanPaths := []string{}
	if err := filepath.WalkDir(sessionsDir, func(path string, entry os.DirEntry, err error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			return nil
		}
		paths = append(paths, path)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.ModTime().Before(earliestPeriod) {
			scanPaths = append(scanPaths, path)
		}
		return nil
	}); err != nil {
		return err
	}
	sort.Strings(paths)
	sort.Strings(scanPaths)
	scopes, err := codexUsageSessionScopes(ctx, paths)
	if err != nil {
		return err
	}
	for _, path := range scanPaths {
		if err := ctx.Err(); err != nil {
			return err
		}
		scope := scopes[path]
		if scope.excludeUsage {
			continue
		}
		if err := scanCodexUsageSessionFile(ctx, path, scope, now, acc); err != nil {
			return err
		}
	}
	return nil
}

func codexUsageSessionScopes(ctx context.Context, paths []string) (map[string]codexUsageSessionScope, error) {
	identities := make(map[string]codexUsageSessionIdentity, len(paths))
	pathsByID := make(map[string]string, len(paths))
	for _, path := range paths {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		identity, err := readCodexUsageSessionIdentity(ctx, path)
		if err != nil {
			return nil, err
		}
		identities[path] = identity
		if identity.id != "" {
			if _, exists := pathsByID[identity.id]; !exists {
				pathsByID[identity.id] = path
			}
		}
	}

	scopes := make(map[string]codexUsageSessionScope, len(paths))
	for _, path := range paths {
		identity := identities[path]
		id := identity.id
		if id == "" {
			id = path
		}
		scopes[path] = codexUsageSessionScope{
			id:           id,
			parentPath:   pathsByID[identity.forkedFromID],
			excludeUsage: identity.excludeUsage,
		}
	}
	return scopes, nil
}

func readCodexUsageSessionIdentity(ctx context.Context, path string) (codexUsageSessionIdentity, error) {
	f, err := os.Open(path)
	if err != nil {
		return codexUsageSessionIdentity{}, err
	}
	defer f.Close()

	reader := bufio.NewReader(f)
	for {
		if err := ctx.Err(); err != nil {
			return codexUsageSessionIdentity{}, err
		}
		raw, err := reader.ReadString('\n')
		if err != nil && err != io.EOF {
			return codexUsageSessionIdentity{}, fmt.Errorf("%s: read Codex session metadata: %w", path, err)
		}
		line := strings.TrimSpace(raw)
		if line != "" {
			var event codexUsageLogEvent
			if json.Unmarshal([]byte(line), &event) == nil {
				if event.Type != "session_meta" {
					return codexUsageSessionIdentity{}, nil
				}
				id := strings.TrimSpace(event.Payload.ID)
				if id == "" {
					id = strings.TrimSpace(event.Payload.SessionID)
				}
				return codexUsageSessionIdentity{
					id:           id,
					forkedFromID: strings.TrimSpace(event.Payload.ForkedFromID),
					excludeUsage: codexUsageIsNonRootSession(event.Payload.Source, event.Payload.ThreadSource, event.Payload.ParentThreadID),
				}, nil
			}
		}
		if err == io.EOF {
			return codexUsageSessionIdentity{}, nil
		}
	}
}

func scanCodexUsageSessionFile(ctx context.Context, path string, scope codexUsageSessionScope, now time.Time, acc *codexUsageAccumulator) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	var matcher *codexUsageReplayMatcher
	if scope.parentPath != "" {
		// A persisted fork starts with its own metadata and then reserializes a
		// prefix of the parent rollout. Compare that prefix instead of timestamps,
		// which Codex rewrites while copying it.
		parent, err := os.Open(scope.parentPath)
		if err != nil {
			return err
		}
		defer parent.Close()
		matcher = &codexUsageReplayMatcher{reader: bufio.NewReader(parent), active: true}
	}

	return scanCodexUsageSessionReader(ctx, f, path, scope, matcher, now, acc)
}

func scanCodexUsageSessionReader(ctx context.Context, r io.Reader, name string, scope codexUsageSessionScope, matcher *codexUsageReplayMatcher, now time.Time, acc *codexUsageAccumulator) error {
	reader := bufio.NewReader(r)

	model := "unknown"
	ready := false
	nonRootSession := false
	previousUsage := codexUsageTokenTotals{}
	hasPreviousUsage := false
	conversationPeriods := map[string]bool{}
	firstRolloutItem := true
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		raw, err := reader.ReadString('\n')
		if err != nil && err != io.EOF {
			return fmt.Errorf("%s: read Codex session: %w", name, err)
		}
		if raw == "" && err == io.EOF {
			break
		}
		line := strings.TrimSpace(raw)
		if line == "" {
			if err == io.EOF {
				break
			}
			continue
		}
		var event codexUsageLogEvent
		if json.Unmarshal([]byte(line), &event) != nil {
			if err == io.EOF {
				break
			}
			continue
		}
		replayed := false
		if matcher != nil && matcher.active {
			if replayKey, comparable := codexUsageReplayKey(line); comparable {
				if firstRolloutItem {
					firstRolloutItem = false
				} else {
					replayed, err = matcher.matches(ctx, replayKey)
					if err != nil {
						return fmt.Errorf("%s: compare forked Codex history: %w", name, err)
					}
				}
			}
		}

		switch event.Type {
		case "session_meta":
			model = "unknown"
			ready = false
			nonRootSession = nonRootSession || codexUsageIsNonRootSession(event.Payload.Source, event.Payload.ThreadSource, event.Payload.ParentThreadID)
			hasPreviousUsage = false
		case "turn_context":
			model = strings.ToLower(strings.TrimSpace(event.Payload.Model))
			if model == "" {
				model = "unknown"
			}
			ready = true
			hasPreviousUsage = false
		case "event_msg":
			if codexUsageIsUserMessageEvent(event) {
				if nonRootSession {
					continue
				}
				ts, err := parseUsageTimestamp(event.Timestamp)
				if err == nil && ts.Before(now) {
					acc.addUserMessage(ts, conversationPeriods)
				}
				continue
			}
			if !ready || nonRootSession || event.Payload.Type != "token_count" {
				continue
			}
			ts, err := parseUsageTimestamp(event.Timestamp)
			if err != nil {
				continue
			}
			if !ts.Before(now) {
				continue
			}
			usage := event.Payload.Info.LastTokenUsage
			current := codexUsageTokenTotals{
				input:  usage.InputTokens,
				cached: usage.CachedInputTokens,
				output: usage.OutputTokens,
			}
			var cumulative *codexUsageTokenTotals
			if total := event.Payload.Info.TotalTokenUsage; total != nil {
				value := codexUsageTokenTotals{
					input:  total.InputTokens,
					cached: total.CachedInputTokens,
					output: total.OutputTokens,
				}
				cumulative = &value
			}
			if cumulative == nil && hasPreviousUsage && current == previousUsage {
				continue
			}
			previousUsage = current
			hasPreviousUsage = true
			acc.addTokenSnapshot(ts, scope.id, model, current, cumulative, replayed)
		}
		if err == io.EOF {
			break
		}
	}
	return nil
}

func codexUsageIsUserMessageEvent(event codexUsageLogEvent) bool {
	if event.Type != "event_msg" {
		return false
	}
	if event.Payload.Type == "user_message" {
		return true
	}
	return event.Payload.Type == "item_completed" &&
		strings.EqualFold(strings.TrimSpace(event.Payload.Item.Type), "userMessage")
}

func (m *codexUsageReplayMatcher) matches(ctx context.Context, lineKey string) (bool, error) {
	if !m.active {
		return false, nil
	}
	for {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		raw, err := m.reader.ReadString('\n')
		if err != nil && err != io.EOF {
			return false, err
		}
		parentLine := strings.TrimSpace(raw)
		if parentLine == "" {
			if err == io.EOF {
				m.active = false
				return false, nil
			}
			continue
		}
		parentKey, comparable := codexUsageReplayKey(parentLine)
		if !comparable {
			if err == io.EOF {
				m.active = false
				return false, nil
			}
			continue
		}
		if parentKey != lineKey {
			m.active = false
			return false, nil
		}
		return true, nil
	}
}

func codexUsageReplayKey(line string) (string, bool) {
	var kind struct {
		Type string `json:"type"`
	}
	if json.Unmarshal([]byte(line), &kind) != nil {
		return "", false
	}
	switch kind.Type {
	case "session_meta", "response_item", "event_msg":
	default:
		return "", false
	}

	var envelope struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	if json.Unmarshal([]byte(line), &envelope) != nil {
		return "", false
	}
	payload := envelope.Payload
	switch envelope.Type {
	case "session_meta":
		var meta struct {
			ID        string `json:"id"`
			SessionID string `json:"session_id"`
		}
		if json.Unmarshal(payload, &meta) != nil {
			return "", false
		}
		id := strings.TrimSpace(meta.ID)
		if id == "" {
			id = strings.TrimSpace(meta.SessionID)
		}
		// Older metadata gains session_id and other defaults when Codex loads and
		// reserializes it into a fork. The thread ID is the stable identity.
		return envelope.Type + "\x00" + id, true
	case "response_item":
		var item struct {
			Type    string          `json:"type"`
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		}
		if json.Unmarshal(payload, &item) != nil || item.Type != "message" {
			return "", false
		}
		// Fork persistence can assign an ID to older messages. Role and content
		// are the stable turn boundary used to distinguish replay from new work.
		return envelope.Type + "\x00" + item.Role + "\x00" + string(item.Content), true
	case "event_msg":
		var event codexUsageLogEvent
		if json.Unmarshal([]byte(line), &event) != nil {
			return "", false
		}
		if event.Payload.Type == "thread_settings_applied" {
			return envelope.Type + "\x00" + event.Payload.Type, true
		}
		if event.Payload.Type != "token_count" {
			return "", false
		}
		last := event.Payload.Info.LastTokenUsage
		// Older token events can gain cumulative totals when Codex reserializes
		// them into a fork. Last-token usage remains stable across that copy.
		return fmt.Sprintf("%s\x00%d,%d,%d", envelope.Type, last.InputTokens, last.CachedInputTokens, last.OutputTokens), true
	default:
		return "", false
	}
}

func codexUsageIsNonRootSession(source json.RawMessage, threadSource, parentThreadID string) bool {
	if strings.EqualFold(strings.TrimSpace(threadSource), "subagent") || strings.TrimSpace(parentThreadID) != "" {
		return true
	}
	var kind map[string]json.RawMessage
	if json.Unmarshal(source, &kind) != nil {
		return false
	}
	_, subagent := kind["subagent"]
	_, internal := kind["internal"]
	return subagent || internal
}

func (a *codexUsageAccumulator) addTokenSnapshot(ts time.Time, sessionID, model string, last codexUsageTokenTotals, total *codexUsageTokenTotals, replayed bool) {
	if total != nil {
		if _, exists := a.seenTotals[sessionID][*total]; exists {
			return
		}
		if a.seenTotals[sessionID] == nil {
			a.seenTotals[sessionID] = map[codexUsageTokenTotals]struct{}{}
		}
		a.seenTotals[sessionID][*total] = struct{}{}
	}
	if replayed {
		return
	}
	a.add(ts, model, last.input, last.cached, last.output)
}

func (a *codexUsageAccumulator) add(ts time.Time, model string, input, cached, output int64) {
	// The long-context threshold applies to each request, before period totals.
	_, priced := codexUsageModelRate(model)
	a.addCost(ts, model, codexUsageCost(model, input, cached, output), priced)
}

func codexUsageModelRate(model string) (codexUsageRate, bool) {
	rate, ok := codexUsageRates[model]
	if !ok && len(model) > len("-2006-01-02") {
		// Dated snapshots use their base model's rates; other variants must match
		// explicitly so a differently priced model cannot inherit a prefix rate.
		suffix := model[len(model)-len("-2006-01-02"):]
		if _, err := time.Parse("-2006-01-02", suffix); err == nil {
			rate, ok = codexUsageRates[strings.TrimSuffix(model, suffix)]
		}
	}
	return rate, ok
}

func codexUsageCost(model string, input, cached, output int64) float64 {
	rate, ok := codexUsageModelRate(model)
	if !ok {
		return 0
	}
	if rate.longContext && input > 272_000 {
		rate.input *= 2
		rate.cached *= 2
		rate.output *= 1.5
	}
	billable := max(input-cached, 0)
	return (float64(billable)*rate.input + float64(cached)*rate.cached + float64(output)*rate.output) / 1_000_000
}
