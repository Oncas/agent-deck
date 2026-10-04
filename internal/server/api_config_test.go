package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"agentdeck/internal/config"
	ptyPkg "agentdeck/internal/pty"
)

func TestHandlePatchConfigPreservesExistingFields(t *testing.T) {
	initial := &config.Config{
		ScanPaths:      []string{"/workspace/main", "/workspace/secondary"},
		ExtraProjects:  []string{"/workspace/extra"},
		PinnedProjects: []string{"proj-a"},
		OpenTabs:       []string{"proj-a"},
		ActiveTab:      "proj-a",
		TabLayouts: map[string]config.TabLayout{
			"proj-a": {FocusedPane: "proj-a", Panes: []config.TabPane{{Session: "proj-a"}}},
		},
		ProjectTags: map[string][]string{
			"proj-a": []string{"old"},
		},
		KeymapProfiles: []config.KeymapProfile{{
			ID:       "custom",
			Name:     "Custom profile",
			Bindings: map[string][]string{"app.openCommandPalette": []string{"Primary+Shift+K"}},
		}},
		ActiveKeymap:         "custom",
		Theme:                "dark",
		CLI:                  "claude",
		ShowGitHubActivity:   true,
		ShowCodexUsage:       true,
		StartupGitPullFFOnly: true,
		CLIIntegrations: []config.CLIIntegration{
			{ID: "headroom-codex", Name: "Headroom Codex", Command: "headroom codex", CheckCommand: "headroom"},
		},
		DangerousPermissions: map[string]bool{
			"claude": true,
			"cursor": true,
		},
	}
	api, configPath := newConfigTestHandler(t, initial)

	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"project_tags": map[string][]string{
			"proj-a": {"new"},
		},
	})

	api.handlePatchConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got config.Config
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if !reflect.DeepEqual(got.ScanPaths, initial.ScanPaths) {
		t.Fatalf("scan_paths = %v, want %v", got.ScanPaths, initial.ScanPaths)
	}
	if len(got.PinnedProjects) != 1 || got.PinnedProjects[0] != "proj-a" {
		t.Fatalf("pinned_projects = %v, want preserved", got.PinnedProjects)
	}
	if len(got.OpenTabs) != 1 || got.OpenTabs[0] != "proj-a" {
		t.Fatalf("open_tabs = %v, want preserved", got.OpenTabs)
	}
	if got.ActiveTab != "proj-a" {
		t.Fatalf("active_tab = %q, want preserved", got.ActiveTab)
	}
	if len(got.ProjectTags["proj-a"]) != 1 || got.ProjectTags["proj-a"][0] != "new" {
		t.Fatalf("project_tags = %#v, want patched tags", got.ProjectTags)
	}
	if got.ActiveKeymap != "custom" || len(got.KeymapProfiles) != 1 || got.KeymapProfiles[0].Name != "Custom profile" {
		t.Fatalf("keymap config = active %q profiles %#v, want preserved", got.ActiveKeymap, got.KeymapProfiles)
	}
	if !got.DangerousPermissions["claude"] || !got.DangerousPermissions["cursor"] {
		t.Fatalf("dangerous_permissions = %#v, want preserved", got.DangerousPermissions)
	}
	if !got.ShowGitHubActivity {
		t.Fatal("show_github_activity = false, want preserved true")
	}
	if !got.ShowCodexUsage {
		t.Fatal("show_codex_usage = false, want preserved true")
	}
	if !got.StartupGitPullFFOnly {
		t.Fatal("startup_git_pull_ff_only = false, want preserved true")
	}
	if len(got.CLIIntegrations) != 1 || got.CLIIntegrations[0].ID != "headroom-codex" || got.CLIIntegrations[0].Command != "headroom codex" {
		t.Fatalf("cli_integrations = %#v, want preserved", got.CLIIntegrations)
	}

	saved := loadConfigFile(t, configPath)
	if !reflect.DeepEqual(saved.ScanPaths, initial.ScanPaths) {
		t.Fatalf("saved scan_paths = %v, want %v", saved.ScanPaths, initial.ScanPaths)
	}
	if len(saved.OpenTabs) != 1 || saved.OpenTabs[0] != "proj-a" {
		t.Fatalf("saved open_tabs = %v, want preserved", saved.OpenTabs)
	}
	if saved.ActiveKeymap != "custom" || len(saved.KeymapProfiles) != 1 {
		t.Fatalf("saved keymap config = active %q profiles %#v, want preserved", saved.ActiveKeymap, saved.KeymapProfiles)
	}
	if !saved.DangerousPermissions["claude"] || !saved.DangerousPermissions["cursor"] {
		t.Fatalf("saved dangerous_permissions = %#v, want preserved", saved.DangerousPermissions)
	}
	if !saved.ShowGitHubActivity {
		t.Fatal("saved show_github_activity = false, want preserved true")
	}
	if !saved.ShowCodexUsage {
		t.Fatal("saved show_codex_usage = false, want preserved true")
	}
	if !saved.StartupGitPullFFOnly {
		t.Fatal("saved startup_git_pull_ff_only = false, want preserved true")
	}
	if len(saved.CLIIntegrations) != 1 || saved.CLIIntegrations[0].ID != "headroom-codex" || saved.CLIIntegrations[0].CheckCommand != "headroom" {
		t.Fatalf("saved cli_integrations = %#v, want preserved", saved.CLIIntegrations)
	}
}

