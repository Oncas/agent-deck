package server

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCodexUsageCoordinatorCachesAndRefreshes(t *testing.T) {
	var calls atomic.Int32
	coordinator := usageCoordinator{
		loader: func(_ context.Context, _ string, now time.Time) (*usageResponse, error) {
			calls.Add(1)
			return &usageResponse{
				FetchedAt: now.Format(time.RFC3339),
				Periods: []usagePeriod{{
					Key:   "today",
					Label: "Today",
					Total: &usageTotals{Cost: float64(calls.Load())},
				}},
			}, nil
		},
	}
	now := time.Date(2026, 8, 9, 13, 0, 0, 0, time.FixedZone("EEST", 3*60*60))

	first, err := coordinator.load(context.Background(), "/codex", now, false)
	if err != nil {
		t.Fatalf("first load: %v", err)
	}
	first.Periods[0].Total.Cost = 99

	second, err := coordinator.load(context.Background(), "/codex", now.Add(time.Minute), false)
	if err != nil {
		t.Fatalf("cached load: %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("loader calls after cached load = %d, want 1", got)
	}
	if got := second.Periods[0].Total.Cost; got != 1 {
		t.Fatalf("cached cost = %.0f, want unmodified clone 1", got)
	}

	refreshed, err := coordinator.load(context.Background(), "/codex", now.Add(2*time.Minute), true)
	if err != nil {
		t.Fatalf("fresh load: %v", err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("loader calls after fresh load = %d, want 2", got)
	}
	if got := refreshed.Periods[0].Total.Cost; got != 2 {
		t.Fatalf("refreshed cost = %.0f, want 2", got)
	}
}

func TestCodexUsageCoordinatorCoalescesConcurrentLoads(t *testing.T) {
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	coordinator := usageCoordinator{
		loader: func(_ context.Context, _ string, now time.Time) (*usageResponse, error) {
			if calls.Add(1) == 1 {
				close(started)
			}
			<-release
			return &usageResponse{FetchedAt: now.Format(time.RFC3339)}, nil
		},
	}
	now := time.Date(2026, 8, 9, 13, 0, 0, 0, time.UTC)
	start := make(chan struct{})
	results := make(chan error, 8)
	var wg sync.WaitGroup
	for i := 0; i < cap(results); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := coordinator.load(context.Background(), "/codex", now, false)
			results <- err
		}()
	}
	close(start)
	<-started
	close(release)
	wg.Wait()
	close(results)

	for err := range results {
		if err != nil {
			t.Fatalf("coalesced load: %v", err)
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("loader calls = %d, want 1", got)
	}
}

func TestCodexUsageCoordinatorKeepsSharedLoadForActiveWaiter(t *testing.T) {
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	coordinator := usageCoordinator{
		loader: func(ctx context.Context, _ string, now time.Time) (*usageResponse, error) {
			calls.Add(1)
			close(started)
			select {
			case <-release:
				return &usageResponse{FetchedAt: now.Format(time.RFC3339)}, nil
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		},
	}
	now := time.Date(2026, 8, 9, 13, 0, 0, 0, time.UTC)
	firstCtx, cancelFirst := context.WithCancel(context.Background())
	firstResult := make(chan error, 1)
	go func() {
		_, err := coordinator.load(firstCtx, "/codex", now, false)
		firstResult <- err
	}()
	<-started

	secondResult := make(chan error, 1)
	go func() {
		_, err := coordinator.load(context.Background(), "/codex", now, false)
		secondResult <- err
	}()
	deadline := time.Now().Add(time.Second)
	for {
		coordinator.mu.Lock()
		call := coordinator.inFlight[usageCacheKey("/codex", now)]
		waiters := 0
		if call != nil {
			waiters = call.waiters
		}
		coordinator.mu.Unlock()
		if waiters == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("shared load waiters = %d, want 2", waiters)
		}
		time.Sleep(time.Millisecond)
	}

	cancelFirst()
	if err := <-firstResult; !errors.Is(err, context.Canceled) {
		t.Fatalf("first load error = %v, want context.Canceled", err)
	}
	close(release)
	if err := <-secondResult; err != nil {
		t.Fatalf("second load error = %v, want nil", err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("loader calls = %d, want 1", got)
	}
}

func TestCodexUsageCoordinatorCancelsLoadWithoutWaiters(t *testing.T) {
	started := make(chan struct{})
	stopped := make(chan struct{})
	coordinator := usageCoordinator{
		loader: func(ctx context.Context, _ string, _ time.Time) (*usageResponse, error) {
			close(started)
			<-ctx.Done()
			close(stopped)
			return nil, ctx.Err()
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := coordinator.load(ctx, "/codex", time.Now(), false)
		result <- err
	}()
	<-started
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("load error = %v, want context.Canceled", err)
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("shared loader did not stop after its only waiter canceled")
	}
}

func TestCodexUsageCoordinatorCachesSuccessAfterLastWaiterCancels(t *testing.T) {
	started := make(chan struct{})
	loaderReturned := make(chan struct{})
	coordinator := usageCoordinator{
		loader: func(ctx context.Context, _ string, now time.Time) (*usageResponse, error) {
			close(started)
			<-ctx.Done()
			close(loaderReturned)
			return &usageResponse{FetchedAt: now.Format(time.RFC3339)}, nil
		},
	}
	now := time.Date(2026, 8, 9, 13, 0, 0, 0, time.UTC)
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := coordinator.load(ctx, "/codex", now, false)
		result <- err
	}()
	<-started
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("load error = %v, want context.Canceled", err)
	}
	<-loaderReturned

	key := usageCacheKey("/codex", now)
	deadline := time.Now().Add(time.Second)
	for {
		coordinator.mu.Lock()
		cached, ok := coordinator.cache[key]
		coordinator.mu.Unlock()
		if ok {
			if cached.response.FetchedAt != now.Format(time.RFC3339) {
				t.Fatalf("cached fetched_at = %q, want %q", cached.response.FetchedAt, now.Format(time.RFC3339))
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("successful canceled load was not cached")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestCodexUsageCoordinatorNewerLoadWinsCacheWhenOlderCompletesFirst(t *testing.T) {
	var calls atomic.Int32
	firstStarted := make(chan struct{})
	firstCanceled := make(chan struct{})
	releaseFirst := make(chan struct{})
	secondStarted := make(chan struct{})
	releaseSecond := make(chan struct{})
	coordinator := usageCoordinator{
		loader: func(ctx context.Context, _ string, _ time.Time) (*usageResponse, error) {
			if calls.Add(1) == 1 {
				close(firstStarted)
				<-ctx.Done()
				close(firstCanceled)
				<-releaseFirst
				return &usageResponse{FetchedAt: "older"}, nil
			}
			close(secondStarted)
			<-releaseSecond
			return &usageResponse{FetchedAt: "newer"}, nil
		},
	}
	now := time.Date(2026, 8, 9, 13, 0, 0, 0, time.UTC)
	firstCtx, cancelFirst := context.WithCancel(context.Background())
	firstResult := make(chan error, 1)
	go func() {
		_, err := coordinator.load(firstCtx, "/codex", now, false)
		firstResult <- err
	}()
	<-firstStarted
	cancelFirst()
	if err := <-firstResult; !errors.Is(err, context.Canceled) {
		t.Fatalf("first load error = %v, want context.Canceled", err)
	}
	<-firstCanceled

	secondResult := make(chan error, 1)
	go func() {
		_, err := coordinator.load(context.Background(), "/codex", now, false)
		secondResult <- err
	}()
	<-secondStarted
	close(releaseFirst)

	key := usageCacheKey("/codex", now)
	deadline := time.Now().Add(time.Second)
	for {
		coordinator.mu.Lock()
		cached := coordinator.cache[key]
		coordinator.mu.Unlock()
		if cached.response != nil && cached.response.FetchedAt == "older" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("older completed load was not cached")
		}
		time.Sleep(time.Millisecond)
	}

	close(releaseSecond)
	if err := <-secondResult; err != nil {
		t.Fatalf("second load error = %v, want nil", err)
	}
	coordinator.mu.Lock()
	cached := coordinator.cache[key]
	coordinator.mu.Unlock()
	if cached.response.FetchedAt != "newer" {
		t.Fatalf("cached fetched_at = %q, want newer", cached.response.FetchedAt)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("loader calls = %d, want 2", got)
	}
}

func TestCodexUsageSessionScanStopsAfterCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	reader := &cancelCodexUsageReader{
		Reader: strings.NewReader("{\"type\":\"session_meta\"}\n{\"type\":\"turn_context\"}\n"),
		cancel: cancel,
	}
	periods := usagePeriods(time.Now())
	err := scanCodexUsageSessionReader(ctx, reader, "session.jsonl", codexUsageSessionScope{id: "session"}, nil, time.Now(), newCodexUsageAccumulator(periods))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("scan error = %v, want context.Canceled", err)
	}
}

func TestHandleCodexUsageCachesPollsAndRefreshes(t *testing.T) {
	t.Setenv("CODEX_HOME", t.TempDir())
	var calls atomic.Int32
	handler := handleUsage(codexUsageHome, &usageCoordinator{
		loader: func(_ context.Context, _ string, now time.Time) (*usageResponse, error) {
			calls.Add(1)
			return &usageResponse{FetchedAt: now.Format(time.RFC3339)}, nil
		},
	})

	request := func(target string) {
		t.Helper()
		recorder := httptest.NewRecorder()
		handler(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, want %d; body: %s", target, recorder.Code, http.StatusOK, recorder.Body.String())
		}
	}

	request("/api/codex/usage?tz=UTC")
	request("/api/codex/usage?tz=UTC")
	if got := calls.Load(); got != 1 {
		t.Fatalf("loader calls after cached poll = %d, want 1", got)
	}

	request("/api/codex/usage?tz=UTC&fresh=1")
	if got := calls.Load(); got != 2 {
		t.Fatalf("loader calls after fresh request = %d, want 2", got)
	}
}

func TestReadCodexUsageSessionIdentityMarksExcludedSessions(t *testing.T) {
	tests := []struct {
		name string
		meta string
	}{
		{
			name: "subagent",
			meta: `{"type":"session_meta","payload":{"id":"child","cwd":"/workspace/project","thread_source":"subagent","parent_thread_id":"root","source":{"subagent":{}}}}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "session.jsonl")
			writeCodexUsageSession(t, path, []string{tt.meta})

			identity, err := readCodexUsageSessionIdentity(context.Background(), path)
			if err != nil {
				t.Fatalf("read identity: %v", err)
			}
			if !identity.excludeUsage {
				t.Fatal("excludeUsage = false, want true")
			}
		})
	}
}

func TestLoadCodexUsageCalculatesTodayWeekAndMonth(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions", "2026", "06")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "session.jsonl"), []string{
		`{"type":"session_meta"}`,
		`{"type":"turn_context","payload":{"model":"gpt-5.5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":200000,"output_tokens":100000}}}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:01:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":200000,"output_tokens":100000}}}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-16T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":2000000,"cached_input_tokens":500000,"output_tokens":300000}}}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5-mini"}}`,
		`{"type":"event_msg","timestamp":"2026-06-04T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":400000,"cached_input_tokens":400000,"output_tokens":10000}}}}`,
		`{"type":"event_msg","timestamp":"2026-05-31T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":9000000,"cached_input_tokens":0,"output_tokens":9000000}}}}`,
	})

	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	today := usagePeriodByKey(t, resp, "today")
	assertCodexUsageCost(t, today.Total, 12.70)

	week := usagePeriodByKey(t, resp, "week")
	assertCodexUsageCost(t, week.Total, 17.6375)

	month := usagePeriodByKey(t, resp, "month")
	assertCodexUsageCost(t, month.Total, 17.6675)
}

