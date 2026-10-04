package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	ptyPkg "agentdeck/internal/pty"
)

func TestParsePmsetBatteryOnACWhileNotCharging(t *testing.T) {
	out := "Now drawing from 'AC Power'\n -InternalBattery-0 (id=36044899)\t80%; AC attached; not charging present: true\n"
	state := parsePmsetBattery(out)

	if !state.Known {
		t.Fatal("expected a known battery state")
	}
	if state.OnBattery {
		t.Fatal("AC power must not read as on-battery just because it is not charging")
	}
	if state.Percent != 80 {
		t.Fatalf("percent = %d, want 80", state.Percent)
	}
}

func TestParsePmsetBatteryDischarging(t *testing.T) {
	out := "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=36044899)\t17%; discharging; 1:12 remaining present: true\n"
	state := parsePmsetBattery(out)

	if !state.OnBattery || state.Percent != 17 {
		t.Fatalf("got %+v, want on battery at 17%%", state)
	}
}

func TestParsePmsetBatteryUnparseable(t *testing.T) {
	for _, out := range []string{"", "Now drawing from 'AC Power'\n", "garbage\n"} {
		if state := parsePmsetBattery(out); state.Known {
			t.Fatalf("input %q gave %+v, want unknown", out, state)
		}
	}
}

func TestReadLinuxBattery(t *testing.T) {
	root := t.TempDir()
	bat := filepath.Join(root, "BAT0")
	if err := os.MkdirAll(bat, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "AC"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bat, "capacity"), []byte("42\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bat, "status"), []byte("Discharging\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	state := readLinuxBattery(root)
	if !state.Known || !state.OnBattery || state.Percent != 42 {
		t.Fatalf("got %+v, want on battery at 42%%", state)
	}
}

func TestReadLinuxBatteryWithoutBattery(t *testing.T) {
	if state := readLinuxBattery(t.TempDir()); state.Known {
		t.Fatalf("got %+v, want unknown", state)
	}
}

func TestReadLinuxBatteryOnAC(t *testing.T) {
	root := t.TempDir()
	bat := filepath.Join(root, "BAT1")
	if err := os.MkdirAll(bat, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bat, "capacity"), []byte("15"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bat, "status"), []byte("Charging"), 0o600); err != nil {
		t.Fatal(err)
	}

	state := readLinuxBattery(root)
	if state.OnBattery {
		t.Fatalf("got %+v, want on AC", state)
	}
}

