package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"time"

	"agentdeck/internal/config"
	ptyPkg "agentdeck/internal/pty"
	"agentdeck/internal/scanner"
)

type apiHandler struct {
	configPath                  string
	cfg                         *config.Config
	projects                    []scanner.Project
	mu                          sync.RWMutex
	databaseStore               *databaseStore
	databasePasswordStore       databasePasswordStore
	databaseConnections         []config.DatabaseConnection
	databaseSessionPasswords    map[string]string
	preserveLegacyDatabaseState bool
	databaseMu                  sync.Mutex
	databasePools               map[string]*databasePool
	manager                     *ptyPkg.Manager
	docker                      *dockerManager
	dockerComposeFiles          map[string]string // project name → repository-owned Compose file
	githubCLI                   *githubCLI
	githubUser                  githubUserCacheState
	usage                       map[string]*usageCoordinator // by usageProvider name
	fetcher                     *fetcher
	battery                     *batteryProbe
	jobStartMu                  sync.Mutex
	startingJobs                map[string]struct{}
}

func newAPIHandler(configPath string, cfg *config.Config, projects []scanner.Project, manager *ptyPkg.Manager) *apiHandler {
	a := &apiHandler{
		configPath:               configPath,
		cfg:                      cfg,
		projects:                 projects,
		manager:                  manager,
		databaseStore:            newDatabaseStore(configPath),
		databasePasswordStore:    newKeyringDatabasePasswordStore(configPath),
		databaseSessionPasswords: make(map[string]string),
		databasePools:            make(map[string]*databasePool),
		docker:                   newDockerManager(),
		githubCLI:                newGithubCLI(),
		fetcher:                  newFetcher(1 * time.Minute),
		battery:                  newBatteryProbe(),
		startingJobs:             make(map[string]struct{}),
		usage:                    newUsageCoordinators(),
	}
	if err := a.initializeDatabaseState(); err != nil {
		log.Printf("database state initialization failed: %v", err)
	}
	a.resolveDocker()
	go a.runBackgroundFetcher(2 * time.Minute)
	go a.runJobScheduler(30 * time.Second)
	go a.runDatabaseIdleCloser(1 * time.Minute)
	return a
}

// runBackgroundFetcher keeps each project's remote-tracking refs warm so
// /api/overview and /api/projects/{name}/status report accurate ahead/behind
// counts without the caller waiting on a network roundtrip.
func (a *apiHandler) runBackgroundFetcher(interval time.Duration) {
	a.fetchAllProjects()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		a.fetchAllProjects()
	}
}

func (a *apiHandler) fetchAllProjects() {
	a.mu.RLock()
	paths := make([]string, 0, len(a.projects))
	for _, p := range a.projects {
		paths = append(paths, p.Path)
	}
	a.mu.RUnlock()

	var wg sync.WaitGroup
	for _, p := range paths {
		wg.Add(1)
		go func(path string) {
			defer wg.Done()
			a.fetcher.FetchIfStale(path)
		}(p)
	}
	wg.Wait()
}

type projectJSON struct {
	Name                 string `json:"name"`
	Path                 string `json:"path"`
	Pinned               bool   `json:"pinned"`
	HasSession           bool   `json:"has_session"`
	SessionAlive         bool   `json:"session_alive"`
	SessionWorking       bool   `json:"session_working"`
	SessionState         string `json:"session_state,omitempty"`
	SessionWaitingFor    string `json:"session_waiting_for,omitempty"`
	SessionRemoteControl bool   `json:"session_remote_control,omitempty"`
	DockerCompose        string `json:"docker_compose_file,omitempty"`
}

type configPatch struct {
	ScanPaths            *[]string                    `json:"scan_paths"`
	ExtraProjects        *[]string                    `json:"extra_projects"`
	PinnedProjects       *[]string                    `json:"pinned_projects"`
	ProjectTags          *map[string][]string         `json:"project_tags"`
	KeymapProfiles       *[]config.KeymapProfile      `json:"keymap_profiles"`
	ActiveKeymap         *string                      `json:"active_keymap_profile"`
	OpenTabs             *[]string                    `json:"open_tabs"`
	ActiveTab            *string                      `json:"active_tab"`
	TabLayouts           *map[string]config.TabLayout `json:"tab_layouts"`
	Theme                *string                      `json:"theme"`
	TerminalFontSize     *int                         `json:"terminal_font_size"`
	CLI                  *string                      `json:"cli"`
	CLIIntegrations      *[]config.CLIIntegration     `json:"cli_integrations"`
	ShowGitHubActivity   *bool                        `json:"show_github_activity"`
	ShowClaudeUsage      *bool                        `json:"show_claude_usage"`
	ShowCodexUsage       *bool                        `json:"show_codex_usage"`
	ClaudeBilling        *string                      `json:"claude_billing"`
	CodexBilling         *string                      `json:"codex_billing"`
	ClaudeMonthlyBudget  *float64                     `json:"claude_monthly_budget"`
	CodexMonthlyBudget   *float64                     `json:"codex_monthly_budget"`
	StartupGitPullFFOnly *bool                        `json:"startup_git_pull_ff_only"`
	DangerousPermissions *map[string]bool             `json:"dangerous_permissions"`
	DisableSleepPrevent  *bool                        `json:"disable_sleep_prevention"`
}