func TestLoadCodexUsageCountsDistinctTokenEventsWithoutDelta(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions", "2026", "06")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "session.jsonl"), []string{
		`{"type":"session_meta"}`,
		`{"type":"turn_context","payload":{"model":"gpt-5.5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":100000}}}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:01:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":2000000,"cached_input_tokens":0,"output_tokens":150000}}}}`,
	})

	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	today := usagePeriodByKey(t, resp, "today")
	assertCodexUsageCost(t, today.Total, 41.25)
}

func TestLoadCodexUsageDeduplicatesResumedForkHistory(t *testing.T) {
	codexHome := t.TempDir()
	augustSessionsDir := filepath.Join(codexHome, "sessions", "2026", "08")
	if err := os.MkdirAll(augustSessionsDir, 0700); err != nil {
		t.Fatalf("mkdir August sessions: %v", err)
	}

	writeCodexUsageSession(t, filepath.Join(augustSessionsDir, "01-root.jsonl"), []string{
		`{"type":"session_meta","timestamp":"2026-08-02T09:59:00Z","payload":{"id":"root","source":"cli","thread_source":"user"}}`,
		`{"type":"broken"`,
		`{"type":"future_item","payload":{"ignored":true}}`,
		`{"type":"event_msg","payload":{"type":"obsolete_event"}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"response_item","timestamp":"2026-08-02T09:59:30Z","payload":{"type":"message","role":"user","content":"original turn"}}`,
		`{"type":"event_msg","timestamp":"2026-08-02T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
	})
	writeCodexUsageSession(t, filepath.Join(augustSessionsDir, "02-resume.jsonl"), []string{
		`{"type":"session_meta","payload":{"id":"resume-1","source":"cli","thread_source":"user","forked_from_id":"root"}}`,
		`{"type":"session_meta","timestamp":"2026-08-03T08:59:00Z","payload":{"id":"root","session_id":"root","source":"cli","thread_source":"user","history_mode":"legacy"}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"response_item","timestamp":"2026-08-03T08:59:30Z","payload":{"type":"message","id":"msg_generated","role":"user","content":"original turn"}}`,
		`{"type":"event_msg","timestamp":"2026-08-03T09:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":1000000},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":1000000}}}}`,
		`{"type":"event_msg","timestamp":"2026-08-03T09:00:01Z","payload":{"type":"thread_settings_applied"}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"response_item","timestamp":"2026-08-03T09:00:30Z","payload":{"type":"message","role":"user","content":"first resumed turn"}}`,
		`{"type":"event_msg","timestamp":"2026-08-03T09:01:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1500000,"cached_input_tokens":0,"output_tokens":100000},"last_token_usage":{"input_tokens":500000,"cached_input_tokens":0,"output_tokens":100000}}}}`,
	})
	writeCodexUsageSession(t, filepath.Join(augustSessionsDir, "03-resume-again.jsonl"), []string{
		`{"type":"session_meta","payload":{"id":"resume-2","source":"cli","thread_source":"user","forked_from_id":"resume-1"}}`,
		`{"type":"session_meta","timestamp":"2026-08-03T09:59:00Z","payload":{"id":"resume-1","session_id":"resume-1","source":"cli","thread_source":"user","forked_from_id":"root","history_mode":"legacy"}}`,
		`{"type":"session_meta","timestamp":"2026-08-03T09:59:00Z","payload":{"id":"root","session_id":"root","source":"cli","thread_source":"user","history_mode":"legacy"}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"response_item","timestamp":"2026-08-03T09:59:00Z","payload":{"type":"message","id":"msg_generated","role":"user","content":"original turn"}}`,
		`{"type":"event_msg","timestamp":"2026-08-03T10:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
		`{"type":"event_msg","timestamp":"2026-08-03T10:00:00Z","payload":{"type":"thread_settings_applied"}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"response_item","timestamp":"2026-08-03T10:00:30Z","payload":{"type":"message","role":"user","content":"first resumed turn"}}`,
		`{"type":"event_msg","timestamp":"2026-08-03T10:01:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1500000,"cached_input_tokens":0,"output_tokens":100000},"last_token_usage":{"input_tokens":500000,"cached_input_tokens":0,"output_tokens":100000}}}}`,
		`{"type":"event_msg","timestamp":"2026-08-03T10:01:01Z","payload":{"type":"thread_settings_applied"}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"response_item","timestamp":"2026-08-03T10:01:30Z","payload":{"type":"message","role":"user","content":"second resumed turn"}}`,
		`{"type":"event_msg","timestamp":"2026-08-03T10:02:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2000000,"cached_input_tokens":0,"output_tokens":100000},"last_token_usage":{"input_tokens":500000,"cached_input_tokens":0,"output_tokens":0}}}}`,
	})

	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	assertCodexUsageCost(t, usagePeriodByKey(t, resp, "today").Total, 2.25)
	assertCodexUsageCost(t, usagePeriodByKey(t, resp, "week").Total, 2.25)
	assertCodexUsageCost(t, usagePeriodByKey(t, resp, "month").Total, 3.50)
}

func TestLoadCodexUsageKeepsMatchingSnapshotsFromIndependentSessions(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions", "2026", "06")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	for _, sessionID := range []string{"first", "second"} {
		writeCodexUsageSession(t, filepath.Join(sessionsDir, sessionID+".jsonl"), []string{
			`{"type":"session_meta","payload":{"id":"` + sessionID + `","source":"cli","thread_source":"user"}}`,
			`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
			`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
		})
	}

	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	assertCodexUsageCost(t, usagePeriodByKey(t, resp, "today").Total, 2.50)
}

