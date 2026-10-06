package config

import (
	"encoding/json"
	"os"
	"time"
)

type Config struct {
	ScanPaths          []string             `json:"scan_paths,omitempty"`
	ExtraProjects      []string             `json:"extra_projects,omitempty"`
	PinnedProjects     []string             `json:"pinned_projects,omitempty"`
	ProjectTags        map[string][]string  `json:"project_tags,omitempty"` // project name → tags
	KeymapProfiles     []KeymapProfile      `json:"keymap_profiles,omitempty"`
	ActiveKeymap       string               `json:"active_keymap_profile,omitempty"`
	OpenTabs           []string             `json:"open_tabs,omitempty"`
	ActiveTab          string               `json:"active_tab,omitempty"`
	TabLayouts         map[string]TabLayout `json:"tab_layouts,omitempty"`
	Workspaces         []Workspace          `json:"workspaces,omitempty"`
	Theme              string               `json:"theme,omitempty"`
	TerminalFontSize   int                  `json:"terminal_font_size,omitempty"` // 0 = use frontend default
	CLI                string               `json:"cli,omitempty"`                // "claude" (default), "cursor", "openai", "gemini", "opencode", "kimi", or custom integration id
	CLIIntegrations    []CLIIntegration     `json:"cli_integrations,omitempty"`
	ShowGitHubActivity bool                 `json:"show_github_activity,omitempty"`
	ShowClaudeUsage    bool                 `json:"show_claude_usage,omitempty"`
	ShowCodexUsage     bool                 `json:"show_codex_usage,omitempty"`
	// "api" when a CLI is billed per token; empty means a subscription plan.
	ClaudeBilling           string               `json:"claude_billing,omitempty"`
	CodexBilling            string               `json:"codex_billing,omitempty"`
	ClaudeMonthlyBudget     float64              `json:"claude_monthly_budget,omitempty"`
	CodexMonthlyBudget      float64              `json:"codex_monthly_budget,omitempty"`
	StartupGitPullFFOnly    bool                 `json:"startup_git_pull_ff_only,omitempty"`
	DisableSleepPrevention  bool                 `json:"disable_sleep_prevention,omitempty"`
	DangerousPermissions    map[string]bool      `json:"dangerous_permissions,omitempty"`
	Jobs                    []Job                `json:"jobs,omitempty"`
	DatabaseConnections     []DatabaseConnection `json:"database_connections,omitempty"`
	DatabaseOrphanedQueries []DatabaseSavedQuery `json:"database_orphaned_queries,omitempty"`
}

// UnmarshalJSON accepts the legacy main_directory field while keeping all newly
// written configuration on the scan_paths array.
func (c *Config) UnmarshalJSON(data []byte) error {
	type configAlias Config
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	value := struct {
		*configAlias
		MainDirectory string `json:"main_directory"`
	}{
		configAlias: (*configAlias)(c),
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if _, hasScanPaths := fields["scan_paths"]; !hasScanPaths && value.MainDirectory != "" {
		c.ScanPaths = []string{value.MainDirectory}
	}
	return nil
}

type TabLayout struct {
	FocusedPane string    `json:"focused_pane,omitempty"`
	Panes       []TabPane `json:"panes,omitempty"`
}

// Workspace tracks repositories independently of its single terminal session.
// Changing Projects or ActiveProject never changes the terminal's directory.
type Workspace struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	WorkingDirectory string   `json:"working_directory"`
	Projects         []string `json:"projects"`
	ActiveProject    string   `json:"active_project"`
}

type TabPane struct {
	Session string `json:"session"`
	CLI     string `json:"cli,omitempty"`
}

type CLIIntegration struct {
	ID                     string `json:"id"`
	Name                   string `json:"name"`
	Command                string `json:"command"`
	ResumeCommand          string `json:"resume_command,omitempty"`
	CheckCommand           string `json:"check_command,omitempty"`
	legacyDangerousCommand string
}

func (c *CLIIntegration) UnmarshalJSON(data []byte) error {
	var value struct {
		ID               string `json:"id"`
		Name             string `json:"name"`
		Command          string `json:"command"`
		ResumeCommand    string `json:"resume_command"`
		CheckCommand     string `json:"check_command"`
		DangerousCommand string `json:"dangerous_command"`
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*c = CLIIntegration{
		ID:            value.ID,
		Name:          value.Name,
		Command:       value.Command,
		ResumeCommand: value.ResumeCommand,
		CheckCommand:  value.CheckCommand,
	}
	c.legacyDangerousCommand = value.DangerousCommand
	return nil
}

type DatabaseConnection struct {
	ID           string               `json:"id"`
	Name         string               `json:"name"`
	Driver       string               `json:"driver"` // "sqlite", "postgres", "mysql"
	SQLitePath   string               `json:"sqlite_path,omitempty"`
	Host         string               `json:"host,omitempty"`
	Port         int                  `json:"port,omitempty"`
	Database     string               `json:"database,omitempty"`
	User         string               `json:"user,omitempty"`
	Password     string               `json:"password,omitempty"`
	HasPassword  bool                 `json:"has_password,omitempty"`
	Project      string               `json:"project,omitempty"`
	SSLMode      string               `json:"sslmode,omitempty"`
	Params       map[string]string    `json:"params,omitempty"`
	SavedQueries []DatabaseSavedQuery `json:"saved_queries,omitempty"`
}

type DatabaseSavedQuery struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	SQL            string `json:"sql"`
	ConnectionID   string `json:"connection_id,omitempty"`
	ConnectionName string `json:"connection_name,omitempty"`
	CreatedAt      string `json:"created_at,omitempty"`
	UpdatedAt      string `json:"updated_at,omitempty"`
}

type Job struct {
	ID          string     `json:"id"`
	Name        string     `json:"name,omitempty"`
	Project     string     `json:"project"`
	Schedule    string     `json:"schedule"`
	Prompt      string     `json:"prompt"`
	Enabled     bool       `json:"enabled"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	LastRunAt   *time.Time `json:"last_run_at,omitempty"`
	NextRunAt   *time.Time `json:"next_run_at,omitempty"`
	LastSession string     `json:"last_session,omitempty"`
	LastStatus  string     `json:"last_status,omitempty"`
	LastError   string     `json:"last_error,omitempty"`
	RunCount    int        `json:"run_count,omitempty"`
}

type KeymapProfile struct {
	ID       string              `json:"id"`
	Name     string              `json:"name"`
	Bindings map[string][]string `json:"bindings,omitempty"` // command id → shortcuts
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	MigrateLegacyCLIIntegrations(&cfg)
	return &cfg, nil
}

func MigrateLegacyCLIIntegrations(cfg *Config) {
	for i := range cfg.CLIIntegrations {
		integration := &cfg.CLIIntegrations[i]
		if integration.legacyDangerousCommand == "" {
			continue
		}
		if cfg.DangerousPermissions[integration.ID] {
			integration.Command = integration.legacyDangerousCommand
		}
		delete(cfg.DangerousPermissions, integration.ID)
		integration.legacyDangerousCommand = ""
	}
	if len(cfg.DangerousPermissions) == 0 {
		cfg.DangerousPermissions = nil
	}
}

func Save(path string, cfg *Config) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return err
	}
	return os.Chmod(path, 0600)
}