func TestHandlePatchConfigSavesScanPaths(t *testing.T) {
	initial := &config.Config{ScanPaths: []string{"/workspace/main"}}
	api, configPath := newConfigTestHandler(t, initial)

	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"scan_paths": []string{"/workspace/one", "/workspace/two"},
	})
	api.handlePatchConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got config.Config
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	want := []string{"/workspace/one", "/workspace/two"}
	if !reflect.DeepEqual(got.ScanPaths, want) {
		t.Fatalf("response scan_paths = %v, want %v", got.ScanPaths, want)
	}
	if saved := loadConfigFile(t, configPath); !reflect.DeepEqual(saved.ScanPaths, want) {
		t.Fatalf("saved scan_paths = %v, want %v", saved.ScanPaths, want)
	}
}

func TestHandlePatchConfigSavesShowGitHubActivity(t *testing.T) {
	initial := &config.Config{
		ScanPaths:          []string{"/workspace/main"},
		ShowGitHubActivity: true,
	}
	api, configPath := newConfigTestHandler(t, initial)

	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"show_github_activity": false,
	})

	api.handlePatchConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got config.Config
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.ShowGitHubActivity {
		t.Fatal("show_github_activity = true, want false")
	}

	saved := loadConfigFile(t, configPath)
	if saved.ShowGitHubActivity {
		t.Fatal("saved show_github_activity = true, want false")
	}
}

func TestHandlePatchConfigSavesShowCodexUsage(t *testing.T) {
	initial := &config.Config{
		ScanPaths:      []string{"/workspace/main"},
		ShowCodexUsage: true,
	}
	api, configPath := newConfigTestHandler(t, initial)

	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"show_codex_usage": false,
	})

	api.handlePatchConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got config.Config
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.ShowCodexUsage {
		t.Fatal("show_codex_usage = true, want false")
	}

	saved := loadConfigFile(t, configPath)
	if saved.ShowCodexUsage {
		t.Fatal("saved show_codex_usage = true, want false")
	}
}

func TestHandlePatchConfigSavesStartupGitPullFFOnly(t *testing.T) {
	initial := &config.Config{
		ScanPaths: []string{"/workspace/main"},
	}
	api, configPath := newConfigTestHandler(t, initial)

	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"startup_git_pull_ff_only": true,
	})

	api.handlePatchConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got config.Config
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !got.StartupGitPullFFOnly {
		t.Fatal("startup_git_pull_ff_only = false, want true")
	}

	saved := loadConfigFile(t, configPath)
	if !saved.StartupGitPullFFOnly {
		t.Fatal("saved startup_git_pull_ff_only = false, want true")
	}
}