func TestLoadCodexUsageKeepsMatchingNewSnapshotsFromSiblingForks(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions", "2026", "06")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "01-root.jsonl"), []string{
		`{"type":"session_meta","payload":{"id":"root","source":"cli","thread_source":"user"}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T09:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
	})
	for _, forkID := range []string{"fork-a", "fork-b"} {
		writeCodexUsageSession(t, filepath.Join(sessionsDir, forkID+".jsonl"), []string{
			`{"type":"session_meta","payload":{"id":"` + forkID + `","source":"cli","thread_source":"user","forked_from_id":"root"}}`,
			`{"type":"session_meta","payload":{"id":"root","source":"cli","thread_source":"user"}}`,
			`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
			`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
			`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
			`{"type":"event_msg","timestamp":"2026-06-18T10:01:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2000000,"cached_input_tokens":0,"output_tokens":0},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
		})
	}

	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	assertCodexUsageCost(t, usagePeriodByKey(t, resp, "today").Total, 3.75)
}

func TestLoadCodexUsageDoesNotDeduplicateNewUsageAfterBacktrackFork(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions", "2026", "06")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "root.jsonl"), []string{
		`{"type":"session_meta","timestamp":"2026-06-18T09:00:00Z","payload":{"id":"root","source":"cli","thread_source":"user"}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"response_item","timestamp":"2026-06-18T09:29:00Z","payload":{"type":"message","role":"user","content":"shared turn"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T09:30:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"response_item","timestamp":"2026-06-18T09:44:00Z","payload":{"type":"message","role":"user","content":"discarded parent turn"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T09:45:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2000000,"cached_input_tokens":0,"output_tokens":0},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
	})
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "fork.jsonl"), []string{
		`{"type":"session_meta","timestamp":"2026-06-18T10:00:00Z","payload":{"id":"fork","source":"cli","thread_source":"user","forked_from_id":"root"}}`,
		`{"type":"session_meta","timestamp":"2026-06-18T10:00:00Z","payload":{"id":"root","source":"cli","thread_source":"user"}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"response_item","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"message","id":"msg_generated","role":"user","content":"shared turn"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"response_item","timestamp":"2026-06-18T10:15:00Z","payload":{"type":"message","role":"user","content":"new fork turn"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:30:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2000000,"cached_input_tokens":0,"output_tokens":0},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
	})

	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	assertCodexUsageCost(t, usagePeriodByKey(t, resp, "today").Total, 3.75)
}

func TestLoadCodexUsageDeduplicatesUnchangedCumulativeSnapshot(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions", "2026", "06")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "session.jsonl"), []string{
		`{"type":"session_meta","payload":{"id":"root","source":"cli","thread_source":"user"}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:01:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:02:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2000000,"cached_input_tokens":0,"output_tokens":0},"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":0}}}}`,
	})

	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	assertCodexUsageCost(t, usagePeriodByKey(t, resp, "today").Total, 2.50)
}

func TestLoadCodexUsageExcludesNonRootSessionsFromStats(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions", "2026", "06")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "included.jsonl"), []string{
		`{"type":"session_meta","payload":{"cwd":"/home/user/project","source":"cli"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T09:00:00Z","payload":{"type":"user_message"}}`,
		`{"type":"turn_context","payload":{"cwd":"/home/user/project","model":"gpt-5.5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":100000}}}}`,
	})
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "subagent.jsonl"), []string{
		`{"type":"session_meta","payload":{"cwd":"/home/user/other-project","source":{"subagent":{"thread_spawn":{"parent_thread_id":"parent"}}}}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T09:00:00Z","payload":{"type":"user_message"}}`,
		`{"type":"turn_context","payload":{"cwd":"/home/user/other-project","model":"gpt-5.5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":100000}}}}`,
	})
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "thread-source-subagent.jsonl"), []string{
		`{"type":"session_meta","payload":{"cwd":"/home/user/other-project","source":"cli","thread_source":"subagent"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T09:00:00Z","payload":{"type":"user_message"}}`,
		`{"type":"turn_context","payload":{"cwd":"/home/user/other-project","model":"gpt-5.5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":100000}}}}`,
	})
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "parent-thread-subagent.jsonl"), []string{
		`{"type":"session_meta","payload":{"cwd":"/home/user/other-project","source":"cli","parent_thread_id":"parent"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T09:00:00Z","payload":{"type":"user_message"}}`,
		`{"type":"turn_context","payload":{"cwd":"/home/user/other-project","model":"gpt-5.5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":100000}}}}`,
	})
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "internal.jsonl"), []string{
		`{"type":"session_meta","payload":{"cwd":"/home/user/other-project","source":{"internal":"memory_consolidation"}}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T09:00:00Z","payload":{"type":"user_message"}}`,
		`{"type":"turn_context","payload":{"cwd":"/home/user/other-project","model":"gpt-5.5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":100000}}}}`,
	})

	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	today := usagePeriodByKey(t, resp, "today")
	assertCodexUsageCost(t, today.Total, 14.50)
	assertCodexUsageCounts(t, today.Total, 1, 1)
}

