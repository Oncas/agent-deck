package pty

import "testing"

func TestStartCommandUsesSafeDefaults(t *testing.T) {
	tests := []struct {
		name string
		cli  string
		want string
	}{
		{name: "empty defaults claude", cli: "", want: "claude"},
		{name: "unknown defaults claude", cli: "unknown", want: "claude"},
		{name: "claude", cli: "claude", want: "claude"},
		{name: "cursor", cli: "cursor", want: "cursor-agent"},
		{name: "openai", cli: "openai", want: "codex"},
		{name: "gemini", cli: "gemini", want: "gemini"},
		{name: "headroom wrapper defaults claude", cli: "headroom", want: "claude"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := StartCommand(tt.cli, false); got != tt.want {
				t.Fatalf("StartCommand(%q, false) = %q, want %q", tt.cli, got, tt.want)
			}
		})
	}
}

func TestStartCommandUsesDangerousFlags(t *testing.T) {
	tests := []struct {
		name string
		cli  string
		want string
	}{
		{name: "empty defaults claude", cli: "", want: "claude --dangerously-skip-permissions"},
		{name: "unknown defaults claude", cli: "unknown", want: "claude --dangerously-skip-permissions"},
		{name: "claude", cli: "claude", want: "claude --dangerously-skip-permissions"},
		{name: "cursor", cli: "cursor", want: "cursor-agent -f"},
		{name: "openai", cli: "openai", want: "codex --dangerously-bypass-approvals-and-sandbox"},
		{name: "gemini", cli: "gemini", want: "gemini --yolo"},
		{name: "headroom wrapper defaults claude", cli: "headroom", want: "claude --dangerously-skip-permissions"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := StartCommand(tt.cli, true); got != tt.want {
				t.Fatalf("StartCommand(%q, true) = %q, want %q", tt.cli, got, tt.want)
			}
		})
	}
}

func TestStartCommandUsesCustomIntegration(t *testing.T) {
	options := StartOptions{
		CLIIntegrations: map[string]CLIIntegration{
			"headroom-codex": {
				ID:      "headroom-codex",
				Command: "headroom codex",
			},
		},
	}

	if got := StartCommandWithOptions("headroom-codex", false, options); got != "headroom codex" {
		t.Fatalf("StartCommandWithOptions(custom) = %q, want %q", got, "headroom codex")
	}
}

func TestStartCommandUsesCustomResumeIntegration(t *testing.T) {
	options := StartOptions{
		CLIIntegrations: map[string]CLIIntegration{
			"custom": {
				ID:            "custom",
				Command:       "custom-cli --yolo",
				ResumeCommand: "custom-cli resume --last --yolo",
			},
		},
	}

	if got := StartCommandWithOptions("custom", true, options); got != "custom-cli --yolo" {
		t.Fatalf("StartCommandWithOptions(custom, dangerous) = %q, want %q", got, "custom-cli --yolo")
	}
	options.ResumeLast = true
	if got := StartCommandWithOptions("custom", false, options); got != "custom-cli resume --last --yolo" {
		t.Fatalf("StartCommandWithOptions(custom, resume) = %q, want %q", got, "custom-cli resume --last --yolo")
	}
}

func TestStartCommandDoesNotAllowCustomIntegrationToOverrideBuiltin(t *testing.T) {
	options := StartOptions{
		ResumeLast: true,
		CLIIntegrations: map[string]CLIIntegration{
			"openai": {
				ID:      "openai",
				Command: "headroom codex",
			},
		},
	}

	if got := StartCommandWithOptions("openai", false, options); got != "codex resume --last" {
		t.Fatalf("StartCommandWithOptions(openai override) = %q, want %q", got, "codex resume --last")
	}
}

func TestStartCommandResumeLast(t *testing.T) {
	if got := StartCommandWithOptions("openai", false, StartOptions{ResumeLast: true}); got != "codex resume --last" {
		t.Fatalf("StartCommandWithOptions(openai, false, resume) = %q, want codex resume --last", got)
	}
	if got := StartCommandWithOptions("openai", true, StartOptions{ResumeLast: true}); got != "codex resume --last --dangerously-bypass-approvals-and-sandbox" {
		t.Fatalf("StartCommandWithOptions(openai, true, resume) = %q, want codex resume --last --dangerously-bypass-approvals-and-sandbox", got)
	}
	if got := StartCommandWithOptions("claude", false, StartOptions{ResumeLast: true}); got != "claude" {
		t.Fatalf("StartCommandWithOptions(claude, false, resume) = %q, want claude", got)
	}
}

