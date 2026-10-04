package server

import (
	"sync"
	"time"
)

// fetcher coalesces background and on-demand `git fetch` calls. Each project
// path is fetched at most once per minInterval — so a burst of focus events
// or status requests will not hammer remotes, and the periodic background
// loop will not duplicate work that was just done on demand.
type fetcher struct {
	mu          sync.Mutex
	lastFetch   map[string]time.Time
	lastErr     map[string]error
	inFlight    map[string]chan struct{}
	minInterval time.Duration
	fetch       func(string) (string, error)
}

func newFetcher(minInterval time.Duration) *fetcher {
	return &fetcher{
		lastFetch:   map[string]time.Time{},
		lastErr:     map[string]error{},
		inFlight:    map[string]chan struct{}{},
		minInterval: minInterval,
		fetch:       gitFetch,
	}
}

// FetchIfStale runs git fetch synchronously if the last fetch for this path
// was more than minInterval ago. Concurrent callers wait for an in-flight fetch
// instead of racing into duplicate fetches or replaying an older result before
// the fresh refs are available. It returns whether a fetch was actually
// attempted and any error to surface — when a recent fetch is still within
// minInterval, it replays that fetch's error instead of reporting success, so a
// throttled refresh does not silently hide a prior fetch failure while stale
// refs are still displayed.
func (f *fetcher) FetchIfStale(projectPath string) (fetched bool, err error) {
	if projectPath == "" {
		return false, nil
	}
	f.mu.Lock()
	if done, ok := f.inFlight[projectPath]; ok {
		f.mu.Unlock()
		<-done
		f.mu.Lock()
		err = f.lastErr[projectPath]
		f.mu.Unlock()
		return false, err
	}
	if time.Since(f.lastFetch[projectPath]) < f.minInterval {
		err = f.lastErr[projectPath]
		f.mu.Unlock()
		return false, err
	}
	done := make(chan struct{})
	f.inFlight[projectPath] = done
	f.mu.Unlock()

	_, err = f.fetch(projectPath)

	f.mu.Lock()
	f.lastFetch[projectPath] = time.Now()
	f.lastErr[projectPath] = err
	delete(f.inFlight, projectPath)
	close(done)
	f.mu.Unlock()
	return true, err
}