func TestLoadCodexUsageKeepsSubagentExcludedAfterInheritedSessionMeta(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions", "2026", "06")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "subagent.jsonl"), []string{
		`{"type":"session_meta","payload":{"cwd":"/home/user/project","source":{"subagent":{"thread_spawn":{"parent_thread_id":"parent"}}},"thread_source":"subagent","parent_thread_id":"parent"}}`,
		`{"type":"session_meta","payload":{"cwd":"/home/user/project","source":"cli","thread_source":"user"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T09:00:00Z","payload":{"type":"user_message"}}`,
		`{"type":"turn_context","payload":{"cwd":"/home/user/project","model":"gpt-5.5"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":100000}}}}`,
	})

	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	today := usagePeriodByKey(t, resp, "today")
	assertCodexUsageCost(t, today.Total, 0)
	assertCodexUsageCounts(t, today.Total, 0, 0)
}

func TestLoadCodexUsageCountsUserMessagesAndActiveConversations(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions", "2026", "06")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "first.jsonl"), []string{
		`{"type":"event_msg","timestamp":"2026-06-04T10:00:00Z","payload":{"type":"user_message"}}`,
		`{"type":"event_msg","timestamp":"2026-06-16T10:00:00Z","payload":{"type":"user_message"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T09:00:00Z","payload":{"type":"user_message"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"user_message"}}`,
	})
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "second.jsonl"), []string{
		`{"type":"event_msg","timestamp":"2026-06-18T11:00:00Z","payload":{"type":"user_message"}}`,
		`{"type":"response_item","timestamp":"2026-06-18T11:01:00Z","payload":{"type":"message","role":"user"}}`,
	})
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "outside.jsonl"), []string{
		`{"type":"event_msg","timestamp":"2026-05-31T10:00:00Z","payload":{"type":"user_message"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T12:00:00Z","payload":{"type":"user_message"}}`,
	})

	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	assertCodexUsageCounts(t, usagePeriodByKey(t, resp, "today").Total, 2, 3)
	assertCodexUsageCounts(t, usagePeriodByKey(t, resp, "week").Total, 2, 4)
	assertCodexUsageCounts(t, usagePeriodByKey(t, resp, "month").Total, 2, 5)
}

