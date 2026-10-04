package pty

import (
	"path/filepath"
	"testing"
)

func TestLiveSessionLockedRemovesDeadSession(t *testing.T) {
	m := NewManager()
	s := NewSession("proj", t.TempDir())
	m.sessions["proj"] = s

	if got := m.liveSessionLocked("proj"); got != nil {
		t.Fatalf("liveSessionLocked returned dead session, want nil")
	}
	if _, ok := m.sessions["proj"]; ok {
		t.Fatalf("dead session remained in manager")
	}
}

func TestLiveSessionLockedKeepsLiveSession(t *testing.T) {
	m := NewManager()
	s := NewSession("proj", t.TempDir())
	s.alive = true
	m.sessions["proj"] = s

	if got := m.liveSessionLocked("proj"); got != s {
		t.Fatalf("liveSessionLocked returned %p, want %p", got, s)
	}
	if _, ok := m.sessions["proj"]; !ok {
		t.Fatalf("live session was removed from manager")
	}
}

func TestProjectSessionInfoRollsUpPanes(t *testing.T) {
	m := NewManager()
	for _, name := range []string{"proj", "proj#2", "proj@wt", "other"} {
		s := NewSession(name, t.TempDir())
		s.alive = true
		m.sessions[name] = s
	}
	m.statusProbe = &StatusProbe{statuses: map[string]SessionStatus{
		"proj":    {State: StateIdle, RemoteControl: true},
		"proj#2":  {State: StateWaiting, WaitingFor: "permission prompt"},
		"proj@wt": {State: StateBusy},
		"other":   {State: StateBusy},
	}}

	got := m.GetProjectSessionInfo("proj")
	if !got.HasSession || !got.SessionAlive {
		t.Fatalf("GetProjectSessionInfo(proj) = %+v, want a live session", got)
	}
	if got.SessionState != StateWaiting || got.WaitingFor != "permission prompt" {
		t.Fatalf("GetProjectSessionInfo(proj) state = %q/%q, want waiting", got.SessionState, got.WaitingFor)
	}
	if !got.RemoteControl {
		t.Fatalf("GetProjectSessionInfo(proj) dropped remote control from the primary pane")
	}
	if got.SessionWorking {
		t.Fatalf("GetProjectSessionInfo(proj) reported working, want false for idle plus waiting")
	}
}

func TestProjectSessionInfoSurvivesClosingTheOriginalPane(t *testing.T) {
	m := NewManager()
	s := NewSession("proj#2", t.TempDir())
	s.alive = true
	m.sessions["proj#2"] = s
	m.statusProbe = &StatusProbe{statuses: map[string]SessionStatus{"proj#2": {State: StateBusy}}}

	got := m.GetProjectSessionInfo("proj")
	if !got.HasSession || !got.SessionAlive || !got.SessionWorking {
		t.Fatalf("GetProjectSessionInfo(proj) = %+v, want the surviving pane reported", got)
	}
	if got.SessionState != StateBusy {
		t.Fatalf("GetProjectSessionInfo(proj) state = %q, want busy", got.SessionState)
	}
}

func TestProjectSessionInfoWithoutSessions(t *testing.T) {
	m := NewManager()
	if got := m.GetProjectSessionInfo("proj"); got.HasSession {
		t.Fatalf("GetProjectSessionInfo(proj) = %+v, want no session", got)
	}
}

func TestCreateWithCommandOutputLimitKeepsExistingSessionWhenStartFails(t *testing.T) {
	m := NewManager()
	old := NewSession("job-1", t.TempDir())
	old.appendOutput([]byte("previous run log"))
	m.sessions["job-1"] = old

	missingDir := filepath.Join(t.TempDir(), "missing")
	if _, err := m.CreateWithCommandOutputLimit("job-1", missingDir, 80, 24, "true", 1024); err == nil {
		t.Fatalf("CreateWithCommandOutputLimit returned nil error for missing directory")
	}

	if got := m.sessions["job-1"]; got != old {
		t.Fatalf("existing session was replaced after failed start")
	}
	if old.closed {
		t.Fatalf("existing session was closed after failed start")
	}
	if got := old.GetOutput(); got != "previous run log" {
		t.Fatalf("existing session output = %q, want previous run log", got)
	}
}

func TestManagerReportsActivityPerSession(t *testing.T) {
	m := NewManager()
	session := NewSession("proj", "/tmp")
	session.cli = "opencode"
	session.alive = true
	session.publishOutput([]byte("working"))
	m.sessions["proj"] = session

	activity := m.sessionActivity()

	got, ok := activity["proj"]
	if !ok {
		t.Fatal("sessionActivity() has no entry for proj")
	}
	if got.CLI != "opencode" {
		t.Fatalf("CLI = %q, want opencode", got.CLI)
	}
	if got.LastOutput.IsZero() {
		t.Fatal("LastOutput is zero, want the publish timestamp")
	}
}

func TestManagerOmitsDeadSessionsFromActivity(t *testing.T) {
	m := NewManager()
	session := NewSession("proj", "/tmp")
	session.cli = "opencode"
	session.alive = false
	m.sessions["proj"] = session

	if _, ok := m.sessionActivity()["proj"]; ok {
		t.Fatal("sessionActivity() includes a dead session, want it omitted")
	}
}

func TestManagerStoresResolvedCLIOnTheSession(t *testing.T) {
	m := NewManager()
	m.SetCLI("opencode")

	if got := NormalizeCLI(m.DefaultCLI(), nil); got != "opencode" {
		t.Fatalf("DefaultCLI normalizes to %q, want opencode", got)
	}
	session := NewSession("proj", "/tmp")
	session.setCLI("opencode")
	if session.CLI() != "opencode" {
		t.Fatalf("CLI() = %q, want opencode", session.CLI())
	}
}

func TestGetOrCreateStoresTheResolvedCLI(t *testing.T) {
	t.Setenv("SHELL", "/bin/sh")
	dir := t.TempDir()
	m := NewManager()
	m.SetCLI("opencode")

	session, err := m.GetOrCreateWithOptions("proj", dir, 80, 24, "", StartOptions{SkipStartupGitPull: true})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Remove("proj")

	if session.CLI() != "opencode" {
		t.Fatalf("CLI() = %q, want opencode from the manager default", session.CLI())
	}
}

func TestGetOrCreateStoresTheOverrideCLI(t *testing.T) {
	t.Setenv("SHELL", "/bin/sh")
	dir := t.TempDir()
	m := NewManager()
	m.SetCLI("claude")

	session, err := m.GetOrCreateWithOptions("proj", dir, 80, 24, "opencode", StartOptions{SkipStartupGitPull: true})
	if err != nil {
		t.Fatal(err)
	}
	defer m.Remove("proj")

	if session.CLI() != "opencode" {
		t.Fatalf("CLI() = %q, want the override to win", session.CLI())
	}
}