func TestHandlePatchConfigSavesDangerousPermissions(t *testing.T) {
	initial := &config.Config{
		ScanPaths: []string{"/workspace/main"},
		CLI:       "claude",
	}
	api, configPath := newConfigTestHandler(t, initial)

	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"dangerous_permissions": map[string]bool{
			"cursor": true,
			"gemini": true,
		},
	})

	api.handlePatchConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got config.Config
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.DangerousPermissions["claude"] || !got.DangerousPermissions["cursor"] || !got.DangerousPermissions["gemini"] {
		t.Fatalf("dangerous_permissions = %#v, want cursor and gemini only", got.DangerousPermissions)
	}

	saved := loadConfigFile(t, configPath)
	if saved.DangerousPermissions["claude"] || !saved.DangerousPermissions["cursor"] || !saved.DangerousPermissions["gemini"] {
		t.Fatalf("saved dangerous_permissions = %#v, want cursor and gemini only", saved.DangerousPermissions)
	}
}

func TestHandlePatchConfigSavesCLIIntegrations(t *testing.T) {
	initial := &config.Config{
		ScanPaths: []string{"/workspace/main"},
		CLI:       "claude",
	}
	api, configPath := newConfigTestHandler(t, initial)

	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"cli": "headroom-codex",
		"cli_integrations": []map[string]any{
			{
				"id":             "headroom-codex",
				"name":           "Headroom Codex",
				"command":        "headroom codex",
				"resume_command": "headroom codex resume --last",
				"check_command":  "headroom",
			},
		},
	})

	api.handlePatchConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got config.Config
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.CLI != "headroom-codex" {
		t.Fatalf("cli = %q, want headroom-codex", got.CLI)
	}
	if len(got.CLIIntegrations) != 1 || got.CLIIntegrations[0].ResumeCommand != "headroom codex resume --last" {
		t.Fatalf("cli_integrations = %#v, want saved custom integration", got.CLIIntegrations)
	}

	saved := loadConfigFile(t, configPath)
	if len(saved.CLIIntegrations) != 1 || saved.CLIIntegrations[0].CheckCommand != "headroom" {
		t.Fatalf("saved cli_integrations = %#v, want saved custom integration", saved.CLIIntegrations)
	}
}

func TestHandlePatchConfigRejectsReservedCLIIntegrationID(t *testing.T) {
	initial := &config.Config{ScanPaths: []string{"/workspace/main"}}
	api, _ := newConfigTestHandler(t, initial)

	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"cli_integrations": []map[string]string{
			{"id": "openai", "name": "Override", "command": "custom-codex"},
		},
	})

	api.handlePatchConfig(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("PATCH /api/config status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `custom integration id "openai" is reserved`) {
		t.Fatalf("PATCH /api/config body = %q, want reserved id error", rec.Body.String())
	}
}

func TestHandlePatchConfigMigratesLegacyCustomDangerousCommand(t *testing.T) {
	initial := &config.Config{ScanPaths: []string{"/workspace/main"}}
	api, configPath := newConfigTestHandler(t, initial)

	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"cli_integrations": []map[string]any{
			{
				"id":                "custom",
				"name":              "Custom",
				"command":           "custom-cli",
				"dangerous_command": "custom-cli --unsafe",
			},
		},
		"dangerous_permissions": map[string]bool{
			"custom": true,
			"claude": true,
		},
	})

	api.handlePatchConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got config.Config
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.CLIIntegrations[0].Command != "custom-cli --unsafe" {
		t.Fatalf("migrated command = %q, want custom-cli --unsafe", got.CLIIntegrations[0].Command)
	}
	if got.DangerousPermissions["custom"] || !got.DangerousPermissions["claude"] {
		t.Fatalf("dangerous_permissions = %#v, want claude only", got.DangerousPermissions)
	}

	saved := loadConfigFile(t, configPath)
	if saved.CLIIntegrations[0].Command != "custom-cli --unsafe" || saved.DangerousPermissions["custom"] {
		t.Fatalf("saved config did not persist migration: %#v", saved)
	}
}