func TestStartCommandSupportsOpencode(t *testing.T) {
	tests := []struct {
		name      string
		dangerous bool
		resume    bool
		want      string
	}{
		{name: "plain", want: "opencode"},
		{name: "dangerous", dangerous: true, want: "opencode --auto"},
		{name: "resume", resume: true, want: "opencode --continue"},
		{name: "resume dangerous", resume: true, dangerous: true, want: "opencode --continue --auto"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := StartCommandWithOptions("opencode", tt.dangerous, StartOptions{ResumeLast: tt.resume})
			if got != tt.want {
				t.Fatalf("StartCommandWithOptions(opencode, %v, resume=%v) = %q, want %q", tt.dangerous, tt.resume, got, tt.want)
			}
		})
	}
}

func TestOpencodeIsBuiltinCLI(t *testing.T) {
	if !IsBuiltinCLI("opencode") {
		t.Fatal("IsBuiltinCLI(opencode) = false, want true")
	}
	if got := NormalizeCLI("opencode", nil); got != "opencode" {
		t.Fatalf("NormalizeCLI(opencode) = %q, want opencode", got)
	}
}

func TestKimiStartCommand(t *testing.T) {
	tests := []struct {
		name      string
		dangerous bool
		resume    bool
		want      string
	}{
		{name: "plain", want: "kimi"},
		{name: "dangerous", dangerous: true, want: "kimi --auto"},
		{name: "resume", resume: true, want: "kimi --continue"},
		{name: "resume dangerous", resume: true, dangerous: true, want: "kimi --continue --auto"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := StartCommandWithOptions("kimi", tt.dangerous, StartOptions{ResumeLast: tt.resume})
			if got != tt.want {
				t.Fatalf("StartCommandWithOptions(kimi, %v, resume=%v) = %q, want %q", tt.dangerous, tt.resume, got, tt.want)
			}
		})
	}
}

func TestKimiIsBuiltinCLI(t *testing.T) {
	if !IsBuiltinCLI("kimi") {
		t.Fatal("IsBuiltinCLI(kimi) = false, want true")
	}
	if got := NormalizeCLI("kimi", nil); got != "kimi" {
		t.Fatalf("NormalizeCLI(kimi) = %q, want kimi", got)
	}
}

func TestCustomIntegrationCannotOverrideOpencode(t *testing.T) {
	options := StartOptions{CLIIntegrations: map[string]CLIIntegration{
		"opencode": {ID: "opencode", Command: "hijacked"},
	}}
	if got := StartCommandWithOptions("opencode", false, options); got != "opencode" {
		t.Fatalf("StartCommandWithOptions(opencode override) = %q, want opencode", got)
	}
}

func TestJobCommandRunsSelectedCLINonInteractively(t *testing.T) {
	tests := []struct {
		cli       string
		safe      string
		dangerous string
	}{
		{cli: "", safe: "claude -p 'hi'", dangerous: "claude -p --dangerously-skip-permissions 'hi'"},
		{cli: "unknown", safe: "claude -p 'hi'", dangerous: "claude -p --dangerously-skip-permissions 'hi'"},
		{cli: "claude", safe: "claude -p 'hi'", dangerous: "claude -p --dangerously-skip-permissions 'hi'"},
		{cli: "openai", safe: "codex exec 'hi'", dangerous: "codex exec --dangerously-bypass-approvals-and-sandbox 'hi'"},
		{cli: "gemini", safe: "gemini -p 'hi'", dangerous: "gemini --yolo -p 'hi'"},
		{cli: "cursor", safe: "cursor-agent -p 'hi'", dangerous: "cursor-agent -p -f 'hi'"},
		{cli: "opencode", safe: "opencode run 'hi'", dangerous: "opencode run --auto 'hi'"},
		{cli: "kimi", safe: "kimi -p 'hi'", dangerous: "kimi -p 'hi'"},
	}
	for _, tt := range tests {
		t.Run(tt.cli, func(t *testing.T) {
			got, err := JobCommand(tt.cli, nil, "'hi'", nil)
			if err != nil || got != tt.safe {
				t.Fatalf("JobCommand(%q, safe) = %q, %v; want %q", tt.cli, got, err, tt.safe)
			}
			resolved := NormalizeCLI(tt.cli, nil)
			got, err = JobCommand(tt.cli, map[string]bool{resolved: true}, "'hi'", nil)
			if err != nil || got != tt.dangerous {
				t.Fatalf("JobCommand(%q, dangerous) = %q, %v; want %q", tt.cli, got, err, tt.dangerous)
			}
		})
	}
}

func TestJobCommandIgnoresOtherCLIsDangerousFlag(t *testing.T) {
	got, err := JobCommand("claude", map[string]bool{"openai": true}, "'hi'", nil)
	if err != nil || got != "claude -p 'hi'" {
		t.Fatalf("JobCommand(claude, openai dangerous) = %q, %v; want claude -p 'hi'", got, err)
	}
}

func TestJobCommandRejectsCustomIntegration(t *testing.T) {
	integrations := []CLIIntegration{{ID: "headroom", Command: "headroom claude"}}
	if got, err := JobCommand("headroom", nil, "'hi'", integrations); err == nil {
		t.Fatalf("JobCommand(custom) = %q, want error", got)
	}
}