func TestDecidePowerState(t *testing.T) {
	onAC := batteryState{Known: true, OnBattery: false, Percent: 80}
	lowOnBattery := batteryState{Known: true, OnBattery: true, Percent: 12}
	boundaryOnBattery := batteryState{Known: true, OnBattery: true, Percent: 20}
	unknownBattery := batteryState{}

	cases := []struct {
		name     string
		statuses map[string]ptyPkg.SessionStatus
		battery  batteryState
		enabled  bool
		inhibit  bool
		reason   string
	}{
		{
			name:     "busy session",
			statuses: map[string]ptyPkg.SessionStatus{"marketplace": {State: ptyPkg.StateBusy}},
			battery:  onAC,
			enabled:  true,
			inhibit:  true,
			reason:   "working: marketplace",
		},
		{
			name:     "background shell counts as working",
			statuses: map[string]ptyPkg.SessionStatus{"marketplace": {State: ptyPkg.StateShell}},
			battery:  onAC,
			enabled:  true,
			inhibit:  true,
			reason:   "working: marketplace",
		},
		{
			name:     "waiting session",
			statuses: map[string]ptyPkg.SessionStatus{"admin": {State: ptyPkg.StateWaiting}},
			battery:  onAC,
			enabled:  true,
			inhibit:  true,
			reason:   "waiting: admin",
		},
		{
			name:     "remote control while idle",
			statuses: map[string]ptyPkg.SessionStatus{"admin": {State: ptyPkg.StateIdle, RemoteControl: true}},
			battery:  onAC,
			enabled:  true,
			inhibit:  true,
			reason:   "remote control: admin",
		},
		{
			name: "grouped reason is sorted",
			statuses: map[string]ptyPkg.SessionStatus{
				"zeta":  {State: ptyPkg.StateBusy},
				"alpha": {State: ptyPkg.StateBusy},
				"admin": {State: ptyPkg.StateWaiting, RemoteControl: true},
			},
			battery: onAC,
			enabled: true,
			inhibit: true,
			reason:  "working: alpha, zeta; waiting: admin; remote control: admin",
		},
		{
			name:     "idle sessions only",
			statuses: map[string]ptyPkg.SessionStatus{"admin": {State: ptyPkg.StateIdle}},
			battery:  onAC,
			enabled:  true,
			inhibit:  false,
		},
		{
			name:     "unknown state does not inhibit",
			statuses: map[string]ptyPkg.SessionStatus{"admin": {State: ptyPkg.StateUnknown}},
			battery:  onAC,
			enabled:  true,
			inhibit:  false,
		},
		{
			name:     "no sessions",
			statuses: nil,
			battery:  onAC,
			enabled:  true,
			inhibit:  false,
		},
		{
			name:     "low battery releases",
			statuses: map[string]ptyPkg.SessionStatus{"marketplace": {State: ptyPkg.StateBusy}},
			battery:  lowOnBattery,
			enabled:  true,
			inhibit:  false,
			reason:   "working: marketplace; sleep allowed on low battery",
		},
		{
			name:     "at the threshold still inhibits",
			statuses: map[string]ptyPkg.SessionStatus{"marketplace": {State: ptyPkg.StateBusy}},
			battery:  boundaryOnBattery,
			enabled:  true,
			inhibit:  true,
			reason:   "working: marketplace",
		},
		{
			name:     "unknown battery inhibits",
			statuses: map[string]ptyPkg.SessionStatus{"marketplace": {State: ptyPkg.StateBusy}},
			battery:  unknownBattery,
			enabled:  true,
			inhibit:  true,
			reason:   "working: marketplace",
		},
		{
			name:     "disabled by settings",
			statuses: map[string]ptyPkg.SessionStatus{"marketplace": {State: ptyPkg.StateBusy}},
			battery:  onAC,
			enabled:  false,
			inhibit:  false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			state := decidePowerState(tc.statuses, tc.battery, tc.enabled)
			if state.Inhibit != tc.inhibit {
				t.Fatalf("inhibit = %v, want %v", state.Inhibit, tc.inhibit)
			}
			if state.Reason != tc.reason {
				t.Fatalf("reason = %q, want %q", state.Reason, tc.reason)
			}
			if state.Battery != tc.battery {
				t.Fatalf("battery = %+v, want %+v", state.Battery, tc.battery)
			}
		})
	}
}

func TestBatteryProbeCachesUntilTTLExpires(t *testing.T) {
	now := time.Unix(0, 0)
	reads := 0
	probe := &batteryProbe{
		ttl: 30 * time.Second,
		now: func() time.Time { return now },
		read: func() batteryState {
			reads++
			return batteryState{Known: true, Percent: reads}
		},
	}

	if got := probe.State().Percent; got != 1 {
		t.Fatalf("first read = %d, want 1", got)
	}
	now = now.Add(29 * time.Second)
	if got := probe.State().Percent; got != 1 {
		t.Fatalf("cached read = %d, want 1", got)
	}
	now = now.Add(2 * time.Second)
	if got := probe.State().Percent; got != 2 {
		t.Fatalf("refreshed read = %d, want 2", got)
	}
}

func TestPowerHoldsMachineAwakeForBusyOpencodeSession(t *testing.T) {
	statuses := map[string]ptyPkg.SessionStatus{
		"proj": {State: ptyPkg.StateBusy, Provider: "opencode"},
	}

	state := decidePowerState(statuses, batteryState{}, true)

	if !state.Inhibit {
		t.Fatal("Inhibit = false, want true while an opencode session is working")
	}
	if !strings.Contains(state.Reason, "working: proj") {
		t.Fatalf("Reason = %q, want it to name the working session", state.Reason)
	}
}

func TestPowerLetsMachineSleepForIdleOpencodeSession(t *testing.T) {
	statuses := map[string]ptyPkg.SessionStatus{
		"proj": {State: ptyPkg.StateIdle, Provider: "opencode"},
	}

	if decidePowerState(statuses, batteryState{}, true).Inhibit {
		t.Fatal("Inhibit = true, want false for an idle opencode session")
	}
}