func (a *apiHandler) handleListProjects(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	pinned := make(map[string]bool)
	for _, name := range a.cfg.PinnedProjects {
		pinned[name] = true
	}

	list := make([]projectJSON, len(a.projects))
	for i, p := range a.projects {
		info := a.manager.GetProjectSessionInfo(p.Name)
		list[i] = projectJSON{
			Name:                 p.Name,
			Path:                 p.Path,
			Pinned:               pinned[p.Name],
			HasSession:           info.HasSession,
			SessionAlive:         info.SessionAlive,
			SessionWorking:       info.SessionWorking,
			SessionState:         info.SessionState,
			SessionWaitingFor:    info.WaitingFor,
			SessionRemoteControl: info.RemoteControl,
			DockerCompose:        a.dockerComposeFiles[p.Name],
		}
	}
	writeJSON(w, list)
}

func (a *apiHandler) handleTogglePin(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	found := false
	if _, err := a.updateConfig(func(next *config.Config) {
		for i, p := range next.PinnedProjects {
			if p == name {
				next.PinnedProjects = append(next.PinnedProjects[:i], next.PinnedProjects[i+1:]...)
				found = true
				break
			}
		}
		if !found {
			next.PinnedProjects = append(next.PinnedProjects, name)
		}
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]bool{"pinned": !found})
}

func (a *apiHandler) handleProjectStatus(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	if r.URL.Query().Get("fresh") == "1" {
		go a.fetcher.FetchIfStale(dir)
	}
	if r.URL.Query().Get("base") == "trunk" {
		writeJSON(w, getGitStatusAgainstTrunk(dir))
		return
	}
	status := getGitStatus(dir)
	writeJSON(w, status)
}

func (a *apiHandler) handleProjectPull(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	output, err := gitPull(dir)
	resp := map[string]string{"output": output}
	if err != nil {
		resp["error"] = err.Error()
	}
	writeJSON(w, resp)
}

func (a *apiHandler) handlePullAll(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	projs := make([]scanner.Project, len(a.projects))
	copy(projs, a.projects)
	a.mu.RUnlock()

	type pullResult struct {
		Output string `json:"output"`
		Error  string `json:"error,omitempty"`
	}

	results := make(map[string]pullResult, len(projs))
	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, p := range projs {
		wg.Add(1)
		go func(proj scanner.Project) {
			defer wg.Done()
			output, err := gitPull(proj.Path)
			r := pullResult{Output: output}
			if err != nil {
				r.Error = err.Error()
			}
			mu.Lock()
			results[proj.Name] = r
			mu.Unlock()
		}(p)
	}
	wg.Wait()

	writeJSON(w, results)
}

func (a *apiHandler) handleFileDiff(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	file := r.URL.Query().Get("file")
	if file == "" {
		http.Error(w, "file parameter required", http.StatusBadRequest)
		return
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	diff := gitDiffFile(dir, file)
	writeJSON(w, map[string]string{"diff": diff})
}

func (a *apiHandler) handleFileBlame(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	file := r.URL.Query().Get("path")
	if file == "" {
		file = r.URL.Query().Get("file")
	}
	if file == "" {
		http.Error(w, "path parameter required", http.StatusBadRequest)
		return
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	lines, err := gitBlameFile(dir, file, r.URL.Query().Get("ref"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]any{"lines": lines})
}

func (a *apiHandler) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	writeJSON(w, configWithoutDatabaseState(a.cfg))
}

func (a *apiHandler) handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	var cfg config.Config
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if _, err := a.updateConfig(func(next *config.Config) {
		*next = *configWithoutDatabaseState(&cfg)
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]string{"status": "ok"})
}

