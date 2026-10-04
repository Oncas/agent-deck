package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"agentdeck/internal/config"
	ptyPkg "agentdeck/internal/pty"
)

const (
	jobStatusRunning   = "running"
	jobStatusCompleted = "completed"
	jobStatusFailed    = "failed"
	jobStatusCanceled  = "canceled"

	jobSessionPrefix = "job-"
	jobOutputBufSize = 10 * 1024 * 1024
)

type jobRequest struct {
	Name     *string `json:"name"`
	Project  *string `json:"project"`
	Schedule *string `json:"schedule"`
	Prompt   *string `json:"prompt"`
	Enabled  *bool   `json:"enabled"`
}

type jobResponse struct {
	config.Job
}

type jobSchedulePreviewRequest struct {
	Schedule *string `json:"schedule"`
	Count    *int    `json:"count,omitempty"`
}

type jobSchedulePreviewResponse struct {
	Valid    bool        `json:"valid"`
	Schedule string      `json:"schedule,omitempty"`
	NextRuns []time.Time `json:"next_runs,omitempty"`
	Error    string      `json:"error,omitempty"`
}

type jobRunLog struct {
	ID          string     `json:"id"`
	JobID       string     `json:"job_id"`
	JobName     string     `json:"job_name,omitempty"`
	Project     string     `json:"project"`
	StartedAt   time.Time  `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	Status      string     `json:"status"`
	Error       string     `json:"error,omitempty"`
	Session     string     `json:"session,omitempty"`
	Output      string     `json:"output"`
}

type jobRunSummary struct {
	ID          string     `json:"id"`
	StartedAt   time.Time  `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	Status      string     `json:"status,omitempty"`
	Error       string     `json:"error,omitempty"`
	OutputBytes int        `json:"output_bytes"`
	HasSession  bool       `json:"has_session,omitempty"`
}

var errJobAlreadyRunning = errors.New("job is already running")

func (a *apiHandler) runJobScheduler(interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		a.runDueJobs(time.Now())
		<-ticker.C
	}
}

func (a *apiHandler) runDueJobs(now time.Time) {
	a.syncJobStatuses()
	a.ensureJobNextRunAt(now)

	a.mu.RLock()
	jobs := cloneJobs(a.cfg.Jobs)
	a.mu.RUnlock()

	for _, job := range jobs {
		if !job.Enabled || !jobDue(job, now) || a.jobIsRunning(job) {
			continue
		}
		go func(job config.Job) {
			_ = a.startJob(job, time.Now())
		}(job)
	}
}

func (a *apiHandler) handleListJobs(w http.ResponseWriter, r *http.Request) {
	a.syncJobStatuses()
	a.ensureJobNextRunAt(time.Now())

	a.mu.RLock()
	jobs := cloneJobs(a.cfg.Jobs)
	a.mu.RUnlock()

	resp := make([]jobResponse, 0, len(jobs))
	now := time.Now()
	for _, job := range jobs {
		resp = append(resp, buildJobResponse(job, now))
	}
	writeJSON(w, resp)
}