func TestLoadCodexUsageCountsLegacyAndCurrentUserMessageEvents(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions", "2026", "06")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "legacy.jsonl"), []string{
		`{"type":"session_meta","payload":{"id":"legacy","source":"cli"}}`,
		`{"type":"response_item","timestamp":"2026-06-18T09:00:00Z","payload":{"type":"message","role":"user"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T09:00:00Z","payload":{"type":"user_message"}}`,
	})
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "current.jsonl"), []string{
		`{"type":"session_meta","payload":{"id":"current","source":"cli"}}`,
		`{"type":"response_item","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"message","role":"user"}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"item_completed","item":{"type":"UserMessage"}}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:01:00Z","payload":{"type":"item_completed","item":{"type":"AgentMessage"}}}`,
	})

	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	assertCodexUsageCounts(t, usagePeriodByKey(t, resp, "today").Total, 2, 2)
}

func TestLoadCodexUsageSkipsMalformedAndOversizedSessionLines(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions", "2026", "06")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "session.jsonl"), []string{
		`{"type":"session_meta"}`,
		`{"type":"event_msg","payload":{"type":"message","body":"` + strings.Repeat("x", 5*1024*1024) + `"}}`,
		`{not json`,
		`{"type":"turn_context","payload":{"model":"gpt-5.5"}}`,
		`{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":9000000,"cached_input_tokens":0,"output_tokens":9000000}}}}`,
		`{"type":"event_msg","timestamp":"2026-06-18T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000,"cached_input_tokens":0,"output_tokens":100000}}}}`,
	})

	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	today := usagePeriodByKey(t, resp, "today")
	assertCodexUsageCost(t, today.Total, 14.50)
}

