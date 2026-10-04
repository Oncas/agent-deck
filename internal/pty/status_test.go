package pty

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeSessionFile(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func newTestProbe(t *testing.T, dir string, pids map[string]int, psOutput string) *StatusProbe {
	t.Helper()
	probe := NewStatusProbe(dir, func() map[string]int { return pids })
	probe.ps = func() (string, error) { return psOutput, nil }
	return probe
}

func TestAgentSessionsDirUsesConfigDirOverride(t *testing.T) {
	t.Setenv("CLAUDE_CONFIG_DIR", "/custom/claude")
	if got, want := AgentSessionsDir(), filepath.Join("/custom/claude", "sessions"); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestAgentSessionsDirDefaultsToHome(t *testing.T) {
	t.Setenv("CLAUDE_CONFIG_DIR", "")
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home directory")
	}
	if got, want := AgentSessionsDir(), filepath.Join(home, ".claude", "sessions"); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestRefreshReportsEachState(t *testing.T) {
	states := []struct {
		raw   string
		state string
	}{
		{"busy", StateBusy},
		{"waiting", StateWaiting},
		{"shell", StateShell},
		{"idle", StateIdle},
		{"completed", StateCompleted},
		{"reticulating", StateUnknown},
	}

	for _, tc := range states {
		t.Run(tc.raw, func(t *testing.T) {
			dir := t.TempDir()
			writeSessionFile(t, dir, "200.json", `{"pid":200,"status":"`+tc.raw+`"}`)
			probe := newTestProbe(t, dir, map[string]int{"proj": 100}, "  PID  PPID\n100 1\n200 100\n")
			probe.Refresh()

			if got := probe.Status("proj").State; got != tc.state {
				t.Fatalf("state = %q, want %q", got, tc.state)
			}
		})
	}
}

func TestRefreshCarriesWaitingReasonAndRemoteControl(t *testing.T) {
	dir := t.TempDir()
	writeSessionFile(t, dir, "200.json", `{"pid":200,"status":"waiting","waitingFor":"permission prompt","bridgeSessionId":"session_01","sessionId":"claude-123","name":"patient-otter"}`)
	probe := newTestProbe(t, dir, map[string]int{"proj": 100}, "100 1\n200 100\n")
	probe.Refresh()

	status := probe.Status("proj")
	if status.WaitingFor != "permission prompt" {
		t.Fatalf("waiting reason = %q", status.WaitingFor)
	}
	if !status.RemoteControl {
		t.Fatal("expected remote control")
	}
	if status.Provider != "claude" || status.SessionID != "claude-123" || status.AgentName != "patient-otter" {
		t.Fatalf("agent identity = %+v", status)
	}
}

func TestRefreshTurnsClaudeIdleIntoCompletedAfterWork(t *testing.T) {
	dir := t.TempDir()
	writeSessionFile(t, dir, "200.json", `{"pid":200,"status":"busy","sessionId":"claude-123"}`)
	probe := newTestProbe(t, dir, map[string]int{"proj": 100}, "100 1\n200 100\n")
	probe.Refresh()

	writeSessionFile(t, dir, "200.json", `{"pid":200,"status":"idle","sessionId":"claude-123"}`)
	probe.Refresh()
	if got := probe.Status("proj").State; got != StateCompleted {
		t.Fatalf("state after busy -> idle = %q, want completed", got)
	}

	probe.Refresh()
	if got := probe.Status("proj").State; got != StateCompleted {
		t.Fatalf("completed state was not retained: %q", got)
	}
}

func TestPreserveCompletedStateDoesNotCrossSessionBoundaries(t *testing.T) {
	tests := []struct {
		name     string
		status   SessionStatus
		previous SessionStatus
	}{
		{
			name:     "provider changed",
			status:   SessionStatus{State: StateIdle, Provider: "claude", SessionID: "claude-new"},
			previous: SessionStatus{State: StateCompleted, Provider: "openai", SessionID: "codex-old"},
		},
		{
			name:     "Claude session changed",
			status:   SessionStatus{State: StateIdle, Provider: "claude", SessionID: "claude-new"},
			previous: SessionStatus{State: StateCompleted, Provider: "claude", SessionID: "claude-old"},
		},
		{
			name:     "session identity unavailable",
			status:   SessionStatus{State: StateIdle, Provider: "claude"},
			previous: SessionStatus{State: StateBusy, Provider: "claude"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := preserveCompletedState(tc.status, tc.previous).State; got != StateIdle {
				t.Fatalf("state = %q, want idle", got)
			}
		})
	}
}

func TestRefreshInfersClaudeCompletedAfterProbeRestart(t *testing.T) {
	dir := t.TempDir()
	writeSessionFile(t, dir, "200.json", `{"pid":200,"status":"idle","startedAt":1000,"statusUpdatedAt":2000,"sessionId":"claude-123"}`)
	probe := newTestProbe(t, dir, map[string]int{"proj": 100}, "100 1\n200 100\n")
	probe.Refresh()

	if got := probe.Status("proj").State; got != StateCompleted {
		t.Fatalf("idle Claude session with a later status update = %q, want completed", got)
	}
}

func TestRefreshDropsWaitingReasonWhenNotWaiting(t *testing.T) {
	dir := t.TempDir()
	writeSessionFile(t, dir, "200.json", `{"pid":200,"status":"busy","waitingFor":"permission prompt"}`)
	probe := newTestProbe(t, dir, map[string]int{"proj": 100}, "100 1\n200 100\n")
	probe.Refresh()

	if got := probe.Status("proj").WaitingFor; got != "" {
		t.Fatalf("waiting reason = %q, want empty", got)
	}
}

func TestRefreshFindsAgentThroughGrandchild(t *testing.T) {
	dir := t.TempDir()
	writeSessionFile(t, dir, "300.json", `{"pid":300,"status":"busy"}`)
	probe := newTestProbe(t, dir, map[string]int{"proj": 100}, "100 1\n200 100\n300 200\n")
	probe.Refresh()

	if got := probe.Status("proj").State; got != StateBusy {
		t.Fatalf("state = %q, want busy", got)
	}
}

func TestRefreshIgnoresSessionsOfOtherProjects(t *testing.T) {
	dir := t.TempDir()
	writeSessionFile(t, dir, "200.json", `{"pid":200,"status":"busy"}`)
	writeSessionFile(t, dir, "400.json", `{"pid":400,"status":"waiting"}`)
	probe := newTestProbe(t, dir, map[string]int{"a": 100, "b": 300}, "100 1\n200 100\n300 1\n400 300\n")
	probe.Refresh()

	if got := probe.Status("a").State; got != StateBusy {
		t.Fatalf("a = %q, want busy", got)
	}
	if got := probe.Status("b").State; got != StateWaiting {
		t.Fatalf("b = %q, want waiting", got)
	}
}

func TestRefreshIgnoresStaleSessionFile(t *testing.T) {
	dir := t.TempDir()
	writeSessionFile(t, dir, "999.json", `{"pid":999,"status":"busy"}`)
	probe := newTestProbe(t, dir, map[string]int{"proj": 100}, "100 1\n")
	probe.Refresh()

	if got := probe.Status("proj").State; got != StateUnknown {
		t.Fatalf("state = %q, want unknown", got)
	}
}

func TestRefreshPrefersMostNotableDescendant(t *testing.T) {
	dir := t.TempDir()
	writeSessionFile(t, dir, "200.json", `{"pid":200,"status":"idle","bridgeSessionId":"session_01"}`)
	writeSessionFile(t, dir, "300.json", `{"pid":300,"status":"waiting","waitingFor":"input needed"}`)
	probe := newTestProbe(t, dir, map[string]int{"proj": 100}, "100 1\n200 100\n300 200\n")
	probe.Refresh()

	status := probe.Status("proj")
	if status.State != StateWaiting {
		t.Fatalf("state = %q, want waiting", status.State)
	}
	if status.WaitingFor != "input needed" {
		t.Fatalf("waiting reason = %q", status.WaitingFor)
	}
	if !status.RemoteControl {
		t.Fatal("remote control from a sibling process should be retained")
	}
}

func TestRefreshSkipsMalformedAndForeignFiles(t *testing.T) {
	dir := t.TempDir()
	writeSessionFile(t, dir, "200.json", `{"pid":200,`)
	writeSessionFile(t, dir, "notes.json", `{"pid":300,"status":"busy"}`)
	writeSessionFile(t, dir, "300.json", `{"pid":300,"status":"busy"}`)
	probe := newTestProbe(t, dir, map[string]int{"proj": 100}, "100 1\n200 100\n300 100\n")
	probe.Refresh()

	if got := probe.Status("proj").State; got != StateBusy {
		t.Fatalf("state = %q, want busy", got)
	}
}

func TestRefreshWithMissingDirectoryReportsUnknown(t *testing.T) {
	probe := newTestProbe(t, filepath.Join(t.TempDir(), "absent"), map[string]int{"proj": 100}, "100 1\n")
	probe.Refresh()

	if got := probe.Status("proj").State; got != StateUnknown {
		t.Fatalf("state = %q, want unknown", got)
	}
}

func TestRefreshClearsStatusesWhenProcessTableUnavailable(t *testing.T) {
	dir := t.TempDir()
	writeSessionFile(t, dir, "200.json", `{"pid":200,"status":"busy"}`)
	probe := newTestProbe(t, dir, map[string]int{"proj": 100}, "100 1\n200 100\n")
	probe.Refresh()
	if got := probe.Status("proj").State; got != StateBusy {
		t.Fatalf("state = %q, want busy", got)
	}

	probe.ps = func() (string, error) { return "", os.ErrPermission }
	probe.Refresh()

	if got := probe.Status("proj").State; got != StateUnknown {
		t.Fatalf("state = %q, want unknown", got)
	}
}

func TestStatusesSnapshotIsACopy(t *testing.T) {
	dir := t.TempDir()
	writeSessionFile(t, dir, "200.json", `{"pid":200,"status":"busy"}`)
	probe := newTestProbe(t, dir, map[string]int{"proj": 100}, "100 1\n200 100\n")
	probe.Refresh()

	snapshot := probe.Statuses()
	snapshot["proj"] = SessionStatus{State: StateIdle}

	if got := probe.Status("proj").State; got != StateBusy {
		t.Fatalf("state = %q, want busy", got)
	}
}

func TestRefreshTracksCodexRolloutLifecycleAndIdentity(t *testing.T) {
	dir := t.TempDir()
	rollout := filepath.Join(dir, "rollout-2026-08-07T12-00-00-thread-123.jsonl")
	writeSessionFile(t, dir, filepath.Base(rollout), strings.Join([]string{
		`{"type":"session_meta","payload":{"id":"thread-123","session_id":"thread-123"}}`,
		`{"type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1"}}`,
	}, "\n")+"\n")

	probe := newTestProbe(t, filepath.Join(dir, "missing-claude"), map[string]int{"proj": 100}, "100 1 shell\n200 100 codex\n")
	probe.codexRollouts = func(pid int) []string {
		if pid == 200 {
			return []string{rollout}
		}
		return nil
	}
	probe.Refresh()

	status := probe.Status("proj")
	if status.State != StateBusy || status.Provider != "openai" || status.SessionID != "thread-123" {
		t.Fatalf("Codex working status = %+v", status)
	}

	appendRolloutEvent(t, rollout, `{"type":"event_msg","payload":{"type":"request_user_input","turn_id":"turn-1"}}`)
	probe.Refresh()
	status = probe.Status("proj")
	if status.State != StateWaiting || status.WaitingFor != "answer" {
		t.Fatalf("Codex input status = %+v", status)
	}

	appendRolloutEvent(t, rollout, `{"type":"event_msg","payload":{"type":"dynamic_tool_call_response","turn_id":"turn-1"}}`)
	probe.Refresh()
	if got := probe.Status("proj").State; got != StateBusy {
		t.Fatalf("Codex resumed state = %q, want busy", got)
	}

	appendRolloutEvent(t, rollout, `{"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1"}}`)
	probe.Refresh()
	if got := probe.Status("proj").State; got != StateCompleted {
		t.Fatalf("Codex completed state = %q, want completed", got)
	}
}

func TestRefreshPrefersBusyCodexProcessOverWaitingSibling(t *testing.T) {
	dir := t.TempDir()
	busyRollout := filepath.Join(dir, "rollout-busy.jsonl")
	waitingRollout := filepath.Join(dir, "rollout-waiting.jsonl")
	writeSessionFile(t, dir, filepath.Base(busyRollout), strings.Join([]string{
		`{"type":"session_meta","payload":{"id":"busy-thread"}}`,
		`{"type":"event_msg","payload":{"type":"task_started"}}`,
	}, "\n")+"\n")
	writeSessionFile(t, dir, filepath.Base(waitingRollout), strings.Join([]string{
		`{"type":"session_meta","payload":{"id":"waiting-thread"}}`,
		`{"type":"event_msg","payload":{"type":"request_user_input"}}`,
	}, "\n")+"\n")

	probe := newTestProbe(t, filepath.Join(dir, "missing-claude"), map[string]int{"proj": 100}, "100 1 shell\n200 100 codex\n300 100 codex\n")
	probe.codexRollouts = func(pid int) []string {
		switch pid {
		case 200:
			return []string{busyRollout}
		case 300:
			return []string{waitingRollout}
		default:
			return nil
		}
	}
	probe.Refresh()

	status := probe.Status("proj")
	if status.State != StateBusy || status.SessionID != "busy-thread" {
		t.Fatalf("Codex aggregate status = %+v, want busy-thread working", status)
	}
}

func TestRefreshIgnoresCodexOutsideSessionProcessTree(t *testing.T) {
	dir := t.TempDir()
	rollout := filepath.Join(dir, "rollout-foreign.jsonl")
	writeSessionFile(t, dir, filepath.Base(rollout), `{"type":"event_msg","payload":{"type":"task_started"}}`+"\n")
	probe := newTestProbe(t, filepath.Join(dir, "missing-claude"), map[string]int{"proj": 100}, "100 1 shell\n200 999 codex\n")
	probe.codexRollouts = func(int) []string { return []string{rollout} }
	probe.Refresh()

	if got := probe.Status("proj").State; got != StateUnknown {
		t.Fatalf("foreign Codex state = %q, want unknown", got)
	}
}

func appendRolloutEvent(t *testing.T, path, event string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatalf("open rollout: %v", err)
	}
	defer f.Close()
	if _, err := f.WriteString(event + "\n"); err != nil {
		t.Fatalf("append rollout: %v", err)
	}
}

func TestSessionStatusPredicates(t *testing.T) {
	cases := []struct {
		status  SessionStatus
		working bool
		active  bool
	}{
		{SessionStatus{State: StateBusy}, true, true},
		{SessionStatus{State: StateShell}, true, true},
		{SessionStatus{State: StateWaiting}, false, true},
		{SessionStatus{State: StateIdle}, false, false},
		{SessionStatus{State: StateCompleted}, false, false},
		{SessionStatus{State: StateIdle, RemoteControl: true}, false, true},
		{SessionStatus{State: StateUnknown}, false, false},
	}
	for _, tc := range cases {
		if got := tc.status.Working(); got != tc.working {
			t.Errorf("%+v Working() = %v, want %v", tc.status, got, tc.working)
		}
		if got := tc.status.Active(); got != tc.active {
			t.Errorf("%+v Active() = %v, want %v", tc.status, got, tc.active)
		}
	}
}

func TestIsDescendantOfStopsOnCycle(t *testing.T) {
	parents := map[int]int{10: 11, 11: 10}
	if isDescendantOf(parents, 10, 999) {
		t.Fatal("cycle should not resolve to an unrelated ancestor")
	}
}

func TestParseProcessTableSkipsHeaderAndGarbage(t *testing.T) {
	parents := parseProcessTable("  PID  PPID COMMAND\n  100     1 shell\nnot a row\n  200   100 codex\n")
	if len(parents) != 2 {
		t.Fatalf("parsed %d rows, want 2", len(parents))
	}
	if parents[200] != 100 {
		t.Fatalf("parent of 200 = %d, want 100", parents[200])
	}
	commands := parseProcessCommands("  PID  PPID COMMAND\n  100     1 shell\nnot a row\n  200   100 /usr/bin/codex\n")
	if commands[200] != "/usr/bin/codex" || !isCodexProcess(commands[200]) {
		t.Fatalf("command of 200 = %q, want Codex", commands[200])
	}
}

func TestOpencodeSessionIsBusyWhileOutputIsRecent(t *testing.T) {
	now := time.Now()
	activity := map[string]sessionActivity{
		"proj": {CLI: "opencode", LastOutput: now.Add(-1 * time.Second)},
	}

	status, ok := resolveOpencodeSessionStatus(activity, "proj", now)

	if !ok {
		t.Fatal("resolveOpencodeSessionStatus reported nothing, want a status")
	}
	if status.State != StateBusy {
		t.Fatalf("State = %q, want %q", status.State, StateBusy)
	}
	if status.Provider != "opencode" {
		t.Fatalf("Provider = %q, want opencode", status.Provider)
	}
}

func TestOpencodeSessionIsIdleOnceOutputGoesQuiet(t *testing.T) {
	now := time.Now()
	activity := map[string]sessionActivity{
		"proj": {CLI: "opencode", LastOutput: now.Add(-30 * time.Second)},
	}

	status, ok := resolveOpencodeSessionStatus(activity, "proj", now)

	if !ok {
		t.Fatal("resolveOpencodeSessionStatus reported nothing, want a status")
	}
	if status.State != StateIdle {
		t.Fatalf("State = %q, want %q", status.State, StateIdle)
	}
}

func TestOpencodeProbeIgnoresOtherProviders(t *testing.T) {
	now := time.Now()
	activity := map[string]sessionActivity{
		"proj": {CLI: "claude", LastOutput: now},
	}

	if _, ok := resolveOpencodeSessionStatus(activity, "proj", now); ok {
		t.Fatal("resolveOpencodeSessionStatus claimed a claude session, want it ignored")
	}
}

func TestOpencodeSessionWithoutOutputYetIsIdle(t *testing.T) {
	now := time.Now()
	activity := map[string]sessionActivity{
		"proj": {CLI: "opencode"},
	}

	status, ok := resolveOpencodeSessionStatus(activity, "proj", now)

	if !ok {
		t.Fatal("resolveOpencodeSessionStatus reported nothing, want a status")
	}
	if status.State != StateIdle {
		t.Fatalf("State = %q, want %q for a session that has produced no output", status.State, StateIdle)
	}
}

func TestOpencodeBusySessionKeepsTheMachineAwake(t *testing.T) {
	status := SessionStatus{State: StateBusy, Provider: "opencode"}

	if !status.Active() {
		t.Fatal("Active() = false, want true so /api/power holds the machine awake")
	}
}

func TestRefreshFallsBackToOpencodeOutputActivity(t *testing.T) {
	probe := NewStatusProbe("", func() map[string]int { return map[string]int{"proj": 100} })
	probe.ps = func() (string, error) { return "  PID  PPID COMMAND\n  100     1 sh\n", nil }
	probe.activity = func() map[string]sessionActivity {
		return map[string]sessionActivity{"proj": {CLI: "opencode", LastOutput: time.Now()}}
	}

	probe.Refresh()

	if got := probe.Status("proj"); got.State != StateBusy || got.Provider != "opencode" {
		t.Fatalf("Status(proj) = %+v, want a busy opencode status", got)
	}
}

func TestRefreshPrefersClaudeSessionFilesOverOutputActivity(t *testing.T) {
	dir := t.TempDir()
	writeSessionFile(t, dir, "100.json", `{"pid":100,"status":"waiting","session_id":"abc","waiting_for":"input"}`)

	probe := NewStatusProbe(dir, func() map[string]int { return map[string]int{"proj": 100} })
	probe.ps = func() (string, error) { return "  PID  PPID COMMAND\n  100     1 sh\n", nil }
	probe.activity = func() map[string]sessionActivity {
		return map[string]sessionActivity{"proj": {CLI: "opencode", LastOutput: time.Now()}}
	}

	probe.Refresh()

	got := probe.Status("proj")
	if got.Provider != "claude" || got.State != StateWaiting {
		t.Fatalf("Status(proj) = %+v, want the claude session file to win", got)
	}
}
