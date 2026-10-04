package server

import (
	"io/fs"
	"net/http"
	"strings"

	"agentdeck/internal/config"
	ptyPkg "agentdeck/internal/pty"
	"agentdeck/internal/scanner"
)

const contentSecurityPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

type Server struct {
	Mux     *http.ServeMux
	Handler http.Handler
	Manager *ptyPkg.Manager
	API     *apiHandler
}

func New(configPath string, cfg *config.Config, projects []scanner.Project, staticFS fs.FS, monacoFS fs.FS, sqlFormatterFS fs.FS, manager *ptyPkg.Manager, listenHost string, devMode bool) *Server {
	api := newAPIHandler(configPath, cfg, projects, manager)
	ws := newWSHandler(manager, api)

	mux := http.NewServeMux()

	// WebSocket — use {name...} to capture slashes in project names
	mux.Handle("GET /ws/{name...}", ws)

	// REST API — routes without project name
	mux.HandleFunc("GET /api/projects", api.handleListProjects)
	mux.HandleFunc("GET /api/config", api.handleGetConfig)
	mux.HandleFunc("POST /api/config", api.handleSaveConfig)
	mux.HandleFunc("PATCH /api/config", api.handlePatchConfig)
	mux.HandleFunc("POST /api/rescan", api.handleRescan)
	mux.HandleFunc("POST /api/tabs", api.handleSaveTabs)
	mux.HandleFunc("GET /api/badges", api.handleBadges)
	mux.HandleFunc("GET /api/sessions/status", api.handleSessionStatuses)
	mux.HandleFunc("GET /api/power", api.handlePower)
	mux.HandleFunc("GET /api/build", api.handleBuildInfo)
	mux.HandleFunc("GET /api/dev/reload-stamp", newDevReloadHandler(staticFS, devMode))
	mux.HandleFunc("GET /api/themes", newThemesHandler(staticFS))
	mux.HandleFunc("GET /api/overview", api.handleOverview)
	mux.HandleFunc("POST /api/pull-all", api.handlePullAll)
	mux.HandleFunc("GET /api/capabilities", api.handleCapabilities)
	for _, provider := range usageProviders {
		mux.HandleFunc("GET /api/"+provider.name+"/usage", handleUsage(provider.home, api.usage[provider.name]))
	}
	mux.HandleFunc("GET /api/github/activity/today", api.handleGitHubTodayActivity)
	mux.HandleFunc("GET /api/jobs", api.handleListJobs)
	mux.HandleFunc("POST /api/jobs", api.handleCreateJob)
	mux.HandleFunc("POST /api/jobs/schedule/preview", api.handlePreviewJobSchedule)
	mux.HandleFunc("PATCH /api/jobs/{id}", api.handleUpdateJob)
	mux.HandleFunc("DELETE /api/jobs/{id}", api.handleDeleteJob)
	mux.HandleFunc("POST /api/jobs/{id}/duplicate", api.handleDuplicateJob)
	mux.HandleFunc("POST /api/jobs/{id}/run", api.handleRunJob)
	mux.HandleFunc("POST /api/jobs/{id}/cancel", api.handleCancelJob)
	mux.HandleFunc("GET /api/jobs/{id}/runs", api.handleListJobRuns)
	mux.HandleFunc("GET /api/jobs/{id}/output", api.handleJobOutput)
	mux.HandleFunc("GET /api/databases", api.handleListDatabases)
	mux.HandleFunc("POST /api/databases", api.handleCreateDatabase)
	mux.HandleFunc("PATCH /api/databases/{id}", api.handleUpdateDatabase)
	mux.HandleFunc("DELETE /api/databases/{id}", api.handleDeleteDatabase)
	mux.HandleFunc("POST /api/databases/test", api.handleTestDatabase)
	mux.HandleFunc("POST /api/databases/discover", api.handleDiscoverDatabases)
	mux.HandleFunc("POST /api/databases/{id}/password", api.handleSaveDatabasePassword)
	mux.HandleFunc("POST /api/databases/{id}/saved-queries", api.handleCreateDatabaseSavedQuery)
	mux.HandleFunc("PATCH /api/databases/{id}/saved-queries/{query_id}", api.handleUpdateDatabaseSavedQuery)
	mux.HandleFunc("DELETE /api/databases/{id}/saved-queries/{query_id}", api.handleDeleteDatabaseSavedQuery)
	mux.HandleFunc("DELETE /api/databases/orphaned-queries/{query_id}", api.handleDeleteDatabaseOrphanedQuery)
	mux.HandleFunc("GET /api/databases/{id}/schema", api.handleDatabaseSchema)
	mux.HandleFunc("GET /api/databases/{id}/schemas/{schema}", api.handleDatabaseSchemaGroup)
	mux.HandleFunc("GET /api/databases/{id}/schemas/{schema}/tables/{table}", api.handleDatabaseTableSchema)
	mux.HandleFunc("POST /api/databases/{id}/disconnect", api.handleDatabaseDisconnect)
	mux.HandleFunc("GET /api/databases/{id}/tables/{schema}/{table}/count", api.handleDatabaseTableCount)
	mux.HandleFunc("GET /api/databases/{id}/tables/{schema}/{table}", api.handleDatabaseTableRows)
	mux.HandleFunc("POST /api/databases/{id}/query", api.handleDatabaseQuery)

	// Project routes — use {name...} to capture slashes
	// We strip known suffixes in a wrapper to extract project name
	projectRouter := http.NewServeMux()
	projectRouter.HandleFunc("GET /status", api.handleProjectStatus)
	projectRouter.HandleFunc("POST /pull", api.handleProjectPull)
	projectRouter.HandleFunc("POST /pin", api.handleTogglePin)
	projectRouter.HandleFunc("GET /diff", api.handleFileDiff)
	projectRouter.HandleFunc("POST /restart", newRestartHandler(manager, api))
	projectRouter.HandleFunc("POST /revert", api.handleGitRevert)
	projectRouter.HandleFunc("POST /checkout-main", api.handleGitCheckoutMain)
	projectRouter.HandleFunc("GET /branches", api.handleGitBranches)
	projectRouter.HandleFunc("GET /merged-branches", api.handleMergedBranches)
	projectRouter.HandleFunc("POST /delete-branches", api.handleDeleteBranches)
	projectRouter.HandleFunc("POST /checkout", api.handleGitCheckoutBranch)
	projectRouter.HandleFunc("POST /commit", api.handleGitCommit)
	projectRouter.HandleFunc("POST /revert-file", api.handleGitRevertFile)
	projectRouter.HandleFunc("POST /revert-directory", api.handleGitRevertDirectory)
	projectRouter.HandleFunc("GET /file/blame", api.handleFileBlame)
	projectRouter.HandleFunc("GET /file/blob", api.handleReadFileBlob)
	projectRouter.HandleFunc("GET /file", api.handleReadFile)
	projectRouter.HandleFunc("POST /file", api.handleWriteFile)
	projectRouter.HandleFunc("POST /file/create", api.handleCreateFile)
	projectRouter.HandleFunc("POST /file/rename", api.handleRenameFile)
	projectRouter.HandleFunc("POST /file/delete", api.handleDeleteFile)
	projectRouter.HandleFunc("GET /tree", api.handleFileTree)
	projectRouter.HandleFunc("GET /search", api.handleSearchCode)
	projectRouter.HandleFunc("POST /terminal/start", api.handleTerminalStart)
	projectRouter.HandleFunc("GET /terminal/output", api.handleTerminalOutput)
	projectRouter.HandleFunc("POST /terminal/stop", api.handleTerminalStop)
	projectRouter.HandleFunc("GET /docker", api.handleDockerStatus)
	projectRouter.HandleFunc("POST /docker/start", api.handleDockerStart)
	projectRouter.HandleFunc("POST /docker/stop", api.handleDockerStop)
	projectRouter.HandleFunc("GET /worktrees", api.handleListWorktrees)
	projectRouter.HandleFunc("POST /worktrees", api.handleCreateWorktree)
	projectRouter.HandleFunc("DELETE /worktrees/{wtname...}", api.handleDeleteWorktree)

	// Mount project routes under /api/projects/ with name extraction
	mux.HandleFunc("/api/projects/", func(w http.ResponseWriter, r *http.Request) {
		// Path: /api/projects/org/repo/status
		// Strip prefix to get: org/repo/status
		rest := strings.TrimPrefix(r.URL.Path, "/api/projects/")

		// Known action suffixes (longest first to avoid partial matches)
		suffixes := []string{
			"/worktrees",
			"/terminal/start", "/terminal/output", "/terminal/stop",
			"/docker/start", "/docker/stop",
			"/file/create", "/file/rename", "/file/delete", "/file/blame", "/file/blob",
			"/checkout-main", "/revert-directory", "/revert-file",
			"/status", "/pull", "/pin", "/diff",
			"/restart", "/revert", "/merged-branches", "/delete-branches", "/branches", "/checkout",
			"/commit", "/file", "/tree", "/search",
			"/docker",
		}

		projectName := rest
		actionPath := "/"

		// DELETE /worktrees/{wtname} is the only action whose path continues past
		// "/worktrees/". Restrict the split to DELETE so a project whose own name
		// contains a "worktrees" segment (e.g. "org/worktrees") still routes its
		// GET/POST actions through the regular suffix loop below.
		matched := false
		if r.Method == http.MethodDelete {
			if idx := strings.Index(rest, "/worktrees/"); idx >= 0 {
				projectName = rest[:idx]
				actionPath = rest[idx:] // e.g. /worktrees/fix-login
				matched = true
			}
		}
		if !matched {
			for _, s := range suffixes {
				if strings.HasSuffix(rest, s) {
					projectName = rest[:len(rest)-len(s)]
					actionPath = s
					break
				}
			}
		}

		// Handle @-keyed worktree names: "project@worktree" → project name + worktree header
		if atIdx := strings.Index(projectName, "@"); atIdx >= 0 {
			r.Header.Set("X-Worktree-Name", projectName[atIdx+1:])
			projectName = projectName[:atIdx]
		}

		// Set project name for handlers to use
		r.Header.Set("X-Project-Name", projectName)
		r.URL.Path = actionPath
		projectRouter.ServeHTTP(w, r)
	})

	// Static files
	if monacoFS != nil {
		mux.Handle("GET /vendor/monaco-editor/min/vs/", http.StripPrefix("/vendor/monaco-editor/min/vs/", http.FileServer(http.FS(monacoFS))))
	}
	if sqlFormatterFS != nil {
		mux.Handle("GET /vendor/sql-formatter/", http.StripPrefix("/vendor/sql-formatter/", http.FileServer(http.FS(sqlFormatterFS))))
	}
	mux.Handle("/", newStaticHandler(staticFS, devMode))

	return &Server{
		Mux:     mux,
		Handler: localRequestsOnly(securityHeaders(mux), listenHost),
		Manager: manager,
		API:     api,
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := w.Header()
		if header.Get("Content-Security-Policy") == "" {
			header.Set("Content-Security-Policy", contentSecurityPolicy)
		}
		header.Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}
