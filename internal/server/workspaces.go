package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"

	"agentdeck/internal/config"
	ptyPkg "agentdeck/internal/pty"
	"github.com/google/uuid"
)

const workspaceSessionPrefix = "workspace:"

var errWorkspaceNotFound = errors.New("workspace not found")

func workspaceSessionKey(id string) string { return workspaceSessionPrefix + id }

func cloneWorkspaces(src []config.Workspace) []config.Workspace {
	dst := slices.Clone(src)
	for i := range dst {
		dst[i].Projects = slices.Clone(src[i].Projects)
	}
	return dst
}

func findWorkspace(cfg *config.Config, id string) *config.Workspace {
	for i := range cfg.Workspaces {
		if cfg.Workspaces[i].ID == id {
			return &cfg.Workspaces[i]
		}
	}
	return nil
}

func writeWorkspaceError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if errors.Is(err, errWorkspaceNotFound) {
		status = http.StatusNotFound
	}
	http.Error(w, err.Error(), status)
}

func (a *apiHandler) handleListWorkspaces(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	workspaces := cloneWorkspaces(a.cfg.Workspaces)
	a.mu.RUnlock()
	if workspaces == nil {
		workspaces = []config.Workspace{}
	}
	writeJSON(w, workspaces)
}

// workspaceDirectory resolves a typed session folder. A leading ~ means the
// home directory, as it would in a shell; the errors name the path checked
// because they are shown to the user as typed.
func workspaceDirectory(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("session folder: %w", err)
		}
		path = filepath.Join(home, path[1:])
	}
	if !filepath.IsAbs(path) {
		return "", errors.New("session folder must be an absolute path or start with ~/")
	}
	path = filepath.Clean(path)
	info, err := os.Stat(path)
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, syscall.ENOTDIR) {
		return "", fmt.Errorf("session folder does not exist: %s", path)
	}
	if err != nil {
		return "", fmt.Errorf("session folder: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("session folder is not a folder: %s", path)
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", fmt.Errorf("session folder: %w", err)
	}
	return resolved, nil
}

// Keep missing tracked checkouts removable after a rescan. Newly added entries
// must resolve to an actual known project/worktree, never a terminal pane key.
func (a *apiHandler) validateWorkspaceProjects(projects, previous []string) error {
	seen := make(map[string]bool, len(projects))
	for _, key := range projects {
		if key == "" || seen[key] || strings.Contains(key, "#") || strings.HasPrefix(key, workspaceSessionPrefix) {
			return fmt.Errorf("invalid or duplicate tracked project: %q", key)
		}
		seen[key] = true
		if slices.Contains(previous, key) {
			continue
		}
		if _, err := a.resolveProjectPath(key); err != nil {
			return err
		}
	}
	return nil
}

func normalizeWorkspaceSelection(ws *config.Workspace) {
	if !slices.Contains(ws.Projects, ws.ActiveProject) {
		ws.ActiveProject = ""
		if len(ws.Projects) > 0 {
			ws.ActiveProject = ws.Projects[0]
		}
	}
	if ws.Projects == nil {
		ws.Projects = []string{}
	}
}

func (a *apiHandler) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	var ws config.Workspace
	if err := json.NewDecoder(r.Body).Decode(&ws); err != nil {
		http.Error(w, "invalid workspace", http.StatusBadRequest)
		return
	}
	ws.Name = strings.TrimSpace(ws.Name)
	if ws.Name == "" {
		http.Error(w, "workspace name is required", http.StatusBadRequest)
		return
	}
	dir, err := workspaceDirectory(ws.WorkingDirectory)
	if err == nil {
		err = a.validateWorkspaceProjects(ws.Projects, nil)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	ws.ID = uuid.NewString()
	ws.WorkingDirectory = dir
	normalizeWorkspaceSelection(&ws)
	if _, err := a.updateConfig(func(next *config.Config) {
		next.Workspaces = append(next.Workspaces, ws)
	}); err != nil {
		writeWorkspaceError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, ws)
}