func (a *apiHandler) handlePatchConfig(w http.ResponseWriter, r *http.Request) {
	var patch configPatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if patch.CLIIntegrations != nil {
		for _, integration := range *patch.CLIIntegrations {
			if ptyPkg.IsBuiltinCLI(integration.ID) {
				http.Error(w, fmt.Sprintf("custom integration id %q is reserved", strings.TrimSpace(integration.ID)), http.StatusBadRequest)
				return
			}
		}
	}

	cfg, err := a.updateConfig(func(next *config.Config) {
		patch.apply(next)
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, cfg)
}

func (a *apiHandler) handleSaveTabs(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OpenTabs   []string                    `json:"open_tabs"`
		ActiveTab  string                      `json:"active_tab"`
		TabLayouts map[string]config.TabLayout `json:"tab_layouts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if _, err := a.updateConfig(func(next *config.Config) {
		next.OpenTabs = append([]string(nil), req.OpenTabs...)
		next.ActiveTab = req.ActiveTab
		next.TabLayouts = cloneTabLayouts(req.TabLayouts)
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]string{"status": "ok"})
}

func (p configPatch) apply(cfg *config.Config) {
	if p.ScanPaths != nil {
		cfg.ScanPaths = append([]string(nil), (*p.ScanPaths)...)
	}
	if p.ExtraProjects != nil {
		cfg.ExtraProjects = append([]string(nil), (*p.ExtraProjects)...)
	}
	if p.PinnedProjects != nil {
		cfg.PinnedProjects = append([]string(nil), (*p.PinnedProjects)...)
	}
	if p.ProjectTags != nil {
		cfg.ProjectTags = cloneStringSliceMap(*p.ProjectTags)
	}
	if p.KeymapProfiles != nil {
		cfg.KeymapProfiles = cloneKeymapProfiles(*p.KeymapProfiles)
	}
	if p.ActiveKeymap != nil {
		cfg.ActiveKeymap = *p.ActiveKeymap
	}
	if p.OpenTabs != nil {
		cfg.OpenTabs = append([]string(nil), (*p.OpenTabs)...)
	}
	if p.ActiveTab != nil {
		cfg.ActiveTab = *p.ActiveTab
	}
	if p.TabLayouts != nil {
		cfg.TabLayouts = cloneTabLayouts(*p.TabLayouts)
	}
	if p.Theme != nil {
		cfg.Theme = *p.Theme
	}
	if p.TerminalFontSize != nil {
		cfg.TerminalFontSize = clampTerminalFontSize(*p.TerminalFontSize)
	}
	if p.CLI != nil {
		cfg.CLI = *p.CLI
	}
	if p.CLIIntegrations != nil {
		cfg.CLIIntegrations = cloneCLIIntegrations(*p.CLIIntegrations)
	}
	if p.ShowGitHubActivity != nil {
		cfg.ShowGitHubActivity = *p.ShowGitHubActivity
	}
	if p.ShowClaudeUsage != nil {
		cfg.ShowClaudeUsage = *p.ShowClaudeUsage
	}
	if p.ShowCodexUsage != nil {
		cfg.ShowCodexUsage = *p.ShowCodexUsage
	}
	if p.ClaudeBilling != nil {
		cfg.ClaudeBilling = normalizeUsageBilling(*p.ClaudeBilling)
	}
	if p.CodexBilling != nil {
		cfg.CodexBilling = normalizeUsageBilling(*p.CodexBilling)
	}
	if p.ClaudeMonthlyBudget != nil {
		cfg.ClaudeMonthlyBudget = normalizeUsageBudget(*p.ClaudeMonthlyBudget)
	}
	if p.CodexMonthlyBudget != nil {
		cfg.CodexMonthlyBudget = normalizeUsageBudget(*p.CodexMonthlyBudget)
	}
	if p.StartupGitPullFFOnly != nil {
		cfg.StartupGitPullFFOnly = *p.StartupGitPullFFOnly
	}
	if p.DangerousPermissions != nil {
		cfg.DangerousPermissions = cloneBoolMap(*p.DangerousPermissions)
	}
	if p.DisableSleepPrevent != nil {
		cfg.DisableSleepPrevention = *p.DisableSleepPrevent
	}
	config.MigrateLegacyCLIIntegrations(cfg)
}

func (a *apiHandler) updateConfig(mutate func(*config.Config)) (*config.Config, error) {
	return a.updateConfigChecked(func(next *config.Config) error {
		mutate(next)
		return nil
	})
}

func (a *apiHandler) updateConfigChecked(mutate func(*config.Config) error) (*config.Config, error) {
	a.mu.Lock()
	prev := cloneConfig(a.cfg)
	next := cloneConfig(a.cfg)
	if err := mutate(next); err != nil {
		a.mu.Unlock()
		return nil, err
	}
	next.CLI = normalizeConfigCLI(next.CLI, next.CLIIntegrations)
	needsRescan := !reflect.DeepEqual(prev.ScanPaths, next.ScanPaths) || !reflect.DeepEqual(prev.ExtraProjects, next.ExtraProjects)
	cliChanged := prev.CLI != next.CLI
	cliIntegrationsChanged := !reflect.DeepEqual(prev.CLIIntegrations, next.CLIIntegrations)
	startupGitPullFFOnlyChanged := prev.StartupGitPullFFOnly != next.StartupGitPullFFOnly
	dangerousPermissionsChanged := !reflect.DeepEqual(prev.DangerousPermissions, next.DangerousPermissions)

	diskConfig := configWithoutDatabaseState(next)
	if a.preserveLegacyDatabaseState {
		diskConfig.DatabaseConnections = cloneDatabaseConnections(a.cfg.DatabaseConnections)
		diskConfig.DatabaseOrphanedQueries = cloneDatabaseSavedQueries(a.cfg.DatabaseOrphanedQueries)
	}
	if err := config.Save(a.configPath, diskConfig); err != nil {
		a.mu.Unlock()
		return nil, err
	}
	a.cfg = diskConfig
	a.mu.Unlock()

	if cliChanged && a.manager != nil {
		a.manager.SetCLI(next.CLI)
	}
	if cliIntegrationsChanged && a.manager != nil {
		a.manager.SetCLIIntegrations(next.CLIIntegrations)
	}
	if startupGitPullFFOnlyChanged && a.manager != nil {
		a.manager.SetStartupGitPullFFOnly(next.StartupGitPullFFOnly)
	}
	if dangerousPermissionsChanged && a.manager != nil {
		a.manager.SetDangerousPermissions(next.DangerousPermissions)
	}
	if needsRescan {
		a.rescan()
	}
	return cloneConfig(diskConfig), nil
}

func normalizeConfigCLI(cli string, integrations []config.CLIIntegration) string {
	if strings.TrimSpace(cli) == "" {
		return cli
	}
	byID := make(map[string]ptyPkg.CLIIntegration, len(integrations))
	for _, integration := range integrations {
		id := strings.TrimSpace(integration.ID)
		if id == "" || strings.TrimSpace(integration.Command) == "" {
			continue
		}
		byID[id] = integration
	}
	return ptyPkg.NormalizeCLI(cli, byID)
}

func cloneRawConfig(cfg *config.Config) *config.Config {
	if cfg == nil {
		return &config.Config{}
	}
	next := cloneConfig(cfg)
	next.DatabaseConnections = cloneDatabaseConnections(cfg.DatabaseConnections)
	next.DatabaseOrphanedQueries = cloneDatabaseSavedQueries(cfg.DatabaseOrphanedQueries)
	return next
}

func cloneConfig(cfg *config.Config) *config.Config {
	if cfg == nil {
		return &config.Config{}
	}
	next := *cfg
	next.ScanPaths = append([]string(nil), cfg.ScanPaths...)
	next.ExtraProjects = append([]string(nil), cfg.ExtraProjects...)
	next.PinnedProjects = append([]string(nil), cfg.PinnedProjects...)
	next.OpenTabs = append([]string(nil), cfg.OpenTabs...)
	next.ProjectTags = cloneStringSliceMap(cfg.ProjectTags)
	next.KeymapProfiles = cloneKeymapProfiles(cfg.KeymapProfiles)
	next.TabLayouts = cloneTabLayouts(cfg.TabLayouts)
	next.CLIIntegrations = cloneCLIIntegrations(cfg.CLIIntegrations)
	next.DangerousPermissions = cloneBoolMap(cfg.DangerousPermissions)
	next.Jobs = cloneJobs(cfg.Jobs)
	next.DatabaseConnections = nil
	next.DatabaseOrphanedQueries = nil
	return &next
}

func configWithoutDatabaseState(cfg *config.Config) *config.Config {
	next := cloneConfig(cfg)
	next.DatabaseConnections = nil
	next.DatabaseOrphanedQueries = nil
	return next
}

func cloneStringMap(src map[string]string) map[string]string {
	if src == nil {
		return nil
	}
	dst := make(map[string]string, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func cloneBoolMap(src map[string]bool) map[string]bool {
	if src == nil {
		return nil
	}
	dst := make(map[string]bool, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}

func cloneCLIIntegrations(src []config.CLIIntegration) []config.CLIIntegration {
	if src == nil {
		return nil
	}
	return append([]config.CLIIntegration(nil), src...)
}

func cloneStringSliceMap(src map[string][]string) map[string][]string {
	if src == nil {
		return nil
	}
	dst := make(map[string][]string, len(src))
	for key, values := range src {
		dst[key] = append([]string(nil), values...)
	}
	return dst
}

func cloneJobs(src []config.Job) []config.Job {
	if src == nil {
		return nil
	}
	return append([]config.Job(nil), src...)
}

func cloneDatabaseConnections(src []config.DatabaseConnection) []config.DatabaseConnection {
	if src == nil {
		return nil
	}
	dst := make([]config.DatabaseConnection, len(src))
	for i, conn := range src {
		dst[i] = conn
		dst[i].Params = cloneStringMap(conn.Params)
		dst[i].SavedQueries = cloneDatabaseSavedQueries(conn.SavedQueries)
	}
	return dst
}

func cloneDatabaseSavedQueries(src []config.DatabaseSavedQuery) []config.DatabaseSavedQuery {
	if src == nil {
		return nil
	}
	return append([]config.DatabaseSavedQuery(nil), src...)
}

func cloneKeymapProfiles(src []config.KeymapProfile) []config.KeymapProfile {
	if src == nil {
		return nil
	}
	dst := make([]config.KeymapProfile, len(src))
	for i, profile := range src {
		dst[i] = profile
		dst[i].Bindings = cloneStringSliceMap(profile.Bindings)
	}
	return dst
}

func cloneTabLayouts(src map[string]config.TabLayout) map[string]config.TabLayout {
	if src == nil {
		return nil
	}
	dst := make(map[string]config.TabLayout, len(src))
	for key, layout := range src {
		dst[key] = config.TabLayout{
			FocusedPane: layout.FocusedPane,
			Panes:       append([]config.TabPane(nil), layout.Panes...),
		}
	}
	return dst
}

// normalizeUsageBilling keeps the billing mode to the two the UI knows; empty
// is the subscription default.
func normalizeUsageBilling(mode string) string {
	if strings.TrimSpace(mode) == "api" {
		return "api"
	}
	return ""
}

func normalizeUsageBudget(budget float64) float64 {
	if math.IsNaN(budget) || math.IsInf(budget, 0) || budget < 0 {
		return 0
	}
	return budget
}

// clampTerminalFontSize keeps stored sizes in a range xterm can actually lay
// out. Zero is preserved so the frontend default applies.
func clampTerminalFontSize(size int) int {
	const minSize, maxSize = 8, 32
	switch {
	case size == 0:
		return 0
	case size < minSize:
		return minSize
	case size > maxSize:
		return maxSize
	default:
		return size
	}
}

func (a *apiHandler) handleRescan(w http.ResponseWriter, r *http.Request) {
	a.rescan()
	a.mu.RLock()
	defer a.mu.RUnlock()

	pinned := make(map[string]bool)
	for _, name := range a.cfg.PinnedProjects {
		pinned[name] = true
	}

	list := make([]projectJSON, len(a.projects))
	for i, p := range a.projects {
		info := a.manager.GetProjectSessionInfo(p.Name)
		list[i] = projectJSON{
			Name:                 p.Name,
			Path:                 p.Path,
			Pinned:               pinned[p.Name],
			HasSession:           info.HasSession,
			SessionAlive:         info.SessionAlive,
			SessionWorking:       info.SessionWorking,
			SessionState:         info.SessionState,
			SessionWaitingFor:    info.WaitingFor,
			SessionRemoteControl: info.RemoteControl,
			DockerCompose:        a.dockerComposeFiles[p.Name],
		}
	}
	writeJSON(w, list)
}

func (a *apiHandler) rescan() {
	a.mu.RLock()
	cfg := a.cfg
	a.mu.RUnlock()

	projects, _ := scanner.Scan(cfg.ScanPaths, cfg.ExtraProjects)

	a.mu.Lock()
	a.projects = projects
	a.mu.Unlock()

	a.resolveDocker()
}

func (a *apiHandler) resolveDocker() {
	a.mu.RLock()
	projects := make([]projectDockerInfo, 0, len(a.projects))
	for _, p := range a.projects {
		projects = append(projects, projectDockerInfo{Name: p.Name, Path: p.Path})
	}
	a.mu.RUnlock()

	composeFiles := resolveDockerProjects(projects)

	a.mu.Lock()
	a.dockerComposeFiles = composeFiles
	a.mu.Unlock()
}

func (a *apiHandler) handleDockerStatus(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	a.mu.RLock()
	composeFile := a.dockerComposeFiles[name]
	a.mu.RUnlock()

	if composeFile == "" {
		http.Error(w, "no compose file for project", http.StatusNotFound)
		return
	}

	running, output := a.docker.GetStatus(proj.Path)
	writeJSON(w, dockerStatus{
		Running:     running,
		Output:      output,
		ComposeFile: composeFile,
	})
}

func (a *apiHandler) handleDockerStart(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	a.mu.RLock()
	composeFile := a.dockerComposeFiles[name]
	a.mu.RUnlock()

	if composeFile == "" {
		http.Error(w, "no compose file for project", http.StatusNotFound)
		return
	}

	if err := a.docker.Start(proj.Path); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]string{"status": "started"})
}

func (a *apiHandler) handleDockerStop(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	a.mu.RLock()
	composeFile := a.dockerComposeFiles[name]
	a.mu.RUnlock()

	if composeFile == "" {
		http.Error(w, "no compose file for project", http.StatusNotFound)
		return
	}

	if err := a.docker.Stop(proj.Path); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]string{"status": "stopped"})
}

// projectName extracts the project name from the request.
// Project routes use X-Project-Name header (set by the router middleware).
func projectName(r *http.Request) string {
	if name := r.Header.Get("X-Project-Name"); name != "" {
		return name
	}
	return r.PathValue("name")
}

func (a *apiHandler) findProject(name string) *scanner.Project {
	a.mu.RLock()
	defer a.mu.RUnlock()
	for i := range a.projects {
		if a.projects[i].Name == name {
			return &a.projects[i]
		}
	}
	return nil
}

// projectDir returns the working directory for the request.
// If X-Worktree-Name is set, it resolves the worktree path; if that worktree
// cannot be found, it writes a 404 and returns ok=false so callers must abort.
// This prevents destructive operations from silently running against the main
// project when a stale worktree name is supplied.
func (a *apiHandler) projectDir(w http.ResponseWriter, r *http.Request, proj *scanner.Project) (string, bool) {
	wtName := r.Header.Get("X-Worktree-Name")
	if wtName == "" {
		return proj.Path, true
	}
	wt := findWorktreeByName(proj.Path, wtName)
	if wt == nil {
		http.Error(w, "worktree not found: "+wtName, http.StatusNotFound)
		return "", false
	}
	return wt.Path, true
}

// sessionKey returns the session key for the request.
// If a worktree is specified, returns "project@worktree", otherwise just the project name.
func sessionKey(r *http.Request) string {
	if key := strings.TrimSpace(r.URL.Query().Get("session")); key != "" {
		return key
	}
	name := projectName(r)
	if wt := r.Header.Get("X-Worktree-Name"); wt != "" {
		return name + "@" + wt
	}
	return name
}

// resolveProjectPath resolves a key (which may contain @) to a filesystem path.
// For "projectName@worktreeName", it finds the worktree path.
// For plain "projectName", it returns the project path.
func (a *apiHandler) resolveProjectPath(key string) (string, error) {
	baseKey := key
	if idx := strings.Index(baseKey, "#"); idx >= 0 {
		baseKey = baseKey[:idx]
	}
	if idx := strings.Index(baseKey, "@"); idx >= 0 {
		projName := baseKey[:idx]
		wtName := baseKey[idx+1:]
		proj := a.findProject(projName)
		if proj == nil {
			return "", fmt.Errorf("project not found: %s", projName)
		}
		wt := findWorktreeByName(proj.Path, wtName)
		if wt == nil {
			return "", fmt.Errorf("worktree not found: %s", wtName)
		}
		return wt.Path, nil
	}
	proj := a.findProject(baseKey)
	if proj == nil {
		return "", fmt.Errorf("project not found: %s", baseKey)
	}
	return proj.Path, nil
}

func newRestartHandler(manager *ptyPkg.Manager, api *apiHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := projectName(r)
		proj := api.findProject(name)
		if proj == nil {
			http.Error(w, "project not found", http.StatusNotFound)
			return
		}
		manager.Remove(sessionKey(r))
		writeJSON(w, map[string]string{"status": "ok"})
	}
}

func (a *apiHandler) handleOverview(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	projs := make([]scanner.Project, len(a.projects))
	copy(projs, a.projects)
	pinned := make(map[string]bool)
	for _, name := range a.cfg.PinnedProjects {
		pinned[name] = true
	}
	dockerComposeFiles := make(map[string]string)
	for k, v := range a.dockerComposeFiles {
		dockerComposeFiles[k] = v
	}
	a.mu.RUnlock()

	type overviewProject struct {
		Name           string `json:"name"`
		Pinned         bool   `json:"pinned"`
		Branch         string `json:"branch"`
		Ahead          int    `json:"ahead"`
		Behind         int    `json:"behind"`
		DirtyCount     int    `json:"dirty_count"`
		IsGitRepo      bool   `json:"is_git_repo"`
		HasSession     bool   `json:"has_session"`
		SessionAlive   bool   `json:"session_alive"`
		SessionWorking bool   `json:"session_working"`
		SessionState   string `json:"session_state,omitempty"`
		WaitingFor     string `json:"session_waiting_for,omitempty"`
		RemoteControl  bool   `json:"session_remote_control,omitempty"`
		DockerCompose  string `json:"docker_compose_file,omitempty"`
		DockerRunning  bool   `json:"docker_running,omitempty"`
	}

	result := make([]overviewProject, len(projs))
	var wg sync.WaitGroup

	for i, p := range projs {
		wg.Add(1)
		go func(idx int, proj scanner.Project) {
			defer wg.Done()
			info := a.manager.GetProjectSessionInfo(proj.Name)
			dirty, isGitRepo := projectChangeCount(proj.Path)
			status := GitStatus{IsGitRepo: isGitRepo}
			if isGitRepo {
				status = getGitStatusSummary(proj.Path)
			}

			op := overviewProject{
				Name:           proj.Name,
				Pinned:         pinned[proj.Name],
				Branch:         status.Branch,
				Ahead:          status.Ahead,
				Behind:         status.Behind,
				DirtyCount:     dirty,
				IsGitRepo:      isGitRepo,
				HasSession:     info.HasSession,
				SessionAlive:   info.SessionAlive,
				SessionWorking: info.SessionWorking,
				SessionState:   info.SessionState,
				WaitingFor:     info.WaitingFor,
				RemoteControl:  info.RemoteControl,
			}

			if composeFile := dockerComposeFiles[proj.Name]; composeFile != "" {
				op.DockerCompose = composeFile
				running, _ := a.docker.GetStatus(proj.Path)
				op.DockerRunning = running
			}

			result[idx] = op
		}(i, p)
	}
	wg.Wait()

	writeJSON(w, result)
}

func (a *apiHandler) handleBadges(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	projs := make([]scanner.Project, len(a.projects))
	copy(projs, a.projects)
	a.mu.RUnlock()

	type badge struct {
		DirtyCount int  `json:"dirty_count"`
		IsGitRepo  bool `json:"is_git_repo"`
	}

	result := make(map[string]badge, len(projs))
	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, p := range projs {
		wg.Add(1)
		go func(proj scanner.Project) {
			defer wg.Done()
			count, isGitRepo := projectChangeCount(proj.Path)
			mu.Lock()
			result[proj.Name] = badge{DirtyCount: count, IsGitRepo: isGitRepo}
			mu.Unlock()
		}(p)
	}
	wg.Wait()

	writeJSON(w, result)
}

func (a *apiHandler) handleGitBranches(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	// The dropdown loads in two phases. The first request returns the cached
	// local + remote-tracking refs instantly. The second request carries
	// ?fetch=1 to refresh remote-tracking refs from the remote — but that
	// refresh is routed through the fetcher, so a project fetched within the
	// last minute (by the background loop or a recent dropdown open) is served
	// from cache instead of hitting the remote again. A fetch failure (offline,
	// no remote, missing credentials) is non-fatal: fall back to the cached
	// refs and let the UI note that the fetch didn't complete.
	fetchError := false
	if r.URL.Query().Get("fetch") == "1" {
		// A throttled refresh replays the last fetch's error, so check err
		// regardless of whether a fetch ran this time.
		if _, err := a.fetcher.FetchIfStale(dir); err != nil {
			fetchError = true
		}
	}
	branches, current := gitListBranchesWithRemotes(dir)
	writeJSON(w, map[string]any{
		"branches":   branches,
		"current":    current,
		"remotes":    gitRemotes(dir),
		"fetchError": fetchError,
	})
}

func (a *apiHandler) handleMergedBranches(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	branches := gitMergedBranches(dir)
	if branches == nil {
		branches = []mergedBranch{}
	}
	writeJSON(w, map[string]any{"main": gitMainBranch(dir), "branches": branches})
}

func (a *apiHandler) handleDeleteBranches(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	var body struct {
		Branches []string `json:"branches"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if len(body.Branches) == 0 {
		http.Error(w, "branches required", http.StatusBadRequest)
		return
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	results := gitDeleteBranches(dir, body.Branches)
	writeJSON(w, map[string]any{"results": results})
}

func (a *apiHandler) handleGitCheckoutBranch(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	var body struct {
		Branch string `json:"branch"`
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.Branch == "" {
		http.Error(w, "branch required", http.StatusBadRequest)
		return
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	res, err := gitCheckout(dir, body.Branch, body.Action)
	resp := map[string]any{"output": res.Output}
	if res.Conflict {
		resp["conflict"] = true
		resp["branch"] = res.Branch
		resp["remote"] = res.Remote
	}
	if err != nil {
		resp["error"] = err.Error()
	}
	writeJSON(w, resp)
}

func (a *apiHandler) handleGitCommit(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	var body struct {
		Files   []string `json:"files"`
		Message string   `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.Message == "" || len(body.Files) == 0 {
		http.Error(w, "message and files required", http.StatusBadRequest)
		return
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	output, err := gitCommit(dir, body.Files, body.Message)
	resp := map[string]string{"output": output}
	if err != nil {
		resp["error"] = err.Error()
	}
	writeJSON(w, resp)
}

func (a *apiHandler) handleGitCheckoutMain(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	output, err := gitCheckoutMain(dir)
	resp := map[string]string{"output": output}
	if err != nil {
		resp["error"] = err.Error()
	}
	writeJSON(w, resp)
}

func (a *apiHandler) handleGitRevertFile(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	var body struct {
		File   string `json:"file"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.File == "" {
		http.Error(w, "file required", http.StatusBadRequest)
		return
	}

	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	output, err := gitRevertFile(dir, body.File, body.Status)
	resp := map[string]string{"output": output}
	if err != nil {
		resp["error"] = err.Error()
	}
	writeJSON(w, resp)
}

func (a *apiHandler) handleGitRevertDirectory(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	var body struct {
		Directory string `json:"directory"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.Directory == "" {
		http.Error(w, "directory required", http.StatusBadRequest)
		return
	}

	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	output, err := gitRevertDirectory(dir, body.Directory)
	resp := map[string]string{"output": output}
	if err != nil {
		resp["error"] = err.Error()
	}
	writeJSON(w, resp)
}

func (a *apiHandler) handleGitRevert(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	output, err := gitRevertAll(dir)
	resp := map[string]string{"output": output}
	if err != nil {
		resp["error"] = err.Error()
	}
	writeJSON(w, resp)
}

func (a *apiHandler) handleListWorktrees(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	wts, err := gitListWorktrees(proj.Path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if wts == nil {
		wts = []Worktree{}
	}
	writeJSON(w, wts)
}

func (a *apiHandler) handleCreateWorktree(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	var body struct {
		Branch     string `json:"branch"`
		IsNew      bool   `json:"isNew"`
		BaseBranch string `json:"baseBranch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.Branch == "" {
		http.Error(w, "branch required", http.StatusBadRequest)
		return
	}
	isNew := body.IsNew || body.BaseBranch != ""
	wt, err := gitAddWorktree(proj.Path, body.Branch, isNew, body.BaseBranch)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, wt)
}

func (a *apiHandler) handleDeleteWorktree(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	// Extract worktree name from URL path
	// The path will be like /worktrees/fix-login
	wtName := strings.TrimPrefix(r.URL.Path, "/worktrees/")
	if wtName == "" {
		http.Error(w, "worktree name required", http.StatusBadRequest)
		return
	}

	wt := findWorktreeByName(proj.Path, wtName)
	if wt == nil {
		http.Error(w, "worktree not found", http.StatusNotFound)
		return
	}

	deleteBranch := r.URL.Query().Get("deleteBranch") == "true"
	if err := gitRemoveWorktree(proj.Path, wt.Path, deleteBranch, wt.Branch); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Clean up any PTY session for this worktree
	sessionKey := name + "@" + wtName
	a.manager.Remove(sessionKey)

	w.WriteHeader(http.StatusNoContent)
}

// baseCommitParam reads the optional "base" query parameter naming the commit
// the original side of a diff is read from. Reports false after writing a 400.
func baseCommitParam(w http.ResponseWriter, r *http.Request) (string, bool) {
	base := r.URL.Query().Get("base")
	if base != "" && !isGitCommitHash(base) {
		http.Error(w, "base must be a commit hash", http.StatusBadRequest)
		return "", false
	}
	return base, true
}

func (a *apiHandler) handleReadFile(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "path parameter required", http.StatusBadRequest)
		return
	}

	base, ok := baseCommitParam(w, r)
	if !ok {
		return
	}

	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}

	origBytes, origExists := readBaseBytes(dir, base, path)
	modBytes, modExists := readWorkingBytes(dir, path)

	fileType := classifyFile(origBytes, modBytes, path)

	resp := map[string]any{
		"type":           fileType,
		"originalExists": origExists,
		"modifiedExists": modExists,
		"originalSize":   len(origBytes),
		"modifiedSize":   len(modBytes),
		"original":       "",
		"modified":       "",
	}

	if fileType == "text" {
		resp["original"] = string(origBytes)
		resp["modified"] = string(modBytes)
	}

	if fileType == "image" {
		resp["mime"] = mimeFromExt(path)
	}

	writeJSON(w, resp)
}

func (a *apiHandler) handleReadFileBlob(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "path parameter required", http.StatusBadRequest)
		return
	}
	ref := r.URL.Query().Get("ref")
	if ref != "head" && ref != "working" {
		http.Error(w, "ref must be 'head' or 'working'", http.StatusBadRequest)
		return
	}
	base, ok := baseCommitParam(w, r)
	if !ok {
		return
	}

	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}

	var data []byte
	var exists bool
	if ref == "head" {
		data, exists = readBaseBytes(dir, base, path)
	} else {
		data, exists = readWorkingBytes(dir, path)
	}
	if !exists {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", mimeFromExt(path))
	// SVG files can embed <script> that runs when loaded as a top-level
	// document. Sandbox the response so direct navigation cannot execute JS
	// in the app's origin. nosniff prevents content-type confusion.
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(data)
}