func TestHandlePatchConfigNormalizesCLIWhenIntegrationRemoved(t *testing.T) {
	initial := &config.Config{
		ScanPaths: []string{"/workspace/main"},
		CLI:       "headroom-codex",
		CLIIntegrations: []config.CLIIntegration{
			{ID: "headroom-codex", Name: "Headroom Codex", Command: "headroom codex"},
		},
	}
	api, configPath := newConfigTestHandler(t, initial)

	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"cli_integrations": []map[string]string{},
	})

	api.handlePatchConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got config.Config
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.CLI != "claude" {
		t.Fatalf("cli = %q, want claude fallback", got.CLI)
	}

	saved := loadConfigFile(t, configPath)
	if saved.CLI != "claude" {
		t.Fatalf("saved cli = %q, want claude fallback", saved.CLI)
	}
}

func TestHandlePatchConfigPreservesTabsAfterTabSave(t *testing.T) {
	initial := &config.Config{
		ScanPaths: []string{"/workspace/main"},
		OpenTabs:  []string{"old"},
		ActiveTab: "old",
		TabLayouts: map[string]config.TabLayout{
			"old": {FocusedPane: "old", Panes: []config.TabPane{{Session: "old"}}},
		},
		Theme: "light",
	}
	api, configPath := newConfigTestHandler(t, initial)

	tabRec := httptest.NewRecorder()
	tabReq := newJSONRequest(t, http.MethodPost, "/api/tabs", map[string]any{
		"open_tabs":  []string{"proj-a", "proj-b"},
		"active_tab": "proj-b",
		"tab_layouts": map[string]any{
			"proj-b": map[string]any{
				"focused_pane": "proj-b#1",
				"panes": []map[string]string{
					{"session": "proj-b#1", "cli": "claude"},
				},
			},
		},
	})
	api.handleSaveTabs(tabRec, tabReq)
	if tabRec.Code != http.StatusOK {
		t.Fatalf("POST /api/tabs status = %d, body = %s", tabRec.Code, tabRec.Body.String())
	}

	patchRec := httptest.NewRecorder()
	patchReq := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"theme": "dark",
	})
	api.handlePatchConfig(patchRec, patchReq)
	if patchRec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", patchRec.Code, patchRec.Body.String())
	}

	saved := loadConfigFile(t, configPath)
	if len(saved.OpenTabs) != 2 || saved.OpenTabs[0] != "proj-a" || saved.OpenTabs[1] != "proj-b" {
		t.Fatalf("saved open_tabs = %v, want updated tabs", saved.OpenTabs)
	}
	if saved.ActiveTab != "proj-b" {
		t.Fatalf("saved active_tab = %q, want %q", saved.ActiveTab, "proj-b")
	}
	if saved.Theme != "dark" {
		t.Fatalf("saved theme = %q, want %q", saved.Theme, "dark")
	}
	if layout, ok := saved.TabLayouts["proj-b"]; !ok || layout.FocusedPane != "proj-b#1" || len(layout.Panes) != 1 {
		t.Fatalf("saved tab_layouts = %#v, want proj-b layout preserved", saved.TabLayouts)
	}
}

