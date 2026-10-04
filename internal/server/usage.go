package server

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	_ "time/tzdata"
)

// Usage tracking for the AI CLIs: each provider reads its CLI's local logs
// into the same response of costs and message counts per period, plus its plan
// limits when it can find them. The right panel renders every provider the
// same way.

// usageProvider is one CLI whose usage the right panel can show. Adding one
// means writing its loader and listing it here; it then gets the route
// GET /api/<name>/usage and its own cache. The name matches the provider id in
// the frontend's USAGE_PROVIDERS.
type usageProvider struct {
	name string
	home func() (string, error) // the CLI's data directory
	load usageLoader
}

var usageProviders = []usageProvider{
	{name: "claude", home: claudeUsageHome, load: loadClaudeUsageContext},
	{name: "codex", home: codexUsageHome, load: loadCodexUsageContext},
}

func newUsageCoordinators() map[string]*usageCoordinator {
	coordinators := make(map[string]*usageCoordinator, len(usageProviders))
	for _, provider := range usageProviders {
		coordinators[provider.name] = &usageCoordinator{loader: provider.load}
	}
	return coordinators
}

// handleUsage serves one provider's usage. ?tz= sets the day boundaries and
// ?fresh=1 skips the cache.
func handleUsage(home func() (string, error), usage *usageCoordinator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dir, err := home()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		now, err := usageRequestTime(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		resp, err := usage.load(r.Context(), dir, now, r.URL.Query().Get("fresh") == "1")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, resp)
	}
}

type usageResponse struct {
	FetchedAt string        `json:"fetched_at"`
	Periods   []usagePeriod `json:"periods"`
	Limits    *usageLimits  `json:"limits,omitempty"`
}

const usageCacheTTL = 5 * time.Minute

type usageLoader func(context.Context, string, time.Time) (*usageResponse, error)

type usageCacheEntry struct {
	response   *usageResponse
	storedAt   time.Time
	generation uint64
}

type usageCall struct {
	done       chan struct{}
	response   *usageResponse
	err        error
	cancel     context.CancelFunc
	waiters    int
	generation uint64
}

type usageCoordinator struct {
	mu             sync.Mutex
	cache          map[string]usageCacheEntry
	inFlight       map[string]*usageCall
	loader         usageLoader
	nextGeneration uint64
}

type usagePeriod struct {
	Key   string       `json:"key"`
	Label string       `json:"label"`
	Start string       `json:"start"`
	End   string       `json:"end"`
	Total *usageTotals `json:"total,omitempty"`
}

type usageTotals struct {
	Cost          float64 `json:"cost"`
	Conversations int     `json:"conversations"`
	Messages      int     `json:"messages"`
	// Models used in the period that have no known price, so Cost leaves
	// their tokens out.
	UnpricedModels []string `json:"unpriced_models,omitempty"`
}

type usagePeriodSpec struct {
	key   string
	label string
	start time.Time
}

func (c *usageCoordinator) load(ctx context.Context, home string, now time.Time, fresh bool) (*usageResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	key := usageCacheKey(home, now)

	c.mu.Lock()
	if !fresh {
		if entry, ok := c.cache[key]; ok && time.Since(entry.storedAt) < usageCacheTTL {
			resp := cloneUsageResponse(entry.response)
			c.mu.Unlock()
			return resp, nil
		}
	}
	if call := c.inFlight[key]; call != nil {
		call.waiters++
		c.mu.Unlock()
		return c.wait(ctx, key, call)
	}
	if c.inFlight == nil {
		c.inFlight = make(map[string]*usageCall)
	}
	loadCtx, cancel := context.WithCancel(context.Background())
	c.nextGeneration++
	call := &usageCall{
		done:       make(chan struct{}),
		cancel:     cancel,
		waiters:    1,
		generation: c.nextGeneration,
	}
	c.inFlight[key] = call
	loader := c.loader
	c.mu.Unlock()

	go func() {
		resp, err := loader(loadCtx, home, now)
		cancel()

		c.mu.Lock()
		call.response = cloneUsageResponse(resp)
		call.err = err
		current := c.inFlight[key] == call
		cached, hasCached := c.cache[key]
		if err == nil && (!hasCached || cached.generation < call.generation) {
			if c.cache == nil {
				c.cache = make(map[string]usageCacheEntry)
			}
			c.cache[key] = usageCacheEntry{
				response:   cloneUsageResponse(resp),
				storedAt:   time.Now(),
				generation: call.generation,
			}
		}
		if current {
			delete(c.inFlight, key)
		}
		close(call.done)
		c.mu.Unlock()
	}()

	return c.wait(ctx, key, call)
}

func (c *usageCoordinator) wait(ctx context.Context, key string, call *usageCall) (*usageResponse, error) {
	select {
	case <-call.done:
		return cloneUsageResponse(call.response), call.err
	case <-ctx.Done():
		c.mu.Lock()
		if c.inFlight[key] == call {
			call.waiters--
			if call.waiters == 0 {
				delete(c.inFlight, key)
				call.cancel()
			}
		}
		c.mu.Unlock()
		return nil, ctx.Err()
	}
}