func (a *apiHandler) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	var req jobRequest
	if err := decodeApprovedJSON(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	now := time.Now()
	job, err := a.applyJobRequest(config.Job{
		ID:        newJobID(now),
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
	}, req, true, now)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if _, err := a.updateConfig(func(next *config.Config) {
		next.Jobs = append(next.Jobs, job)
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSONStatus(w, http.StatusCreated, buildJobResponse(job, now))
}

func (a *apiHandler) handleUpdateJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req jobRequest
	if err := decodeApprovedJSON(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	now := time.Now()
	var updated config.Job
	found := false
	var validateErr error
	if _, err := a.updateConfig(func(next *config.Config) {
		for i := range next.Jobs {
			if next.Jobs[i].ID != id {
				continue
			}
			found = true
			job, err := a.applyJobRequest(next.Jobs[i], req, false, now)
			if err != nil {
				validateErr = err
				return
			}
			next.Jobs[i] = job
			updated = job
			return
		}
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if validateErr != nil {
		http.Error(w, validateErr.Error(), http.StatusBadRequest)
		return
	}
	if !found {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}

	writeJSON(w, buildJobResponse(updated, now))
}

func (a *apiHandler) handleDeleteJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	found := false
	if _, err := a.updateConfig(func(next *config.Config) {
		for i := range next.Jobs {
			if next.Jobs[i].ID != id {
				continue
			}
			found = true
			next.Jobs = append(next.Jobs[:i], next.Jobs[i+1:]...)
			return
		}
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !found {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}
	a.manager.Remove(jobSessionKey(id))
	_ = os.RemoveAll(a.jobLogDir(id))
	writeJSON(w, map[string]string{"status": "deleted"})
}

func (a *apiHandler) handleDuplicateJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	now := time.Now()
	var duplicate config.Job
	found := false
	if _, err := a.updateConfig(func(next *config.Config) {
		for _, job := range next.Jobs {
			if job.ID != id {
				continue
			}
			found = true
			duplicate = job
			duplicate.ID = newJobID(now)
			duplicate.Name = strings.TrimSpace(duplicate.Name + " copy")
			duplicate.Enabled = false
			duplicate.CreatedAt = now
			duplicate.UpdatedAt = now
			duplicate.LastRunAt = nil
			duplicate.LastSession = ""
			duplicate.LastStatus = ""
			duplicate.LastError = ""
			duplicate.NextRunAt = nil
			duplicate.RunCount = 0
			next.Jobs = append(next.Jobs, duplicate)
			return
		}
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !found {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}
	writeJSONStatus(w, http.StatusCreated, buildJobResponse(duplicate, now))
}

func (a *apiHandler) handleRunJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	job, ok := a.jobByID(id)
	if !ok {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}
	if a.jobIsRunning(job) {
		http.Error(w, "job is already running", http.StatusConflict)
		return
	}
	if err := a.startJob(job, time.Now()); err != nil {
		if errors.Is(err, errJobAlreadyRunning) {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	updated, _ := a.jobByID(id)
	writeJSON(w, buildJobResponse(updated, time.Now()))
}

func (a *apiHandler) handleCancelJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	job, ok := a.jobByID(id)
	if !ok {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}
	if !a.jobIsRunning(job) {
		http.Error(w, "job is not running", http.StatusConflict)
		return
	}
	key := job.LastSession
	if key == "" {
		key = jobSessionKey(id)
	}
	info := a.manager.GetSessionInfo(key)
	if !info.HasSession {
		http.Error(w, "job session is not available", http.StatusConflict)
		return
	}

	now := time.Now()
	var updated config.Job
	found := false
	if _, err := a.updateConfig(func(next *config.Config) {
		for i := range next.Jobs {
			if next.Jobs[i].ID != id {
				continue
			}
			found = true
			next.Jobs[i].LastSession = key
			next.Jobs[i].LastStatus = jobStatusCanceled
			next.Jobs[i].LastError = ""
			next.Jobs[i].UpdatedAt = now
			if next.Jobs[i].Enabled && next.Jobs[i].NextRunAt == nil {
				next.Jobs[i].NextRunAt = nextJobRunAt(next.Jobs[i], now)
			}
			updated = next.Jobs[i]
			return
		}
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !found {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}
	_ = a.persistJobRunLog(updated, jobStatusCanceled, "canceled by user", now)
	a.manager.Remove(key)
	writeJSON(w, buildJobResponse(updated, now))
}

func (a *apiHandler) handleListJobRuns(w http.ResponseWriter, r *http.Request) {
	a.syncJobStatuses()

	id := r.PathValue("id")
	job, ok := a.jobByID(id)
	if !ok {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}
	key := job.LastSession
	if key == "" {
		key = jobSessionKey(id)
	}
	info := a.manager.GetSessionInfo(key)
	runs, err := a.listJobRunSummaries(job, info.HasSession, a.manager.GetOutput(key))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{
		"job_id": job.ID,
		"runs":   runs,
	})
}

func (a *apiHandler) handlePreviewJobSchedule(w http.ResponseWriter, r *http.Request) {
	var req jobSchedulePreviewRequest
	if err := decodeApprovedJSON(r, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Schedule == nil {
		writeJSON(w, jobSchedulePreviewResponse{Valid: false, Error: "schedule required"})
		return
	}
	schedule := strings.TrimSpace(*req.Schedule)
	if schedule == "" {
		writeJSON(w, jobSchedulePreviewResponse{Valid: false, Error: "schedule required"})
		return
	}
	spec, err := parseCronSchedule(schedule)
	if err != nil {
		writeJSON(w, jobSchedulePreviewResponse{Valid: false, Schedule: schedule, Error: err.Error()})
		return
	}
	count := 5
	if req.Count != nil {
		count = *req.Count
	}
	if count < 1 {
		count = 1
	} else if count > 10 {
		count = 10
	}
	nextRuns := make([]time.Time, 0, count)
	next := time.Now()
	for len(nextRuns) < count {
		next = spec.nextAfter(next)
		nextRuns = append(nextRuns, next)
	}
	writeJSON(w, jobSchedulePreviewResponse{
		Valid:    true,
		Schedule: schedule,
		NextRuns: nextRuns,
	})
}

func (a *apiHandler) handleJobOutput(w http.ResponseWriter, r *http.Request) {
	a.syncJobStatuses()

	id := r.PathValue("id")
	job, ok := a.jobByID(id)
	if !ok {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}
	key := job.LastSession
	if key == "" {
		key = jobSessionKey(id)
	}
	info := a.manager.GetSessionInfo(key)
	output := a.manager.GetOutput(key)
	currentRunID := ""
	if job.LastRunAt != nil {
		currentRunID = jobRunID(job.ID, *job.LastRunAt)
	}
	runs, err := a.listJobRunSummaries(job, info.HasSession, output)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	selectedRunID := strings.TrimSpace(r.URL.Query().Get("run"))
	if selectedRunID == "" {
		selectedRunID = currentRunID
		if output == "" && len(runs) > 0 {
			selectedRunID = runs[0].ID
		}
	}
	selectedHasSession := info.HasSession
	selectedSessionAlive := info.SessionAlive
	selectedSessionWorking := info.SessionWorking
	if selectedRunID != "" && (selectedRunID != currentRunID || (!info.HasSession && output == "")) {
		log, err := a.readJobRunLog(job.ID, selectedRunID)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				http.Error(w, "job run log not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		output = log.Output
		selectedHasSession = false
		selectedSessionAlive = false
		selectedSessionWorking = false
	}

	writeJSON(w, map[string]any{
		"job_id":          job.ID,
		"session":         key,
		"has_session":     selectedHasSession,
		"session_alive":   selectedSessionAlive,
		"session_working": selectedSessionWorking,
		"selected_run_id": selectedRunID,
		"runs":            runs,
		"output":          output,
	})
}

func (a *apiHandler) applyJobRequest(job config.Job, req jobRequest, creating bool, now time.Time) (config.Job, error) {
	prevSchedule := job.Schedule
	prevEnabled := job.Enabled
	if creating {
		if req.Project == nil {
			return job, errors.New("project required")
		}
		if req.Schedule == nil {
			return job, errors.New("schedule required")
		}
		if req.Prompt == nil {
			return job, errors.New("prompt required")
		}
	}
	if req.Name != nil {
		job.Name = strings.TrimSpace(*req.Name)
	}
	if req.Project != nil {
		job.Project = strings.TrimSpace(*req.Project)
	}
	if req.Schedule != nil {
		job.Schedule = strings.TrimSpace(*req.Schedule)
	}
	if req.Prompt != nil {
		job.Prompt = strings.TrimSpace(*req.Prompt)
	}
	if req.Enabled != nil {
		job.Enabled = *req.Enabled
	}

	if job.Project == "" {
		return job, errors.New("project required")
	}
	if (creating || req.Project != nil) && a.findProject(job.Project) == nil {
		return job, fmt.Errorf("project not found: %s", job.Project)
	}
	if job.Schedule == "" {
		return job, errors.New("schedule required")
	}
	if _, err := parseCronSchedule(job.Schedule); err != nil {
		return job, err
	}
	if job.Prompt == "" {
		return job, errors.New("prompt required")
	}
	if len(job.Prompt) > 20000 {
		return job, errors.New("prompt is too long")
	}
	if job.Name == "" {
		job.Name = job.Project + " job"
	}
	if len(job.Name) > 120 {
		return job, errors.New("name is too long")
	}

	if creating || req.Schedule != nil || req.Enabled != nil || job.NextRunAt == nil || prevSchedule != job.Schedule || prevEnabled != job.Enabled {
		job.NextRunAt = nextJobRunAt(job, now)
	}
	job.UpdatedAt = now
	return job, nil
}

func (a *apiHandler) jobByID(id string) (config.Job, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	for _, job := range a.cfg.Jobs {
		if job.ID == id {
			return job, true
		}
	}
	return config.Job{}, false
}

func (a *apiHandler) startJob(job config.Job, now time.Time) error {
	a.syncJobStatuses()
	if !a.acquireJobStart(job.ID) {
		return errJobAlreadyRunning
	}
	defer a.releaseJobStart(job.ID)

	proj := a.findProject(job.Project)
	if proj == nil {
		a.markJobFailed(job.ID, now, "project not found")
		return fmt.Errorf("project not found: %s", job.Project)
	}

	a.mu.RLock()
	cli := a.cfg.CLI
	agentCmd, err := ptyPkg.JobCommand(cli, a.cfg.DangerousPermissions, shellQuote(job.Prompt), a.cfg.CLIIntegrations)
	a.mu.RUnlock()
	if err != nil {
		a.markJobFailed(job.ID, now, err.Error())
		return err
	}
	sessionKey := jobSessionKey(job.ID)
	command := "exec " + agentCmd
	if _, err := a.manager.CreateWithCommandOutputLimit(sessionKey, proj.Path, 120, 40, command, jobOutputBufSize); err != nil {
		a.markJobFailed(job.ID, now, err.Error())
		return err
	}

	if _, err := a.updateConfig(func(next *config.Config) {
		for i := range next.Jobs {
			if next.Jobs[i].ID != job.ID {
				continue
			}
			next.Jobs[i].LastRunAt = &now
			next.Jobs[i].LastSession = sessionKey
			next.Jobs[i].LastStatus = jobStatusRunning
			next.Jobs[i].LastError = ""
			next.Jobs[i].NextRunAt = nextJobRunAt(next.Jobs[i], now)
			next.Jobs[i].RunCount++
			next.Jobs[i].UpdatedAt = now
			return
		}
	}); err != nil {
		a.manager.Remove(sessionKey)
		return err
	}
	go a.watchJobCompletion(job.ID, sessionKey, now)
	return nil
}

func (a *apiHandler) watchJobCompletion(id, sessionKey string, startedAt time.Time) {
	for {
		job, ok := a.jobByID(id)
		if !ok || job.LastRunAt == nil || !job.LastRunAt.Equal(startedAt) || job.LastStatus != jobStatusRunning {
			return
		}
		info := a.manager.GetSessionInfo(sessionKey)
		if !info.HasSession || info.ProcessExited {
			a.syncJobStatuses()
			return
		}
		time.Sleep(time.Second)
	}
}

func (a *apiHandler) acquireJobStart(id string) bool {
	a.jobStartMu.Lock()
	defer a.jobStartMu.Unlock()
	if a.startingJobs == nil {
		a.startingJobs = make(map[string]struct{})
	}
	if _, ok := a.startingJobs[id]; ok {
		return false
	}
	a.startingJobs[id] = struct{}{}
	return true
}

func (a *apiHandler) releaseJobStart(id string) {
	a.jobStartMu.Lock()
	defer a.jobStartMu.Unlock()
	delete(a.startingJobs, id)
}

func (a *apiHandler) jobStartInProgress(id string) bool {
	a.jobStartMu.Lock()
	defer a.jobStartMu.Unlock()
	_, ok := a.startingJobs[id]
	return ok
}

func (a *apiHandler) markJobFailed(id string, now time.Time, message string) {
	var failed config.Job
	found := false
	_, _ = a.updateConfig(func(next *config.Config) {
		for i := range next.Jobs {
			if next.Jobs[i].ID != id {
				continue
			}
			next.Jobs[i].LastRunAt = &now
			next.Jobs[i].LastSession = jobSessionKey(id)
			next.Jobs[i].LastStatus = jobStatusFailed
			next.Jobs[i].LastError = message
			next.Jobs[i].NextRunAt = nextJobRunAt(next.Jobs[i], now)
			next.Jobs[i].UpdatedAt = now
			failed = next.Jobs[i]
			found = true
			return
		}
	})
	if found {
		_ = a.persistJobRunLog(failed, jobStatusFailed, message, now)
	}
}

func (a *apiHandler) syncJobStatuses() {
	now := time.Now()
	type jobStatusUpdate struct {
		UpdatedAt  time.Time
		LastStatus string
		LastError  string
	}
	updates := make(map[string]jobStatusUpdate)

	a.mu.RLock()
	jobs := cloneJobs(a.cfg.Jobs)
	a.mu.RUnlock()

	for _, job := range jobs {
		if job.LastStatus != jobStatusRunning || job.LastSession == "" {
			continue
		}
		if a.jobStartInProgress(job.ID) {
			continue
		}
		info := a.manager.GetSessionInfo(job.LastSession)
		if info.HasSession && !info.ProcessExited {
			continue
		}
		update := jobStatusUpdate{UpdatedAt: now}
		if !info.HasSession {
			update.LastStatus = jobStatusFailed
			update.LastError = "job session is no longer available"
		} else if info.ExitCode != nil && *info.ExitCode != 0 {
			update.LastStatus = jobStatusFailed
			if info.ExitError != "" {
				update.LastError = info.ExitError
			} else {
				update.LastError = fmt.Sprintf("exit code %d", *info.ExitCode)
			}
		} else {
			update.LastStatus = jobStatusCompleted
			update.LastError = ""
		}
		_ = a.persistJobRunLog(job, update.LastStatus, update.LastError, now)
		updates[job.ID] = update
	}

	if len(updates) == 0 {
		return
	}
	_, _ = a.updateConfig(func(next *config.Config) {
		for i := range next.Jobs {
			if update, ok := updates[next.Jobs[i].ID]; ok {
				next.Jobs[i].LastStatus = update.LastStatus
				next.Jobs[i].LastError = update.LastError
				next.Jobs[i].UpdatedAt = update.UpdatedAt
			}
		}
	})
}

func (a *apiHandler) jobIsRunning(job config.Job) bool {
	if a.jobStartInProgress(job.ID) {
		return true
	}
	key := job.LastSession
	if key == "" {
		key = jobSessionKey(job.ID)
	}
	info := a.manager.GetSessionInfo(key)
	return info.HasSession && info.SessionAlive && !info.ProcessExited
}

func jobDue(job config.Job, now time.Time) bool {
	return job.Enabled && job.NextRunAt != nil && !job.NextRunAt.After(now)
}

func buildJobResponse(job config.Job, now time.Time) jobResponse {
	resp := jobResponse{Job: job}
	if !resp.Enabled {
		resp.NextRunAt = nil
		return resp
	}
	if resp.NextRunAt == nil {
		resp.NextRunAt = nextJobRunAt(resp.Job, now)
	}
	return resp
}

func (a *apiHandler) ensureJobNextRunAt(now time.Time) {
	a.mu.RLock()
	jobs := cloneJobs(a.cfg.Jobs)
	a.mu.RUnlock()

	needsUpdate := false
	for _, job := range jobs {
		if !job.Enabled && job.NextRunAt != nil {
			needsUpdate = true
			break
		}
		if job.Enabled && job.NextRunAt == nil && nextJobRunAt(job, now) != nil {
			needsUpdate = true
			break
		}
	}
	if !needsUpdate {
		return
	}

	_, _ = a.updateConfig(func(next *config.Config) {
		for i := range next.Jobs {
			if !next.Jobs[i].Enabled {
				next.Jobs[i].NextRunAt = nil
				continue
			}
			if next.Jobs[i].NextRunAt == nil {
				next.Jobs[i].NextRunAt = nextJobRunAt(next.Jobs[i], now)
			}
		}
	})
}

func nextJobRunAt(job config.Job, now time.Time) *time.Time {
	if !job.Enabled {
		return nil
	}
	spec, err := parseCronSchedule(job.Schedule)
	if err != nil {
		return nil
	}
	next := spec.nextAfter(now)
	return &next
}

func jobSessionKey(id string) string {
	return jobSessionPrefix + id
}

func newJobID(now time.Time) string {
	return "job-" + strconv.FormatInt(now.UnixNano(), 36)
}

func jobRunID(jobID string, startedAt time.Time) string {
	return safeJobLogID(jobID) + "-" + startedAt.UTC().Format("20060102T150405.000000000Z")
}

func safeJobLogID(id string) string {
	var b strings.Builder
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	if b.Len() == 0 {
		return "unknown"
	}
	return b.String()
}

func (a *apiHandler) jobLogDir(jobID string) string {
	base := filepath.Join(filepath.Dir(a.configPath), ".agentdeck", "job-logs")
	return filepath.Join(base, safeJobLogID(jobID))
}

func (a *apiHandler) jobRunLogPath(jobID, runID string) string {
	return filepath.Join(a.jobLogDir(jobID), safeJobLogID(runID)+".json")
}

func (a *apiHandler) persistJobRunLog(job config.Job, status, message string, completedAt time.Time) error {
	if job.LastRunAt == nil {
		return nil
	}
	key := job.LastSession
	if key == "" {
		key = jobSessionKey(job.ID)
	}
	runID := jobRunID(job.ID, *job.LastRunAt)
	path := a.jobRunLogPath(job.ID, runID)
	info := a.manager.GetSessionInfo(key)
	if !info.HasSession {
		if _, err := os.Stat(path); err == nil {
			return nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	output := a.manager.GetOutput(key)
	if output == "" && message != "" {
		output = message + "\n"
	}
	log := jobRunLog{
		ID:          runID,
		JobID:       job.ID,
		JobName:     job.Name,
		Project:     job.Project,
		StartedAt:   *job.LastRunAt,
		CompletedAt: &completedAt,
		Status:      status,
		Error:       message,
		Session:     key,
		Output:      output,
	}

	dir := a.jobLogDir(job.ID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(log, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, "."+safeJobLogID(log.ID)+".tmp")
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (a *apiHandler) readJobRunLog(jobID, runID string) (jobRunLog, error) {
	data, err := os.ReadFile(a.jobRunLogPath(jobID, runID))
	if err != nil {
		return jobRunLog{}, err
	}
	var log jobRunLog
	if err := json.Unmarshal(data, &log); err != nil {
		return jobRunLog{}, err
	}
	if log.JobID != jobID || log.ID != runID {
		return jobRunLog{}, os.ErrNotExist
	}
	return log, nil
}

func (a *apiHandler) listJobRunSummaries(job config.Job, hasCurrentSession bool, currentOutput string) ([]jobRunSummary, error) {
	entries, err := os.ReadDir(a.jobLogDir(job.ID))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	runs := make([]jobRunSummary, 0, len(entries)+1)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		runID := strings.TrimSuffix(entry.Name(), ".json")
		log, err := a.readJobRunLog(job.ID, runID)
		if err != nil {
			continue
		}
		runs = append(runs, jobRunSummary{
			ID:          log.ID,
			StartedAt:   log.StartedAt,
			CompletedAt: log.CompletedAt,
			Status:      log.Status,
			Error:       log.Error,
			OutputBytes: len(log.Output),
		})
	}

	if job.LastRunAt != nil && (hasCurrentSession || currentOutput != "" || job.LastStatus == jobStatusRunning) {
		currentID := jobRunID(job.ID, *job.LastRunAt)
		found := false
		for i := range runs {
			if runs[i].ID != currentID {
				continue
			}
			runs[i].HasSession = hasCurrentSession
			if len(currentOutput) > runs[i].OutputBytes {
				runs[i].OutputBytes = len(currentOutput)
			}
			found = true
			break
		}
		if !found {
			var completedAt *time.Time
			if job.LastStatus == jobStatusCompleted || job.LastStatus == jobStatusFailed || job.LastStatus == jobStatusCanceled {
				completed := job.UpdatedAt
				completedAt = &completed
			}
			runs = append(runs, jobRunSummary{
				ID:          currentID,
				StartedAt:   *job.LastRunAt,
				CompletedAt: completedAt,
				Status:      job.LastStatus,
				Error:       job.LastError,
				OutputBytes: len(currentOutput),
				HasSession:  hasCurrentSession,
			})
		}
	}

	sort.Slice(runs, func(i, j int) bool {
		if runs[i].StartedAt.Equal(runs[j].StartedAt) {
			return runs[i].ID > runs[j].ID
		}
		return runs[i].StartedAt.After(runs[j].StartedAt)
	})
	return runs, nil
}

func decodeApprovedJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

func writeJSONStatus(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

type cronSchedule struct {
	minute     cronField
	hour       cronField
	dayOfMonth cronField
	month      cronField
	dayOfWeek  cronField
}

type cronField struct {
	wildcard bool
	values   map[int]bool
}

func parseCronSchedule(expr string) (cronSchedule, error) {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return cronSchedule{}, errors.New("schedule must use five cron fields")
	}
	minute, err := parseCronField(fields[0], 0, 59, nil)
	if err != nil {
		return cronSchedule{}, fmt.Errorf("minute: %w", err)
	}
	hour, err := parseCronField(fields[1], 0, 23, nil)
	if err != nil {
		return cronSchedule{}, fmt.Errorf("hour: %w", err)
	}
	dayOfMonth, err := parseCronField(fields[2], 1, 31, nil)
	if err != nil {
		return cronSchedule{}, fmt.Errorf("day of month: %w", err)
	}
	month, err := parseCronField(fields[3], 1, 12, nil)
	if err != nil {
		return cronSchedule{}, fmt.Errorf("month: %w", err)
	}
	dayOfWeek, err := parseCronField(fields[4], 0, 7, func(v int) int {
		if v == 7 {
			return 0
		}
		return v
	})
	if err != nil {
		return cronSchedule{}, fmt.Errorf("day of week: %w", err)
	}
	return cronSchedule{minute: minute, hour: hour, dayOfMonth: dayOfMonth, month: month, dayOfWeek: dayOfWeek}, nil
}

func parseCronField(raw string, min, max int, normalize func(int) int) (cronField, error) {
	values := make(map[int]bool)
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return cronField{}, errors.New("empty field part")
		}
		step := 1
		base := part
		if strings.Contains(part, "/") {
			pieces := strings.Split(part, "/")
			if len(pieces) != 2 || pieces[1] == "" {
				return cronField{}, fmt.Errorf("invalid step %q", part)
			}
			var err error
			step, err = strconv.Atoi(pieces[1])
			if err != nil || step <= 0 {
				return cronField{}, fmt.Errorf("invalid step %q", part)
			}
			base = pieces[0]
		}

		start, end, err := cronFieldRange(base, min, max)
		if err != nil {
			return cronField{}, err
		}
		for v := start; v <= end; v += step {
			value := v
			if normalize != nil {
				value = normalize(value)
			}
			values[value] = true
		}
	}
	return cronField{wildcard: cronFieldIsWildcard(values, min, max, normalize), values: values}, nil
}

func cronFieldRange(raw string, min, max int) (int, int, error) {
	if raw == "*" {
		return min, max, nil
	}
	if strings.Contains(raw, "-") {
		pieces := strings.Split(raw, "-")
		if len(pieces) != 2 {
			return 0, 0, fmt.Errorf("invalid range %q", raw)
		}
		start, err := strconv.Atoi(pieces[0])
		if err != nil {
			return 0, 0, fmt.Errorf("invalid value %q", pieces[0])
		}
		end, err := strconv.Atoi(pieces[1])
		if err != nil {
			return 0, 0, fmt.Errorf("invalid value %q", pieces[1])
		}
		if start > end {
			return 0, 0, fmt.Errorf("invalid range %q", raw)
		}
		if start < min || end > max {
			return 0, 0, fmt.Errorf("range %q out of bounds", raw)
		}
		return start, end, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, 0, fmt.Errorf("invalid value %q", raw)
	}
	if value < min || value > max {
		return 0, 0, fmt.Errorf("value %d out of bounds", value)
	}
	return value, value, nil
}

func cronFieldIsWildcard(values map[int]bool, min, max int, normalize func(int) int) bool {
	all := make(map[int]bool)
	for v := min; v <= max; v++ {
		value := v
		if normalize != nil {
			value = normalize(value)
		}
		all[value] = true
	}
	if len(values) != len(all) {
		return false
	}
	for value := range all {
		if !values[value] {
			return false
		}
	}
	return true
}

func (f cronField) matches(value int) bool {
	return f.wildcard || f.values[value]
}

func (s cronSchedule) matches(t time.Time) bool {
	if !s.minute.matches(t.Minute()) || !s.hour.matches(t.Hour()) || !s.month.matches(int(t.Month())) {
		return false
	}
	dayOfMonth := s.dayOfMonth.matches(t.Day())
	dayOfWeek := s.dayOfWeek.matches(int(t.Weekday()))
	if !s.dayOfMonth.wildcard && !s.dayOfWeek.wildcard {
		return dayOfMonth || dayOfWeek
	}
	return dayOfMonth && dayOfWeek
}

func (s cronSchedule) nextAfter(t time.Time) time.Time {
	next := t.Truncate(time.Minute).Add(time.Minute)
	for i := 0; i < 366*24*60; i++ {
		if s.matches(next) {
			return next
		}
		next = next.Add(time.Minute)
	}
	return next
}