func TestHandlePatchConfigClearsOwnedCollections(t *testing.T) {
	initial := &config.Config{
		ExtraProjects: []string{"/workspace/extra"},
		ProjectTags: map[string][]string{
			"proj-a": []string{"backend"},
		},
		KeymapProfiles: []config.KeymapProfile{{
			ID:       "custom",
			Name:     "Custom profile",
			Bindings: map[string][]string{"app.openCommandPalette": []string{"Primary+Shift+K"}},
		}},
		ActiveKeymap: "custom",
	}
	api, configPath := newConfigTestHandler(t, initial)

	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"extra_projects":        []string{},
		"project_tags":          map[string][]string{},
		"keymap_profiles":       []config.KeymapProfile{},
		"active_keymap_profile": "",
	})
	api.handlePatchConfig(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", rec.Code, rec.Body.String())
	}

	saved := loadConfigFile(t, configPath)
	if len(saved.ExtraProjects) != 0 {
		t.Fatalf("extra_projects = %v, want cleared empty slice", saved.ExtraProjects)
	}
	if len(saved.ProjectTags) != 0 {
		t.Fatalf("project_tags = %v, want cleared empty map", saved.ProjectTags)
	}
	if len(saved.KeymapProfiles) != 0 {
		t.Fatalf("keymap_profiles = %v, want cleared empty slice", saved.KeymapProfiles)
	}
	if saved.ActiveKeymap != "" {
		t.Fatalf("active_keymap_profile = %q, want cleared", saved.ActiveKeymap)
	}
}

func newConfigTestHandler(t *testing.T, cfg *config.Config) (*apiHandler, string) {
	t.Helper()
	configPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(configPath, cfg); err != nil {
		t.Fatalf("seed config: %v", err)
	}
	api := &apiHandler{
		configPath:               configPath,
		cfg:                      cfg,
		databaseStore:            newDatabaseStore(configPath),
		databasePasswordStore:    newTestDatabasePasswordStore(),
		databaseSessionPasswords: make(map[string]string),
		databasePools:            make(map[string]*databasePool),
		manager:                  ptyPkg.NewManager(),
		docker:                   newDockerManager(),
	}
	if err := api.initializeDatabaseState(); err != nil {
		t.Fatalf("initialize database state: %v", err)
	}
	return api, configPath
}

type testDatabasePasswordStore struct {
	values    map[string]string
	getErr    error
	setErr    error
	deleteErr error
}

func newTestDatabasePasswordStore() *testDatabasePasswordStore {
	return &testDatabasePasswordStore{values: map[string]string{}}
}

func (s *testDatabasePasswordStore) Get(connectionID string) (string, bool, error) {
	if s.getErr != nil {
		return "", false, s.getErr
	}
	value, ok := s.values[connectionID]
	return value, ok, nil
}

func (s *testDatabasePasswordStore) Set(connectionID, password string) error {
	if s.setErr != nil {
		return s.setErr
	}
	s.values[connectionID] = password
	return nil
}

func (s *testDatabasePasswordStore) Delete(connectionID string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	delete(s.values, connectionID)
	return nil
}

func newJSONRequest(t *testing.T, method, target string, body any) *http.Request {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request body: %v", err)
	}
	req := httptest.NewRequest(method, target, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func loadConfigFile(t *testing.T, path string) *config.Config {
	t.Helper()
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	return cfg
}

func TestHandlePatchConfigSavesUsageBillingAndBudgets(t *testing.T) {
	api, configPath := newConfigTestHandler(t, &config.Config{ScanPaths: []string{"/workspace/main"}})

	rec := httptest.NewRecorder()
	api.handlePatchConfig(rec, newJSONRequest(t, http.MethodPatch, "/api/config", map[string]any{
		"show_claude_usage":     true,
		"claude_billing":        "api",
		"claude_monthly_budget": 150.5,
		"codex_billing":         "something else",
		"codex_monthly_budget":  -20,
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/config status = %d, body = %s", rec.Code, rec.Body.String())
	}

	saved := loadConfigFile(t, configPath)
	if !saved.ShowClaudeUsage {
		t.Fatal("show_claude_usage = false, want true")
	}
	if saved.ClaudeBilling != "api" || saved.ClaudeMonthlyBudget != 150.5 {
		t.Fatalf("claude billing/budget = %q/%v, want api/150.5", saved.ClaudeBilling, saved.ClaudeMonthlyBudget)
	}
	// Unknown modes fall back to the subscription default; budgets can't go negative.
	if saved.CodexBilling != "" || saved.CodexMonthlyBudget != 0 {
		t.Fatalf("codex billing/budget = %q/%v, want \"\"/0", saved.CodexBilling, saved.CodexMonthlyBudget)
	}
}
