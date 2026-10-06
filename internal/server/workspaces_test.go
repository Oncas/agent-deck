package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"agentdeck/internal/config"
	"agentdeck/internal/scanner"
	"nhooyr.io/websocket"
)

func workspaceTestAPI(t *testing.T) (*apiHandler, string) {
	t.Helper()
	t.Setenv("SHELL", "/bin/sh")
	api, path := newConfigTestHandler(t, &config.Config{
		CLI:             "workspace-test",
		CLIIntegrations: []config.CLIIntegration{{ID: "workspace-test", Command: "printf 'workspace-ready\\n'; exec cat"}},
	})
	api.manager.SetCLI(api.cfg.CLI)
	api.manager.SetCLIIntegrations(api.cfg.CLIIntegrations)
	t.Cleanup(api.manager.CloseAll)
	api.projects = []scanner.Project{{Name: "org/a", Path: t.TempDir()}, {Name: "org/b", Path: t.TempDir()}}
	return api, path
}

func createTestWorkspace(t *testing.T, api *apiHandler) config.Workspace {
	t.Helper()
	rec := httptest.NewRecorder()
	api.handleCreateWorkspace(rec, newJSONRequest(t, http.MethodPost, "/api/workspaces", map[string]any{
		"name": "Shared task", "working_directory": t.TempDir(), "projects": []string{"org/a", "org/b"},
	}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create workspace = %d: %s", rec.Code, rec.Body.String())
	}
	var ws config.Workspace
	if err := json.Unmarshal(rec.Body.Bytes(), &ws); err != nil {
		t.Fatal(err)
	}
	return ws
}

func patchTestWorkspace(t *testing.T, api *apiHandler, id string, patch any) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := newJSONRequest(t, http.MethodPatch, "/api/workspaces/"+id, patch)
	req.SetPathValue("id", id)
	api.handleUpdateWorkspace(rec, req)
	return rec
}

func TestWorkspaceTrackingChangesPreserveLiveSession(t *testing.T) {
	api, path := workspaceTestAPI(t)
	ws := createTestWorkspace(t, api)
	if ws.ID == "" || ws.ActiveProject != "org/a" {
		t.Fatalf("created workspace = %+v", ws)
	}
	session, err := api.startWorkspaceSession(ws.ID, 80, 24, "", false)
	if err != nil {
		t.Fatal(err)
	}
	pid := session.Pid()
	for _, patch := range []map[string]any{
		{"active_project": "org/b"},
		{"name": "Renamed", "projects": []string{"org/b"}},
		{"projects": []string{}},
		{"projects": []string{"org/a", "org/b"}},
	} {
		rec := patchTestWorkspace(t, api, ws.ID, patch)
		if rec.Code != http.StatusOK {
			t.Fatalf("patch = %d: %s", rec.Code, rec.Body.String())
		}
		got := api.manager.Get(workspaceSessionKey(ws.ID))
		if got != session || got.Pid() != pid || !got.IsAlive() || got.ProjectPath != ws.WorkingDirectory {
			t.Fatal("tracking change replaced, stopped, or moved the terminal")
		}
	}
	loaded, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	saved := findWorkspace(loaded, ws.ID)
	if saved.Name != "Renamed" || saved.ActiveProject != "org/a" || len(saved.Projects) != 2 {
		t.Fatalf("persisted workspace = %+v", saved)
	}
	deadline := time.Now().Add(2 * time.Second)
	for !strings.Contains(session.GetOutput(), "workspace-ready") && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if output := session.GetOutput(); !strings.Contains(output, "workspace-ready") || strings.Contains(output, "fatal:") {
		t.Fatalf("workspace should launch its CLI without a git pull: %q", output)
	}
	if _, err := os.Stat(filepath.Join(ws.WorkingDirectory, ".git")); !os.IsNotExist(err) {
		t.Fatalf("workspace launch created a Git repository: %v", err)
	}
}