func (a *apiHandler) handleWriteFile(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.Path == "" {
		http.Error(w, "path required", http.StatusBadRequest)
		return
	}

	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	if err := writeWorkingFile(dir, body.Path, body.Content); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (a *apiHandler) handleCreateFile(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.Path == "" {
		http.Error(w, "path required", http.StatusBadRequest)
		return
	}

	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	if err := createWorkingFile(dir, body.Path, body.Content); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (a *apiHandler) handleRenameFile(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	var body struct {
		OldPath string `json:"old_path"`
		NewPath string `json:"new_path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.OldPath == "" || body.NewPath == "" {
		http.Error(w, "old_path and new_path required", http.StatusBadRequest)
		return
	}

	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	if err := renameWorkingFile(dir, body.OldPath, body.NewPath); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (a *apiHandler) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.Path == "" {
		http.Error(w, "path required", http.StatusBadRequest)
		return
	}

	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	if err := deleteWorkingFile(dir, body.Path); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (a *apiHandler) handleTerminalStart(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	var body struct {
		Session    string `json:"session"`
		CLI        string `json:"cli"`
		ResumeLast bool   `json:"resume_last"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	key := sessionKey(r)
	if body.Session != "" {
		key = body.Session
	}
	_, err := a.manager.GetOrCreateWithOptions(key, dir, 120, 40, body.CLI, ptyPkg.StartOptions{ResumeLast: body.ResumeLast})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]string{"status": "started", "session": key})
}

func (a *apiHandler) handleTerminalOutput(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	key := sessionKey(r)
	info := a.manager.GetSessionInfo(key)
	output := a.manager.GetOutput(key)

	writeJSON(w, map[string]any{
		"has_session":     info.HasSession,
		"session_alive":   info.SessionAlive,
		"session_working": info.SessionWorking,
		"output":          output,
	})
}

func (a *apiHandler) handleTerminalStop(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}

	a.manager.Remove(sessionKey(r))
	writeJSON(w, map[string]string{"status": "stopped"})
}