func TestCodexUsageCalculatesCurrentModelCosts(t *testing.T) {
	tests := []struct {
		model string
		cost  float64
	}{
		{model: "gpt-6-astra", cost: 1.32},
		{model: "gpt-6.1-sol", cost: 0.262},
		{model: "gpt-6-sol", cost: 0.264},
		{model: "gpt-6-luna", cost: 0.0132},
		{model: "gpt-5.6", cost: 0.528},
		{model: "gpt-5.6-sol", cost: 0.528},
		{model: "gpt-5.6-terra", cost: 0.284},
		{model: "gpt-5.6-luna", cost: 0.0284},
		{model: "gpt-5.5", cost: 0.71},
		{model: "gpt-5.5-2026-04-23", cost: 0.71},
		{model: "gpt-5.4", cost: 0.355},
		{model: "gpt-5.4-2026-03-05", cost: 0.355},
		{model: "gpt-5.6-unknown", cost: 0},
		{model: "gpt-5.5-2026-99-99", cost: 0},
	}

	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			periods := []usagePeriodSpec{{key: "today", start: time.Time{}}}
			acc := newCodexUsageAccumulator(periods)
			acc.add(time.Now(), tt.model, 100_000, 20_000, 10_000)

			assertCodexUsageCost(t, acc.total("today"), tt.cost)
		})
	}
}