func (a *apiHandler) handleUpdateWorkspace(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var patch struct {
		Name          *string   `json:"name"`
		Projects      *[]string `json:"projects"`
		ActiveProject *string   `json:"active_project"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields() // In particular, the session folder is fixed.
	if err := decoder.Decode(&patch); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if patch.Name != nil {
		*patch.Name = strings.TrimSpace(*patch.Name)
		if *patch.Name == "" {
			http.Error(w, "workspace name is required", http.StatusBadRequest)
			return
		}
	}
	a.mu.RLock()
	previous := findWorkspace(a.cfg, id)
	var previousProjects []string
	if previous != nil {
		previousProjects = slices.Clone(previous.Projects)
	}
	a.mu.RUnlock()
	if previous == nil {
		writeWorkspaceError(w, errWorkspaceNotFound)
		return
	}
	if patch.Projects != nil {
		if err := a.validateWorkspaceProjects(*patch.Projects, previousProjects); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}
	cfg, err := a.updateConfigChecked(func(next *config.Config) error {
		ws := findWorkspace(next, id)
		if ws == nil {
			return errWorkspaceNotFound
		}
		if patch.Name != nil {
			ws.Name = *patch.Name
		}
		if patch.Projects != nil {
			ws.Projects = slices.Clone(*patch.Projects)
		}
		if patch.ActiveProject != nil {
			ws.ActiveProject = *patch.ActiveProject
		}
		normalizeWorkspaceSelection(ws)
		return nil
	})
	if err != nil {
		writeWorkspaceError(w, err)
		return
	}
	writeJSON(w, findWorkspace(cfg, id))
}

func (a *apiHandler) handleDeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	key := workspaceSessionKey(id)
	if _, err := a.updateConfigChecked(func(next *config.Config) error {
		if findWorkspace(next, id) == nil {
			return errWorkspaceNotFound
		}
		next.Workspaces = slices.DeleteFunc(next.Workspaces, func(ws config.Workspace) bool { return ws.ID == id })
		next.OpenTabs = slices.DeleteFunc(next.OpenTabs, func(tab string) bool { return tab == key })
		delete(next.TabLayouts, key)
		if next.ActiveTab == key {
			next.ActiveTab = ""
		}
		return nil
	}); err != nil {
		writeWorkspaceError(w, err)
		return
	}
	a.manager.Remove(key)
	writeJSON(w, map[string]string{"status": "deleted"})
}

func (a *apiHandler) startWorkspaceSession(id string, cols, rows uint16, cli string, resume bool) (*ptyPkg.Session, error) {
	a.mu.RLock()
	ws := findWorkspace(a.cfg, id)
	var folder string
	var tracked []string
	if ws != nil {
		folder, tracked = ws.WorkingDirectory, slices.Clone(ws.Projects)
	}
	a.mu.RUnlock()
	if ws == nil {
		return nil, errWorkspaceNotFound
	}
	dir, err := workspaceDirectory(folder)
	if err != nil {
		return nil, err
	}
	// Resolved outside a.mu: finding a worktree runs git, and project lookups
	// take the lock themselves.
	addDirs := a.workspaceAddDirs(tracked, dir)

	// Serialize session creation with deletion of its workspace definition.
	a.mu.RLock()
	defer a.mu.RUnlock()
	if findWorkspace(a.cfg, id) == nil {
		return nil, errWorkspaceNotFound
	}
	return a.manager.GetOrCreateWithOptions(workspaceSessionKey(id), dir, cols, rows, cli, ptyPkg.StartOptions{
		ResumeLast: resume, SkipStartupGitPull: true, AddDirs: addDirs,
	})
}

// workspaceAddDirs resolves a workspace's tracked checkouts for the CLI's
// --add-dir, so an agent started in the session folder can use them wherever
// they live. Missing checkouts are skipped, and the session folder is the
// agent's own already.
func (a *apiHandler) workspaceAddDirs(projects []string, sessionDir string) []string {
	dirs := make([]string, 0, len(projects))
	for _, key := range projects {
		path, err := a.resolveProjectPath(key)
		if err != nil {
			continue
		}
		if resolved, err := filepath.EvalSymlinks(path); err == nil {
			path = resolved
		}
		if path == sessionDir || slices.Contains(dirs, path) {
			continue
		}
		dirs = append(dirs, path)
	}
	return dirs
}

func (a *apiHandler) workspaceTerminalKey(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	a.mu.RLock()
	exists := findWorkspace(a.cfg, id) != nil
	a.mu.RUnlock()
	if !exists {
		writeWorkspaceError(w, errWorkspaceNotFound)
		return "", false
	}
	key := workspaceSessionKey(id)
	if requested := r.URL.Query().Get("session"); requested != "" && requested != key {
		http.Error(w, "workspace has exactly one session", http.StatusBadRequest)
		return "", false
	}
	return key, true
}

func (a *apiHandler) handleWorkspaceTerminalStart(w http.ResponseWriter, r *http.Request) {
	key, ok := a.workspaceTerminalKey(w, r)
	if !ok {
		return
	}
	var body struct {
		Session    string `json:"session"`
		CLI        string `json:"cli"`
		ResumeLast bool   `json:"resume_last"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.Session != "" && body.Session != key {
		http.Error(w, "workspace has exactly one session", http.StatusBadRequest)
		return
	}
	if _, err := a.startWorkspaceSession(r.PathValue("id"), 120, 40, body.CLI, body.ResumeLast); err != nil {
		writeWorkspaceError(w, err)
		return
	}
	writeJSON(w, map[string]string{"status": "started", "session": key})
}

func (a *apiHandler) handleWorkspaceTerminalOutput(w http.ResponseWriter, r *http.Request) {
	key, ok := a.workspaceTerminalKey(w, r)
	if !ok {
		return
	}
	info := a.manager.GetSessionInfo(key)
	writeJSON(w, map[string]any{
		"has_session": info.HasSession, "session_alive": info.SessionAlive,
		"session_working": info.SessionWorking, "output": a.manager.GetOutput(key),
	})
}

func (a *apiHandler) handleWorkspaceTerminalStop(w http.ResponseWriter, r *http.Request) {
	key, ok := a.workspaceTerminalKey(w, r)
	if !ok {
		return
	}
	a.manager.Remove(key)
	writeJSON(w, map[string]string{"status": "stopped"})
}