func usageCacheKey(home string, now time.Time) string {
	return home + "\x00" + now.Location().String() + "\x00" + now.Format("2006-01-02")
}

func cloneUsageResponse(src *usageResponse) *usageResponse {
	if src == nil {
		return nil
	}
	dst := *src
	dst.Periods = append([]usagePeriod(nil), src.Periods...)
	dst.Limits = cloneUsageLimits(src.Limits)
	for i := range dst.Periods {
		if src.Periods[i].Total == nil {
			continue
		}
		total := *src.Periods[i].Total
		total.UnpricedModels = append([]string(nil), total.UnpricedModels...)
		dst.Periods[i].Total = &total
	}
	return &dst
}

func usageRequestTime(r *http.Request) (time.Time, error) {
	now := time.Now()
	tz := strings.TrimSpace(r.URL.Query().Get("tz"))
	if tz == "" {
		return now, nil
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid timezone: %s", tz)
	}
	return now.In(loc), nil
}

func usagePeriods(now time.Time) []usagePeriodSpec {
	localNow := now
	today := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, localNow.Location())
	week := today.AddDate(0, 0, -int(today.Weekday()+6)%7)
	month := time.Date(localNow.Year(), localNow.Month(), 1, 0, 0, 0, 0, localNow.Location())
	return []usagePeriodSpec{
		{key: "today", label: "Today", start: today},
		{key: "week", label: "This week", start: week},
		{key: "month", label: "This month", start: month},
	}
}

// usageAccumulator sums cost, conversations and messages into each period
// that a timestamp falls in. Providers embed it and add their own dedupe.
type usageAccumulator struct {
	periods       []usagePeriodSpec
	costs         map[string]float64
	conversations map[string]int
	messages      map[string]int
	unpriced      map[string]map[string]struct{} // period key -> model
}

func newUsageAccumulator(periods []usagePeriodSpec) *usageAccumulator {
	return &usageAccumulator{
		periods:       periods,
		costs:         make(map[string]float64, len(periods)),
		conversations: make(map[string]int, len(periods)),
		messages:      make(map[string]int, len(periods)),
		unpriced:      map[string]map[string]struct{}{},
	}
}

// earliest is the start of the longest period; older logs hold nothing in range.
func (a *usageAccumulator) earliest() time.Time {
	earliest := a.periods[0].start
	for _, period := range a.periods[1:] {
		if period.start.Before(earliest) {
			earliest = period.start
		}
	}
	return earliest
}

// addCost adds one request's cost. A model without a known price costs 0 and
// is listed in the period's unpriced models.
func (a *usageAccumulator) addCost(ts time.Time, model string, cost float64, priced bool) {
	for _, period := range a.periods {
		if ts.Before(period.start) {
			continue
		}
		a.costs[period.key] += cost
		if !priced {
			a.markUnpriced(period.key, model)
		}
	}
}

func (a *usageAccumulator) addUserMessage(ts time.Time, conversationPeriods map[string]bool) {
	for _, period := range a.periods {
		if ts.Before(period.start) {
			continue
		}
		a.messages[period.key]++
		if !conversationPeriods[period.key] {
			a.conversations[period.key]++
			conversationPeriods[period.key] = true
		}
	}
}

func (a *usageAccumulator) markUnpriced(periodKey, model string) {
	if strings.TrimSpace(model) == "" {
		model = "unknown model"
	}
	if a.unpriced[periodKey] == nil {
		a.unpriced[periodKey] = map[string]struct{}{}
	}
	a.unpriced[periodKey][model] = struct{}{}
}

func (a *usageAccumulator) total(periodKey string) *usageTotals {
	var unpriced []string
	for model := range a.unpriced[periodKey] {
		unpriced = append(unpriced, model)
	}
	sort.Strings(unpriced)
	return &usageTotals{
		Cost:           a.costs[periodKey],
		Conversations:  a.conversations[periodKey],
		Messages:       a.messages[periodKey],
		UnpricedModels: unpriced,
	}
}

func (a *usageAccumulator) response(now time.Time, limits *usageLimits) *usageResponse {
	resp := &usageResponse{FetchedAt: now.UTC().Format(time.RFC3339), Limits: limits}
	for _, spec := range a.periods {
		resp.Periods = append(resp.Periods, usagePeriod{
			Key:   spec.key,
			Label: spec.label,
			Start: spec.start.Format(time.RFC3339),
			End:   now.Format(time.RFC3339),
			Total: a.total(spec.key),
		})
	}
	return resp
}

func parseUsageTimestamp(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, fmt.Errorf("missing timestamp")
	}
	return time.Parse(time.RFC3339Nano, value)
}
