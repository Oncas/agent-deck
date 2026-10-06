package pty

import (
	"fmt"
	"strings"

	"agentdeck/internal/config"
)

type CLIIntegration = config.CLIIntegration

type StartOptions struct {
	ResumeLast           bool
	StartupGitPullFFOnly bool
	SkipStartupGitPull   bool
	CLIIntegrations      map[string]CLIIntegration
	// AddDirs are directories outside the session folder that the agent may
	// use too, such as a workspace's tracked projects. Only Claude takes them.
	AddDirs []string
}

// StartCommand returns the shell command used to launch an interactive CLI
// session in the project directory. Defaults to Claude when cli is empty or
// unrecognized.
func StartCommand(cli string, dangerous bool) string {
	return StartCommandWithOptions(cli, dangerous, StartOptions{})
}

func StartCommandWithOptions(cli string, dangerous bool, options StartOptions) string {
	if integration, ok := integrationForCLI(cli, options.CLIIntegrations); ok {
		if options.ResumeLast && strings.TrimSpace(integration.ResumeCommand) != "" {
			return strings.TrimSpace(integration.ResumeCommand)
		}
		return strings.TrimSpace(integration.Command)
	}

	switch normalizeBuiltinCLI(cli) {
	case "opencode":
		command := "opencode"
		if options.ResumeLast {
			command += " --continue"
		}
		if dangerous {
			command += " --auto"
		}
		return command
	case "kimi":
		command := "kimi"
		if options.ResumeLast {
			command += " --continue"
		}
		if dangerous {
			command += " --auto"
		}
		return command
	case "cursor":
		if dangerous {
			return "cursor-agent -f"
		}
		return "cursor-agent"
	case "openai":
		if options.ResumeLast {
			if dangerous {
				return "codex resume --last --dangerously-bypass-approvals-and-sandbox"
			}
			return "codex resume --last"
		}
		if dangerous {
			return "codex --dangerously-bypass-approvals-and-sandbox"
		}
		return "codex"
	case "gemini":
		if dangerous {
			return "gemini --yolo"
		}
		return "gemini"
	default:
		command := "claude"
		if dangerous {
			command += " --dangerously-skip-permissions"
		}
		for _, dir := range options.AddDirs {
			command += " --add-dir " + shellQuote(dir)
		}
		return command
	}
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

// JobCommand returns the shell command that runs one prompt to completion
// without a TUI, for scheduled jobs. It resolves cli and its dangerous flag
// the same way interactive sessions do. The prompt must already be
// shell-quoted; it goes last because gemini and kimi take it as the value of
// -p. Custom integrations only describe an interactive launch, so they have no
// job command.
func JobCommand(cli string, dangerousPermissions map[string]bool, quotedPrompt string, integrations []CLIIntegration) (string, error) {
	integrationsByID := cliIntegrationMap(integrations)
	cli = NormalizeCLI(cli, integrationsByID)
	if _, ok := integrationForCLI(cli, integrationsByID); ok {
		return "", fmt.Errorf("custom CLI %q has no non-interactive mode for jobs", cli)
	}
	dangerous := dangerousPermissions[cli]

	var command string
	switch cli {
	case "opencode":
		command = "opencode run"
		if dangerous {
			command += " --auto"
		}
	case "kimi":
		// Prompt mode always runs under kimi's auto permission policy and
		// rejects --auto/--yolo, so the dangerous flag has nothing to add.
		command = "kimi -p"
	case "cursor":
		command = "cursor-agent -p"
		if dangerous {
			command += " -f"
		}
	case "openai":
		command = "codex exec"
		if dangerous {
			command += " --dangerously-bypass-approvals-and-sandbox"
		}
	case "gemini":
		command = "gemini"
		if dangerous {
			command += " --yolo"
		}
		command += " -p"
	default:
		command = "claude -p"
		if dangerous {
			command += " --dangerously-skip-permissions"
		}
	}
	return command + " " + quotedPrompt, nil
}

func NormalizeCLI(cli string, integrations map[string]CLIIntegration) string {
	id := strings.TrimSpace(cli)
	if id == "" {
		return "claude"
	}
	if _, ok := integrationForCLI(id, integrations); ok {
		return id
	}
	return normalizeBuiltinCLI(id)
}

func normalizeCLI(cli string) string {
	return NormalizeCLI(cli, nil)
}

func normalizeBuiltinCLI(cli string) string {
	id := strings.TrimSpace(cli)
	switch id {
	case "cursor", "openai", "gemini", "opencode", "kimi", "claude":
		return id
	default:
		return "claude"
	}
}

func integrationForCLI(cli string, integrations map[string]CLIIntegration) (CLIIntegration, bool) {
	id := strings.TrimSpace(cli)
	if id == "" || IsBuiltinCLI(id) || integrations == nil {
		return CLIIntegration{}, false
	}
	integration, ok := integrations[id]
	if !ok || strings.TrimSpace(integration.Command) == "" {
		return CLIIntegration{}, false
	}
	return integration, true
}

func IsBuiltinCLI(cli string) bool {
	switch strings.TrimSpace(cli) {
	case "claude", "cursor", "openai", "gemini", "opencode", "kimi":
		return true
	default:
		return false
	}
}
