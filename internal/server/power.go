package server

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	ptyPkg "agentdeck/internal/pty"
)

// Below this charge, running on battery, agent activity no longer keeps the
// machine awake.
const lowBatteryPercent = 20

const batteryCacheTTL = 30 * time.Second

type batteryState struct {
	Known     bool `json:"known"`
	OnBattery bool `json:"on_battery"`
	Percent   int  `json:"percent"`
}

type powerState struct {
	Inhibit bool         `json:"inhibit"`
	Reason  string       `json:"reason,omitempty"`
	Battery batteryState `json:"battery"`
}

type batteryProbe struct {
	mu        sync.Mutex
	read      func() batteryState
	ttl       time.Duration
	now       func() time.Time
	value     batteryState
	fetchedAt time.Time
}

func newBatteryProbe() *batteryProbe {
	return &batteryProbe{read: readBattery, ttl: batteryCacheTTL, now: time.Now}
}

func (p *batteryProbe) State() batteryState {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.now()
	if !p.fetchedAt.IsZero() && now.Sub(p.fetchedAt) < p.ttl {
		return p.value
	}
	p.value = p.read()
	p.fetchedAt = now
	return p.value
}

// decidePowerState reports whether the machine should be kept awake, and why.
func decidePowerState(statuses map[string]ptyPkg.SessionStatus, battery batteryState, enabled bool) powerState {
	state := powerState{Battery: battery}
	if !enabled {
		return state
	}

	var working, waiting, remote []string
	for _, name := range ptyPkg.SortedNames(statuses) {
		status := statuses[name]
		switch {
		case status.Working():
			working = append(working, name)
		case status.State == ptyPkg.StateWaiting:
			waiting = append(waiting, name)
		}
		if status.RemoteControl {
			remote = append(remote, name)
		}
	}

	groups := make([]string, 0, 3)
	for _, group := range []struct {
		label string
		names []string
	}{
		{"working", working},
		{"waiting", waiting},
		{"remote control", remote},
	} {
		if len(group.names) > 0 {
			groups = append(groups, group.label+": "+strings.Join(group.names, ", "))
		}
	}
	if len(groups) == 0 {
		return state
	}

	state.Reason = strings.Join(groups, "; ")
	if battery.Known && battery.OnBattery && battery.Percent < lowBatteryPercent {
		state.Reason += "; sleep allowed on low battery"
		return state
	}
	state.Inhibit = true
	return state
}

func readBattery() batteryState {
	switch runtime.GOOS {
	case "darwin":
		out, err := exec.Command("pmset", "-g", "batt").Output()
		if err != nil {
			return batteryState{}
		}
		return parsePmsetBattery(string(out))
	case "linux":
		return readLinuxBattery("/sys/class/power_supply")
	default:
		return batteryState{}
	}
}

var pmsetPercent = regexp.MustCompile(`(\d{1,3})%`)

// parsePmsetBattery reads the power source from the "Now drawing from" line
// rather than the charging flag, because macOS reports "AC attached; not
// charging" during normal optimized charging.
func parsePmsetBattery(out string) batteryState {
	if !strings.Contains(out, "'Battery Power'") && !strings.Contains(out, "'AC Power'") {
		return batteryState{}
	}
	state := batteryState{Known: true, OnBattery: strings.Contains(out, "'Battery Power'")}
	if match := pmsetPercent.FindStringSubmatch(out); match != nil {
		percent, err := strconv.Atoi(match[1])
		if err != nil {
			return batteryState{}
		}
		state.Percent = percent
		return state
	}
	return batteryState{}
}

func readLinuxBattery(root string) batteryState {
	entries, err := os.ReadDir(root)
	if err != nil {
		return batteryState{}
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "BAT") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		capacity, err := readTrimmedFile(filepath.Join(root, name, "capacity"))
		if err != nil {
			continue
		}
		percent, err := strconv.Atoi(capacity)
		if err != nil {
			continue
		}
		status, _ := readTrimmedFile(filepath.Join(root, name, "status"))
		return batteryState{Known: true, OnBattery: status == "Discharging", Percent: percent}
	}
	return batteryState{}
}

func readTrimmedFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func (a *apiHandler) handlePower(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	enabled := !a.cfg.DisableSleepPrevention
	a.mu.RUnlock()

	writeJSON(w, decidePowerState(a.manager.SessionStatuses(), a.battery.State(), enabled))
}

func (a *apiHandler) handleSessionStatuses(w http.ResponseWriter, r *http.Request) {
	statuses := a.manager.SessionStatuses()
	out := make(map[string]ptyPkg.SessionStatus, len(statuses))
	for name, status := range statuses {
		out[name] = status
	}
	writeJSON(w, out)
}