func TestCodexUsageCalculatesLongContextCosts(t *testing.T) {
	tests := []struct {
		name   string
		model  string
		input  int64
		cached int64
		output int64
		cost   float64
	}{
		{name: "at threshold", model: "gpt-6-astra", input: 272_000, cached: 72_000, output: 10_000, cost: 2.572},
		{name: "above threshold", model: "gpt-6-astra", input: 272_001, cached: 72_000, output: 10_000, cost: 4.89402},
		{name: "cached input counts toward threshold", model: "gpt-6-astra", input: 300_000, cached: 300_000, output: 10_000, cost: 1.35},
		{name: "output does not count toward threshold", model: "gpt-6-astra", input: 260_000, cached: 20_000, output: 20_000, cost: 3.42},
		{name: "sol", model: "gpt-5.6-sol", input: 300_000, cached: 200_000, output: 10_000, cost: 1.26},
		{name: "sol alias", model: "gpt-5.6", input: 300_000, cached: 200_000, output: 10_000, cost: 1.26},
		{name: "terra", model: "gpt-5.6-terra", input: 300_000, cached: 200_000, output: 10_000, cost: 0.66},
		{name: "luna", model: "gpt-5.6-luna", input: 300_000, cached: 200_000, output: 10_000, cost: 0.066},
		{name: "gpt-5.5", model: "gpt-5.5", input: 300_000, cached: 200_000, output: 10_000, cost: 1.65},
		{name: "gpt-5.4", model: "gpt-5.4", input: 300_000, cached: 200_000, output: 10_000, cost: 0.825},
		{name: "mini has no surcharge", model: "gpt-5.4-mini", input: 300_000, cached: 200_000, output: 10_000, cost: 0.135},
		{name: "codex has no surcharge", model: "gpt-5.3-codex", input: 300_000, cached: 200_000, output: 10_000, cost: 0.35},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			periods := []usagePeriodSpec{{key: "today", start: time.Time{}}}
			acc := newCodexUsageAccumulator(periods)
			acc.add(time.Now(), tt.model, tt.input, tt.cached, tt.output)

			assertCodexUsageCost(t, acc.total("today"), tt.cost)
		})
	}
}

func TestLoadCodexUsagePricesEachRequestBeforeAggregation(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions")
	if err := os.MkdirAll(sessionsDir, 0700); err != nil {
		t.Fatalf("mkdir sessions: %v", err)
	}
	writeCodexUsageSession(t, filepath.Join(sessionsDir, "session.jsonl"), []string{
		`{"type":"session_meta","payload":{"id":"session"}}`,
		`{"type":"turn_context","payload":{"model":"gpt-5.6-luna"}}`,
		`{"type":"event_msg","timestamp":"2026-09-02T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":200000,"cached_input_tokens":100000,"output_tokens":10000}}}}`,
		`{"type":"turn_context","payload":{"model":"gpt-6-astra"}}`,
		`{"type":"event_msg","timestamp":"2026-09-08T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":300000,"cached_input_tokens":200000,"output_tokens":10000}}}}`,
		`{"type":"turn_context","payload":{"model":" GPT-5.6-SOL "}}`,
		`{"type":"event_msg","timestamp":"2026-09-09T10:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":700000,"cached_input_tokens":400000,"output_tokens":30000},"last_token_usage":{"input_tokens":200000,"cached_input_tokens":100000,"output_tokens":10000,"reasoning_output_tokens":5000}}}}`,
		`{"type":"event_msg","timestamp":"2026-09-09T10:01:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":900000,"cached_input_tokens":500000,"output_tokens":40000},"last_token_usage":{"input_tokens":200000,"cached_input_tokens":100000,"output_tokens":10000,"reasoning_output_tokens":5000}}}}`,
		`{"type":"event_msg","timestamp":"2026-09-09T10:02:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":900000,"cached_input_tokens":500000,"output_tokens":40000},"last_token_usage":{"input_tokens":200000,"cached_input_tokens":100000,"output_tokens":10000,"reasoning_output_tokens":5000}}}}`,
	})

	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}

	assertCodexUsageCost(t, usagePeriodByKey(t, resp, "today").Total, 1.28)
	assertCodexUsageCost(t, usagePeriodByKey(t, resp, "week").Total, 4.43)
	assertCodexUsageCost(t, usagePeriodByKey(t, resp, "month").Total, 4.464)
}

func TestCodexUsagePeriodsUseProvidedTimezone(t *testing.T) {
	loc := time.FixedZone("EEST", 3*60*60)
	now := time.Date(2026, 6, 4, 13, 0, 0, 0, loc)

	periods := usagePeriods(now)

	week := usagePeriodSpecByKey(t, periods, "week")
	want := time.Date(2026, 6, 1, 0, 0, 0, 0, loc)
	if !week.start.Equal(want) {
		t.Fatalf("week start = %s, want %s", week.start, want)
	}
	if week.start.Location() != loc {
		t.Fatalf("week start location = %s, want %s", week.start.Location(), loc)
	}
}

func TestLoadCodexUsageRequiresSessionsDirectory(t *testing.T) {
	if _, err := loadCodexUsageContext(context.Background(), t.TempDir(), time.Now()); err == nil {
		t.Fatal("loadCodexUsage returned nil error, want missing sessions failure")
	}
}

