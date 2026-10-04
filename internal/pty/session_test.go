package pty

import (
	"strings"
	"testing"
	"time"
)

func TestSessionStartCommandPullsBeforeCLIByDefault(t *testing.T) {
	got := sessionStartCommand("openai", true, StartOptions{ResumeLast: true})
	want := "git fetch --quiet 2>&1 && git merge '@{u}' 2>&1; codex resume --last --dangerously-bypass-approvals-and-sandbox"

	if got != want {
		t.Fatalf("sessionStartCommand() = %q, want %q", got, want)
	}
}

func TestSessionStartCommandCanPullFastForwardOnlyBeforeCLI(t *testing.T) {
	got := sessionStartCommand("openai", true, StartOptions{
		ResumeLast:           true,
		StartupGitPullFFOnly: true,
	})
	want := "git fetch --quiet 2>&1 && git merge --ff-only '@{u}' 2>&1; codex resume --last --dangerously-bypass-approvals-and-sandbox"

	if got != want {
		t.Fatalf("sessionStartCommand() = %q, want %q", got, want)
	}
}

func TestSkipStartupGitPullPreservesProviderOptions(t *testing.T) {
	for _, cli := range []string{"claude", "cursor", "openai", "gemini", "custom"} {
		options := StartOptions{
			SkipStartupGitPull: true, StartupGitPullFFOnly: true, ResumeLast: true,
			CLIIntegrations: map[string]CLIIntegration{
				"custom": {ID: "custom", Command: "wrapper start", ResumeCommand: "wrapper resume"},
			},
		}
		if got, want := sessionStartCommand(cli, true, options), StartCommandWithOptions(cli, true, options); got != want {
			t.Errorf("%s launch = %q, want %q", cli, got, want)
		}
	}
}