func TestWorkspacesHaveIndependentSingleSessionsAndPersistedTabs(t *testing.T) {
	api, path := workspaceTestAPI(t)
	a, b := createTestWorkspace(t, api), createTestWorkspace(t, api)
	aKey, bKey := workspaceSessionKey(a.ID), workspaceSessionKey(b.ID)
	first, err := api.startWorkspaceSession(a.ID, 80, 24, "", false)
	if err != nil {
		t.Fatal(err)
	}
	second, err := api.startWorkspaceSession(b.ID, 80, 24, "", false)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := api.startWorkspaceSession(a.ID, 80, 24, "", false)
	if err != nil || repeated != first || first == second {
		t.Fatal("workspace session identities were not preserved")
	}
	rec := httptest.NewRecorder()
	api.handleSaveTabs(rec, newJSONRequest(t, http.MethodPost, "/api/tabs", map[string]any{
		"open_tabs": []string{"org/a", aKey, bKey}, "active_tab": bKey,
		"tab_layouts": map[string]config.TabLayout{bKey: {FocusedPane: bKey, Panes: []config.TabPane{{Session: bKey, CLI: "workspace-test"}}}},
	}))
	if rec.Code != http.StatusOK {
		t.Fatal(rec.Body.String())
	}
	loaded, err := config.Load(path)
	if err != nil || len(loaded.Workspaces) != 2 || loaded.ActiveTab != bKey || loaded.TabLayouts[bKey].Panes[0].Session != bKey {
		t.Fatalf("workspace/tab persistence failed: %+v, %v", loaded, err)
	}
	for _, sessionKey := range []string{aKey + "#2", bKey, "org/a"} {
		req := newJSONRequest(t, http.MethodPost, "/api/workspaces/"+a.ID+"/terminal/start", map[string]string{"session": sessionKey})
		req.SetPathValue("id", a.ID)
		rec := httptest.NewRecorder()
		api.handleWorkspaceTerminalStart(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("foreign/split session %q accepted: %d", sessionKey, rec.Code)
		}
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/workspaces/"+a.ID, nil)
	req.SetPathValue("id", a.ID)
	rec = httptest.NewRecorder()
	api.handleDeleteWorkspace(rec, req)
	if rec.Code != http.StatusOK || api.manager.Get(aKey) != nil || !second.IsAlive() {
		t.Fatal("deleting one workspace did not preserve the other session")
	}
	if _, err := os.Stat(a.WorkingDirectory); err != nil {
		t.Fatal("deleting a workspace removed its folder")
	}
}

func TestWorkspaceValidationAndMissingCheckouts(t *testing.T) {
	api, _ := workspaceTestAPI(t)
	ws := createTestWorkspace(t, api)
	for _, patch := range []map[string]any{
		{"name": " "}, {"projects": []string{"missing"}}, {"projects": []string{"org/a", "org/a"}},
		{"projects": []string{"org/a#2"}}, {"working_directory": t.TempDir()},
	} {
		if rec := patchTestWorkspace(t, api, ws.ID, patch); rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid patch accepted: %v => %d", patch, rec.Code)
		}
	}
	api.projects = api.projects[1:] // org/a disappeared from the scan.
	if rec := patchTestWorkspace(t, api, ws.ID, map[string]any{"projects": []string{"org/a"}}); rec.Code != http.StatusOK {
		t.Fatalf("an existing missing checkout cannot be retained: %s", rec.Body.String())
	}
	if rec := patchTestWorkspace(t, api, ws.ID, map[string]any{"projects": []string{}}); rec.Code != http.StatusOK {
		t.Fatal(rec.Body.String())
	}
	if rec := patchTestWorkspace(t, api, "missing", map[string]string{"name": "new"}); rec.Code != http.StatusNotFound {
		t.Fatal("unknown workspace was accepted")
	}
	if _, err := api.startWorkspaceSession(ws.ID+"#2", 80, 24, "", false); err != errWorkspaceNotFound {
		t.Fatalf("split session key was resolved: %v", err)
	}
	if err := os.Remove(ws.WorkingDirectory); err != nil {
		t.Fatal(err)
	}
	if _, err := api.startWorkspaceSession(ws.ID, 80, 24, "", false); err == nil {
		t.Fatal("missing session folder silently fell back to another directory")
	}
	if api.manager.Get(workspaceSessionKey(ws.ID)) != nil {
		t.Fatal("missing directory created a session")
	}
}

func TestWorkspaceCloneAndUnrelatedConfigSaves(t *testing.T) {
	api, _ := workspaceTestAPI(t)
	ws := createTestWorkspace(t, api)
	cloned := cloneConfig(api.cfg)
	cloned.Workspaces[0].Projects[0] = "changed"
	if api.cfg.Workspaces[0].Projects[0] != "org/a" {
		t.Fatal("workspace config clone shared a project slice")
	}
	rec := httptest.NewRecorder()
	api.handlePatchConfig(rec, newJSONRequest(t, http.MethodPatch, "/api/config", map[string]string{"theme": "light"}))
	if rec.Code != http.StatusOK || !reflect.DeepEqual(*findWorkspace(api.cfg, ws.ID), ws) {
		t.Fatal("unrelated settings save changed the workspace")
	}
	previous := cloneConfig(api.cfg)
	api.configPath = filepath.Join(t.TempDir(), "missing", "config.json")
	if rec := patchTestWorkspace(t, api, ws.ID, map[string]string{"name": "Unsaved"}); rec.Code != http.StatusInternalServerError {
		t.Fatal("failed disk write was reported as saved")
	}
	if !reflect.DeepEqual(previous.Workspaces, api.cfg.Workspaces) {
		t.Fatal("failed disk write changed live workspace state")
	}
}