func TestLoadCodexUsageSkipsSessionsUnchangedBeforeCurrentPeriods(t *testing.T) {
	codexHome := t.TempDir()
	sessionsDir := filepath.Join(codexHome, "sessions")
	if err := os.Mkdir(sessionsDir, 0755); err != nil {
		t.Fatalf("create sessions directory: %v", err)
	}
	writeSession := func(name, id string) string {
		t.Helper()
		path := filepath.Join(sessionsDir, name)
		writeCodexUsageSession(t, path, []string{
			`{"type":"session_meta","payload":{"id":"` + id + `"}}`,
			`{"type":"turn_context","payload":{"model":"gpt-5"}}`,
			`{"type":"event_msg","timestamp":"2026-08-12T10:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1000000}}}}`,
		})
		return path
	}

	stalePath := writeSession("stale.jsonl", "stale")
	staleTime := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	if err := os.Chtimes(stalePath, staleTime, staleTime); err != nil {
		t.Fatalf("backdate stale session: %v", err)
	}
	writeSession("resumed.jsonl", "resumed")

	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	resp, err := loadCodexUsageContext(context.Background(), codexHome, now)
	if err != nil {
		t.Fatalf("loadCodexUsage returned error: %v", err)
	}
	assertCodexUsageCost(t, usagePeriodByKey(t, resp, "month").Total, 1.25)
}

func BenchmarkScanCodexUsageLargeNonForkedSession(b *testing.B) {
	const (
		lineCount   = 128
		payloadSize = 256 * 1024
	)

	payload := strings.Repeat("x", payloadSize)
	var session strings.Builder
	session.Grow(lineCount * payloadSize)
	session.WriteString("{\"type\":\"session_meta\",\"payload\":{\"id\":\"large-session\"}}\n")
	for range lineCount {
		session.WriteString(`{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"`)
		session.WriteString(payload)
		session.WriteString(`"}]}}` + "\n")
	}
	sessionData := session.String()
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	periods := usagePeriods(now)

	b.ReportAllocs()
	b.SetBytes(int64(len(sessionData)))
	b.ResetTimer()
	for b.Loop() {
		acc := newCodexUsageAccumulator(periods)
		if err := scanCodexUsageSessionReader(context.Background(), strings.NewReader(sessionData), "large.jsonl", codexUsageSessionScope{id: "large-session"}, nil, now, acc); err != nil {
			b.Fatal(err)
		}
	}
}

func writeCodexUsageSession(t *testing.T, path string, lines []string) {
	t.Helper()
	data := ""
	for _, line := range lines {
		data += line + "\n"
	}
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatalf("write session: %v", err)
	}
}

type cancelCodexUsageReader struct {
	io.Reader
	cancel context.CancelFunc
}

func (r *cancelCodexUsageReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	r.cancel()
	return n, err
}

func usagePeriodByKey(t *testing.T, resp *usageResponse, key string) usagePeriod {
	t.Helper()
	for _, period := range resp.Periods {
		if period.Key == key {
			return period
		}
	}
	t.Fatalf("period %q not found in %#v", key, resp.Periods)
	return usagePeriod{}
}

func usagePeriodSpecByKey(t *testing.T, periods []usagePeriodSpec, key string) usagePeriodSpec {
	t.Helper()
	for _, period := range periods {
		if period.key == key {
			return period
		}
	}
	t.Fatalf("period spec %q not found in %#v", key, periods)
	return usagePeriodSpec{}
}

func assertCodexUsageCost(t *testing.T, got *usageTotals, want float64) {
	t.Helper()
	if got == nil {
		t.Fatal("total is nil")
	}
	if diff := got.Cost - want; diff < -0.000001 || diff > 0.000001 {
		t.Fatalf("cost = %.6f, want %.6f", got.Cost, want)
	}
}

func assertCodexUsageCounts(t *testing.T, got *usageTotals, conversations, messages int) {
	t.Helper()
	if got == nil {
		t.Fatal("total is nil")
	}
	if got.Conversations != conversations || got.Messages != messages {
		t.Fatalf("counts = %d conversations and %d messages, want %d and %d", got.Conversations, got.Messages, conversations, messages)
	}
}

func TestCodexUsageListsModelsWithoutAPrice(t *testing.T) {
	periods := []usagePeriodSpec{{key: "today", start: time.Time{}}}
	acc := newCodexUsageAccumulator(periods)
	acc.add(time.Now(), "gpt-5.5", 100_000, 0, 0)
	acc.add(time.Now(), "gpt-9-nova", 100_000, 0, 0)
	acc.add(time.Now(), "gpt-9-nova", 100_000, 0, 0)
	acc.add(time.Now(), "", 100_000, 0, 0)

	total := acc.total("today")
	if got := strings.Join(total.UnpricedModels, ","); got != "gpt-9-nova,unknown model" {
		t.Fatalf("unpriced models = %q, want the unknown model once plus the unnamed one", got)
	}
	assertCodexUsageCost(t, total, 0.5)
}
