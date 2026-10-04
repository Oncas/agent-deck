package server

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestFetchIfStaleEmptyPath(t *testing.T) {
	f := newFetcher(time.Minute)
	if fetched, err := f.FetchIfStale(""); fetched || err != nil {
		t.Errorf("FetchIfStale(\"\") = (%v, %v), want (false, nil)", fetched, err)
	}
}

func TestFetchIfStaleThrottlesSuccess(t *testing.T) {
	clone := newRemotePair(t)
	f := newFetcher(time.Minute)

	fetched, err := f.FetchIfStale(clone)
	if !fetched || err != nil {
		t.Fatalf("first fetch = (%v, %v), want (true, nil)", fetched, err)
	}
	// Within minInterval the fetch is throttled and the prior (successful)
	// result is replayed without an error.
	fetched, err = f.FetchIfStale(clone)
	if fetched || err != nil {
		t.Errorf("throttled fetch = (%v, %v), want (false, nil)", fetched, err)
	}
}

func TestFetchIfStaleReplaysErrorWhileThrottled(t *testing.T) {
	// A plain directory that is not a git repo makes git fetch fail.
	dir := t.TempDir()
	f := newFetcher(time.Minute)

	fetched, err := f.FetchIfStale(dir)
	if !fetched || err == nil {
		t.Fatalf("first fetch = (%v, %v), want (true, non-nil)", fetched, err)
	}
	// The failed fetch reserved the throttle slot, so the follow-up is skipped
	// — but it must still surface the failure rather than hide it behind a
	// fresh timestamp.
	fetched, err = f.FetchIfStale(dir)
	if fetched {
		t.Errorf("throttled fetch reported fetched=true, want false")
	}
	if err == nil {
		t.Errorf("throttled fetch hid the prior fetch error, want it replayed")
	}
}

func TestFetchIfStaleWaitsForInFlightFetch(t *testing.T) {
	f := newFetcher(time.Minute)
	started := make(chan struct{})
	release := make(chan struct{})
	var calls int32
	f.fetch = func(string) (string, error) {
		if atomic.AddInt32(&calls, 1) == 1 {
			close(started)
		}
		<-release
		return "", nil
	}

	firstDone := make(chan struct{})
	go func() {
		fetched, err := f.FetchIfStale("project")
		if !fetched || err != nil {
			t.Errorf("first fetch = (%v, %v), want (true, nil)", fetched, err)
		}
		close(firstDone)
	}()
	<-started

	type result struct {
		fetched bool
		err     error
	}
	secondDone := make(chan result)
	go func() {
		fetched, err := f.FetchIfStale("project")
		secondDone <- result{fetched: fetched, err: err}
	}()

	select {
	case got := <-secondDone:
		t.Fatalf("overlapping fetch returned before in-flight fetch completed: (%v, %v)", got.fetched, got.err)
	case <-time.After(20 * time.Millisecond):
	}

	close(release)
	<-firstDone
	got := <-secondDone
	if got.fetched || got.err != nil {
		t.Errorf("overlapping fetch = (%v, %v), want (false, nil)", got.fetched, got.err)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Errorf("fetch calls = %d, want 1", calls)
	}
}