func (a *apiHandler) handleFileTree(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	var files []string
	if r.URL.Query().Get("ignored") == "true" {
		var err error
		files, err = gitListIgnoredFiles(dir)
		if err != nil {
			http.Error(w, "failed to list ignored files: "+err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		files = gitListFiles(dir)
	}
	writeJSON(w, map[string]any{"files": files})
}

func (a *apiHandler) handleSearchCode(w http.ResponseWriter, r *http.Request) {
	name := projectName(r)
	proj := a.findProject(name)
	if proj == nil {
		http.Error(w, "project not found", http.StatusNotFound)
		return
	}
	query := r.URL.Query().Get("q")
	if query == "" {
		writeJSON(w, map[string]any{"results": []searchResult{}})
		return
	}
	opts := searchOptions{
		CaseSensitive: r.URL.Query().Get("caseSensitive") == "true",
		WholeWord:     r.URL.Query().Get("wholeWord") == "true",
		UseRegex:      r.URL.Query().Get("regex") == "true",
		Include:       r.URL.Query().Get("include"),
		Exclude:       r.URL.Query().Get("exclude"),
	}
	dir, ok := a.projectDir(w, r, proj)
	if !ok {
		return
	}
	results := gitGrepSearch(dir, query, opts)
	writeJSON(w, map[string]any{"results": results})
}

func (a *apiHandler) Docker() *dockerManager {
	return a.docker
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