func TestSubscribeFromReplaysOnlyMissingOutputThenStreamsLiveData(t *testing.T) {
	s := NewSession("project", t.TempDir())
	s.SetOutputLimit(5)
	s.appendOutput([]byte("abcdef"))

	sub, replay := s.SubscribeFrom(3)
	defer s.Unsubscribe(sub)

	if replay.Reset {
		t.Fatal("SubscribeFrom requested an unexpected terminal reset")
	}
	if replay.Cursor != 3 {
		t.Fatalf("replay cursor = %d, want 3", replay.Cursor)
	}
	if got := string(replay.Data); got != "def" {
		t.Fatalf("replay data = %q, want %q", got, "def")
	}

	s.publishOutput([]byte("gh"))
	select {
	case got := <-sub.Output:
		if string(got) != "gh" {
			t.Fatalf("live data = %q, want %q", got, "gh")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for live output")
	}
}

func TestSlowSubscriberReconnectsBeforeOutputGap(t *testing.T) {
	s := NewSession("project", t.TempDir())
	sub, replay := s.SubscribeFrom(0)
	if len(replay.Data) != 0 {
		t.Fatalf("initial replay data = %q, want empty", replay.Data)
	}

	want := make([]byte, cap(sub.Output)+1)
	for i := 0; i < cap(sub.Output); i++ {
		want[i] = byte(i)
		s.publishOutput([]byte{want[i]})
	}
	want[len(want)-1] = '!'
	s.publishOutput(want[len(want)-1:])

	select {
	case <-sub.Overflow:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for overflow signal")
	}

	// The publisher must not consume the output channel while signaling
	// overflow. A writer may send any queued prefix before it observes the
	// signal, but that prefix must remain contiguous.
	first, ok := <-sub.Output
	if !ok || len(first) != 1 || first[0] != want[0] {
		t.Fatalf("first queued output = %v, open = %v, want %v", first, ok, want[0])
	}
	delivered := append([]byte(nil), first...)
drain:
	for {
		select {
		case data, open := <-sub.Output:
			if !open {
				break drain
			}
			delivered = append(delivered, data...)
		case <-sub.Overflow:
			break drain
		}
	}
	if got, expected := string(delivered), string(want[:len(delivered)]); got != expected {
		t.Fatalf("delivered output = %q, want contiguous prefix %q", got, expected)
	}
	// The handler also unsubscribes when its WebSocket exits; this must be safe
	// after publishOutput has already removed the slow subscriber.
	s.Unsubscribe(sub)

	retry, replay := s.SubscribeFrom(uint64(len(delivered)))
	defer s.Unsubscribe(retry)
	if got, expected := string(replay.Data), string(want[len(delivered):]); got != expected {
		t.Fatalf("retry replay = %q, want %q", got, expected)
	}
}

func TestSubscribeFromRequestsResetWhenCursorIsOutsideRetainedOutput(t *testing.T) {
	s := NewSession("project", t.TempDir())
	s.SetOutputLimit(5)
	s.appendOutput([]byte("abcdef"))

	for _, cursor := range []uint64{0, 99} {
		sub, replay := s.SubscribeFrom(cursor)
		if !replay.Reset {
			t.Errorf("cursor %d did not request a reset", cursor)
		}
		if replay.Cursor != 1 {
			t.Errorf("cursor %d replay starts at %d, want 1", cursor, replay.Cursor)
		}
		if got := string(replay.Data); got != "bcdef" {
			t.Errorf("cursor %d replay data = %q, want %q", cursor, got, "bcdef")
		}
		s.Unsubscribe(sub)
	}
}

func TestSubscribeFromCurrentCursorHasNoReplay(t *testing.T) {
	s := NewSession("project", t.TempDir())
	s.appendOutput([]byte("output"))

	sub, replay := s.SubscribeFrom(uint64(len("output")))
	defer s.Unsubscribe(sub)

	if replay.Reset {
		t.Fatal("current cursor requested an unexpected reset")
	}
	if len(replay.Data) != 0 {
		t.Fatalf("replay data = %q, want empty", replay.Data)
	}
}

func TestDefaultReplayHistoryRetainsLargeTerminalBurst(t *testing.T) {
	s := NewSession("project", t.TempDir())
	burst := make([]byte, 512*1024)
	for i := range burst {
		burst[i] = byte(i)
	}
	s.appendOutput(burst)

	sub, replay := s.SubscribeFrom(0)
	defer s.Unsubscribe(sub)
	if replay.Reset {
		t.Fatal("512 KiB burst unexpectedly fell out of default replay history")
	}
	if len(replay.Data) != len(burst) {
		t.Fatalf("replay length = %d, want %d", len(replay.Data), len(burst))
	}
}

func TestSessionRecordsWhenOutputLastArrived(t *testing.T) {
	s := NewSession("proj", "/tmp")

	if !s.LastOutputAt().IsZero() {
		t.Fatalf("LastOutputAt() = %v, want zero before any output", s.LastOutputAt())
	}

	before := time.Now()
	s.publishOutput([]byte("thinking..."))
	got := s.LastOutputAt()

	if got.Before(before) {
		t.Fatalf("LastOutputAt() = %v, want at or after %v", got, before)
	}
}

func TestSessionOutputTimestampAdvancesWithEachChunk(t *testing.T) {
	s := NewSession("proj", "/tmp")
	s.publishOutput([]byte("first"))
	first := s.LastOutputAt()

	time.Sleep(2 * time.Millisecond)
	s.publishOutput([]byte("second"))

	if !s.LastOutputAt().After(first) {
		t.Fatalf("LastOutputAt() = %v, want after %v", s.LastOutputAt(), first)
	}
}

func TestSessionStartCommandNeverIntegratesViaGitPull(t *testing.T) {
	for _, ffOnly := range []bool{false, true} {
		got := sessionStartCommand("claude", false, StartOptions{StartupGitPullFFOnly: ffOnly})

		if strings.Contains(got, "git pull") {
			t.Fatalf("sessionStartCommand(ffOnly=%v) = %q, must not use git pull: a duplicated FETCH_HEAD entry makes it refuse a clean fast-forward as divergent", ffOnly, got)
		}
	}
}