func TestWorkspaceTracksWorktreeBadgesWithoutProjectTab(t *testing.T) {
	api, _ := workspaceTestAPI(t)
	repo := initRepo(t)
	wt, err := gitAddWorktree(repo, "shared-task", true, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(wt.Path) })
	api.projects[0].Path = repo
	ws := createTestWorkspace(t, api)
	key := "org/a@" + wt.Name
	if rec := patchTestWorkspace(t, api, ws.ID, map[string]any{"projects": []string{key}}); rec.Code != http.StatusOK {
		t.Fatal(rec.Body.String())
	}
	if err := os.WriteFile(filepath.Join(wt.Path, "changed.txt"), []byte("worktree change\n"), 0600); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	api.handleBadges(rec, httptest.NewRequest(http.MethodGet, "/api/badges", nil))
	var badges map[string]struct {
		DirtyCount int `json:"dirty_count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &badges); err != nil {
		t.Fatal(err)
	}
	if badges[key].DirtyCount != 1 || badges["org/a"].DirtyCount != 0 {
		t.Fatalf("worktree counts were attributed to the main checkout: %s", rec.Body.String())
	}
}

func TestWorkspaceWebsocketReconnectAttachesToSameSession(t *testing.T) {
	api, _ := workspaceTestAPI(t)
	ws := createTestWorkspace(t, api)
	mux := http.NewServeMux()
	mux.Handle("GET /ws/{name...}", newWSHandler(api.manager, api))
	server := httptest.NewServer(mux)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var pid int
	for range 2 {
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/ws/"+workspaceSessionKey(ws.ID), nil)
		if err != nil {
			t.Fatal(err)
		}
		typ, _, err := conn.Read(ctx)
		if err != nil || typ != websocket.MessageText {
			t.Fatalf("workspace websocket did not synchronize: %v", err)
		}
		session := api.manager.Get(workspaceSessionKey(ws.ID))
		if session == nil || (pid != 0 && session.Pid() != pid) {
			t.Fatal("websocket reconnect created a different workspace session")
		}
		pid = session.Pid()
		conn.CloseNow()
	}
}

func TestWorkspaceDirectoryExpandsHomeAndExplainsErrors(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	project := filepath.Join(home, "projects")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(home, "notes.txt")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	resolvedHome, _ := filepath.EvalSymlinks(home)
	resolvedProject, _ := filepath.EvalSymlinks(project)

	for input, want := range map[string]string{
		"~": resolvedHome, "~/": resolvedHome, " ~/projects ": resolvedProject, project: resolvedProject,
	} {
		if got, err := workspaceDirectory(input); err != nil || got != want {
			t.Errorf("workspaceDirectory(%q) = %q, %v; want %q", input, got, err, want)
		}
	}
	for input, want := range map[string]string{
		"projects":                 "session folder must be an absolute path or start with ~/",
		"~someone/projects":        "session folder must be an absolute path or start with ~/",
		"~/missing":                "session folder does not exist: " + filepath.Join(home, "missing"),
		file:                       "session folder is not a folder: " + file,
		filepath.Join(file, "sub"): "session folder does not exist: " + filepath.Join(file, "sub"),
	} {
		if _, err := workspaceDirectory(input); err == nil || err.Error() != want {
			t.Errorf("workspaceDirectory(%q) error = %v; want %q", input, err, want)
		}
	}
}

func TestCreateWorkspaceStoresExpandedFolderAndRejectsMissingOne(t *testing.T) {
	api, _ := workspaceTestAPI(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := os.Mkdir(filepath.Join(home, "work"), 0o755); err != nil {
		t.Fatal(err)
	}
	create := func(folder string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		api.handleCreateWorkspace(rec, newJSONRequest(t, http.MethodPost, "/api/workspaces", map[string]any{
			"name": "Home relative", "working_directory": folder, "projects": []string{"org/a"},
		}))
		return rec
	}

	rec := create("~/work")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create with ~/work = %d: %s", rec.Code, rec.Body.String())
	}
	var ws config.Workspace
	if err := json.Unmarshal(rec.Body.Bytes(), &ws); err != nil {
		t.Fatal(err)
	}
	if want, _ := filepath.EvalSymlinks(filepath.Join(home, "work")); ws.WorkingDirectory != want {
		t.Fatalf("stored folder = %q, want %q", ws.WorkingDirectory, want)
	}

	rec = create("~/gone")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "session folder does not exist: "+filepath.Join(home, "gone")) {
		t.Fatalf("create with missing folder = %d: %s", rec.Code, rec.Body.String())
	}
}
