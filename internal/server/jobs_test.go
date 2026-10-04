package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"agentdeck/internal/config"
	ptyPkg "agentdeck/internal/pty"
	"agentdeck/internal/scanner"
)

func TestCronScheduleSupportsCommonPatterns(t *testing.T) {
	spec, err := parseCronSchedule("*/15 9-17 * * 1,3,5")
	if err != nil {
		t.Fatalf("parseCronSchedule returned error: %v", err)
	}

	monday := time.Date(2026, 6, 15, 9, 30, 0, 0, time.Local)
	if !spec.matches(monday) {
		t.Fatalf("schedule did not match %s", monday)
	}

	sunday := time.Date(2026, 6, 14, 9, 30, 0, 0, time.Local)
	if spec.matches(sunday) {
		t.Fatalf("schedule matched %s", sunday)
	}

	next := spec.nextAfter(time.Date(2026, 6, 15, 9, 30, 10, 0, time.Local))
	want := time.Date(2026, 6, 15, 9, 45, 0, 0, time.Local)
	if !next.Equal(want) {
		t.Fatalf("nextAfter = %s, want %s", next, want)
	}
}

func TestCreateJobRejectsUnapprovedFields(t *testing.T) {
	api := newJobsTestAPI(t)
	body := bytes.NewBufferString(`{"project":"proj","schedule":"* * * * *","prompt":"do it","last_status":"running"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/jobs", body)

	api.handleCreateJob(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if len(api.cfg.Jobs) != 0 {
		t.Fatalf("jobs = %d, want 0", len(api.cfg.Jobs))
	}
}

func TestCreateAndDuplicateJob(t *testing.T) {
	api := newJobsTestAPI(t)
	body := bytes.NewBufferString(`{"name":"Daily check","project":"proj","schedule":"0 9 * * 1-5","prompt":"check status","enabled":true}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/jobs", body)

	api.handleCreateJob(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if len(api.cfg.Jobs) != 1 {
		t.Fatalf("jobs = %d, want 1", len(api.cfg.Jobs))
	}
	var created jobResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created response: %v", err)
	}
	if created.NextRunAt == nil {
		t.Fatal("created job did not include next_run_at")
	}
	if api.cfg.Jobs[0].NextRunAt == nil {
		t.Fatal("created job did not persist next_run_at")
	}

	dupRec := httptest.NewRecorder()
	dupReq := httptest.NewRequest(http.MethodPost, "/api/jobs/"+created.ID+"/duplicate", nil)
	dupReq.SetPathValue("id", created.ID)
	api.handleDuplicateJob(dupRec, dupReq)

	if dupRec.Code != http.StatusCreated {
		t.Fatalf("duplicate status = %d, want %d: %s", dupRec.Code, http.StatusCreated, dupRec.Body.String())
	}
	if len(api.cfg.Jobs) != 2 {
		t.Fatalf("jobs = %d, want 2", len(api.cfg.Jobs))
	}
	if api.cfg.Jobs[1].Enabled {
		t.Fatal("duplicated job enabled = true, want false")
	}
	if api.cfg.Jobs[1].NextRunAt != nil {
		t.Fatal("duplicated disabled job carried next_run_at")
	}
	if api.cfg.Jobs[1].RunCount != 0 || api.cfg.Jobs[1].LastSession != "" {
		t.Fatalf("duplicated job carried run state: %#v", api.cfg.Jobs[1])
	}
}

func TestListJobsBackfillsPersistedNextRunAt(t *testing.T) {
	api := newJobsTestAPI(t)
	now := time.Date(2026, 6, 12, 9, 30, 0, 0, time.UTC)
	api.cfg.Jobs = []config.Job{{
		ID:        "job-1",
		Name:      "Daily check",
		Project:   "proj",
		Schedule:  "* * * * *",
		Prompt:    "check status",
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
	}}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/jobs", nil)
	api.handleListJobs(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if api.cfg.Jobs[0].NextRunAt == nil {
		t.Fatal("list jobs did not backfill next_run_at")
	}
}

func TestPreviewJobScheduleValidatesAndReturnsRuns(t *testing.T) {
	api := newJobsTestAPI(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/jobs/schedule/preview", bytes.NewBufferString(`{"schedule":"0 9 * * 1-5","count":3}`))
	api.handlePreviewJobSchedule(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("valid preview status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var valid jobSchedulePreviewResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &valid); err != nil {
		t.Fatalf("decode valid preview: %v", err)
	}
	if !valid.Valid || len(valid.NextRuns) != 3 {
		t.Fatalf("valid preview = %#v, want valid with 3 runs", valid)
	}

	invalidRec := httptest.NewRecorder()
	invalidReq := httptest.NewRequest(http.MethodPost, "/api/jobs/schedule/preview", bytes.NewBufferString(`{"schedule":"80 9 * * *"}`))
	api.handlePreviewJobSchedule(invalidRec, invalidReq)

	if invalidRec.Code != http.StatusOK {
		t.Fatalf("invalid preview status = %d, want %d: %s", invalidRec.Code, http.StatusOK, invalidRec.Body.String())
	}
	var invalid jobSchedulePreviewResponse
	if err := json.Unmarshal(invalidRec.Body.Bytes(), &invalid); err != nil {
		t.Fatalf("decode invalid preview: %v", err)
	}
	if invalid.Valid || !strings.Contains(invalid.Error, "minute") {
		t.Fatalf("invalid preview = %#v, want minute error", invalid)
	}
}

func TestJobStartGuardRejectsConcurrentStart(t *testing.T) {
	api := newJobsTestAPI(t)
	now := time.Date(2026, 6, 12, 9, 30, 0, 0, time.UTC)
	job := config.Job{
		ID:        "job-1",
		Name:      "Daily check",
		Project:   "proj",
		Schedule:  "* * * * *",
		Prompt:    "check status",
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
	}
	api.cfg.Jobs = []config.Job{job}

	if !api.acquireJobStart(job.ID) {
		t.Fatal("first acquireJobStart returned false")
	}
	if api.acquireJobStart(job.ID) {
		t.Fatal("second acquireJobStart returned true")
	}
	if !api.jobIsRunning(job) {
		t.Fatal("jobIsRunning returned false while start is in progress")
	}
	api.releaseJobStart(job.ID)
	if !api.acquireJobStart(job.ID) {
		t.Fatal("acquireJobStart returned false after release")
	}
	api.releaseJobStart(job.ID)
}

func TestJobDueUsesPersistedNextRunAt(t *testing.T) {
	now := time.Date(2026, 6, 12, 9, 30, 0, 0, time.UTC)
	future := now.Add(time.Minute)
	past := now.Add(-time.Second)

	if jobDue(config.Job{Enabled: true, NextRunAt: &future}, now) {
		t.Fatal("jobDue returned true before next_run_at")
	}
	if !jobDue(config.Job{Enabled: true, NextRunAt: &past}, now) {
		t.Fatal("jobDue returned false after next_run_at")
	}
	if jobDue(config.Job{Enabled: false, NextRunAt: &past}, now) {
		t.Fatal("jobDue returned true for disabled job")
	}
}

func TestStartJobAdvancesPersistedNextRunAt(t *testing.T) {
	api := newJobsTestAPI(t)
	installFakeAgent(t, "claude")
	t.Setenv("SHELL", "/bin/sh")
	now := time.Date(2026, 6, 12, 9, 30, 0, 0, time.UTC)
	due := now.Add(-time.Minute)
	job := config.Job{
		ID:        "job-1",
		Name:      "Daily check",
		Project:   "proj",
		Schedule:  "* * * * *",
		Prompt:    "check status",
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
		NextRunAt: &due,
	}
	api.cfg.Jobs = []config.Job{job}

	if err := api.startJob(job, now); err != nil {
		t.Fatalf("startJob returned error: %v", err)
	}
	if api.cfg.Jobs[0].NextRunAt == nil || !api.cfg.Jobs[0].NextRunAt.After(now) {
		t.Fatalf("next_run_at = %v, want after %s", api.cfg.Jobs[0].NextRunAt, now)
	}
}

func TestCancelJobPersistsCanceledRun(t *testing.T) {
	api := newJobsTestAPI(t)
	t.Setenv("SHELL", "/bin/sh")
	started := time.Date(2026, 6, 23, 9, 30, 0, 0, time.UTC)
	next := started.Add(time.Hour)
	job := config.Job{
		ID:          "job-1",
		Name:        "Daily check",
		Project:     "proj",
		Schedule:    "* * * * *",
		Prompt:      "check status",
		Enabled:     true,
		CreatedAt:   started,
		UpdatedAt:   started,
		LastRunAt:   &started,
		NextRunAt:   &next,
		LastSession: jobSessionKey("job-1"),
		LastStatus:  jobStatusRunning,
		RunCount:    1,
	}
	api.cfg.Jobs = []config.Job{job}

	if _, err := api.manager.CreateWithCommandOutputLimit(job.LastSession, api.projects[0].Path, 80, 24, "printf 'before cancel'; sleep 30", jobOutputBufSize); err != nil {
		t.Fatalf("start job session: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/jobs/"+job.ID+"/cancel", nil)
	req.SetPathValue("id", job.ID)
	api.handleCancelJob(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("cancel status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := api.cfg.Jobs[0].LastStatus; got != jobStatusCanceled {
		t.Fatalf("last status = %q, want %q", got, jobStatusCanceled)
	}

	runsRec := httptest.NewRecorder()
	runsReq := httptest.NewRequest(http.MethodGet, "/api/jobs/"+job.ID+"/runs", nil)
	runsReq.SetPathValue("id", job.ID)
	api.handleListJobRuns(runsRec, runsReq)

	if runsRec.Code != http.StatusOK {
		t.Fatalf("runs status = %d, want %d: %s", runsRec.Code, http.StatusOK, runsRec.Body.String())
	}
	var runsResp struct {
		Runs []jobRunSummary `json:"runs"`
	}
	if err := json.Unmarshal(runsRec.Body.Bytes(), &runsResp); err != nil {
		t.Fatalf("decode runs response: %v", err)
	}
	if len(runsResp.Runs) != 1 || runsResp.Runs[0].Status != jobStatusCanceled {
		t.Fatalf("runs = %#v, want one canceled run", runsResp.Runs)
	}
}

func TestJobOutputFallsBackToPersistedRunLog(t *testing.T) {
	api := newJobsTestAPI(t)
	t.Setenv("SHELL", "/bin/sh")
	started := time.Date(2026, 6, 23, 9, 30, 0, 0, time.UTC)
	job := config.Job{
		ID:          "job-1",
		Name:        "Daily check",
		Project:     "proj",
		Schedule:    "* * * * *",
		Prompt:      "check status",
		Enabled:     true,
		CreatedAt:   started,
		UpdatedAt:   started,
		LastRunAt:   &started,
		LastSession: jobSessionKey("job-1"),
		LastStatus:  jobStatusRunning,
		RunCount:    1,
	}
	api.cfg.Jobs = []config.Job{job}

	if _, err := api.manager.CreateWithCommandOutputLimit(job.LastSession, api.projects[0].Path, 80, 24, "printf 'persisted log'", jobOutputBufSize); err != nil {
		t.Fatalf("start job session: %v", err)
	}
	waitForJobSessionExit(t, api, job.LastSession)

	api.syncJobStatuses()
	if got := api.cfg.Jobs[0].LastStatus; got != jobStatusCompleted {
		t.Fatalf("last status = %q, want %q", got, jobStatusCompleted)
	}
	api.manager.Remove(job.LastSession)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/jobs/"+job.ID+"/output", nil)
	req.SetPathValue("id", job.ID)
	api.handleJobOutput(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("output status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var resp struct {
		Output string          `json:"output"`
		Runs   []jobRunSummary `json:"runs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode output response: %v", err)
	}
	if !strings.Contains(resp.Output, "persisted log") {
		t.Fatalf("output = %q, want persisted log", resp.Output)
	}
	if len(resp.Runs) != 1 {
		t.Fatalf("runs = %d, want 1", len(resp.Runs))
	}
}

func TestStartJobRunsSelectedCLI(t *testing.T) {
	tests := []struct {
		cli       string
		binary    string
		dangerous bool
		want      string
	}{
		{cli: "default", binary: "claude", want: "fake claude: [-p] [check 'status']"},
		{cli: "openai", binary: "codex", want: "fake codex: [exec] [check 'status']"},
		{cli: "openai", binary: "codex", dangerous: true, want: "fake codex: [exec] [--dangerously-bypass-approvals-and-sandbox] [check 'status']"},
		{cli: "opencode", binary: "opencode", want: "fake opencode: [run] [check 'status']"},
	}
	for _, tt := range tests {
		t.Run(tt.cli+"/"+strconv.FormatBool(tt.dangerous), func(t *testing.T) {
			api := newJobsTestAPI(t)
			installFakeAgent(t, tt.binary)
			t.Setenv("SHELL", "/bin/sh")
			if tt.cli != "default" {
				api.cfg.CLI = tt.cli
			}
			if tt.dangerous {
				api.cfg.DangerousPermissions = map[string]bool{tt.cli: true}
			}
			now := time.Date(2026, 6, 12, 9, 30, 0, 0, time.UTC)
			job := config.Job{ID: "job-1", Project: "proj", Schedule: "* * * * *", Prompt: "check 'status'", Enabled: true, CreatedAt: now, UpdatedAt: now}
			api.cfg.Jobs = []config.Job{job}

			if err := api.startJob(job, now); err != nil {
				t.Fatalf("startJob returned error: %v", err)
			}
			session := jobSessionKey(job.ID)
			waitForJobSessionExit(t, api, session)
			if got := api.manager.GetOutput(session); !strings.Contains(got, tt.want) {
				t.Fatalf("job output = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestStartJobFailsForCustomCLI(t *testing.T) {
	api := newJobsTestAPI(t)
	api.cfg.CLI = "headroom"
	api.cfg.CLIIntegrations = []config.CLIIntegration{{ID: "headroom", Name: "Headroom", Command: "headroom claude"}}
	now := time.Date(2026, 6, 12, 9, 30, 0, 0, time.UTC)
	job := config.Job{ID: "job-1", Project: "proj", Schedule: "* * * * *", Prompt: "check status", Enabled: true, CreatedAt: now, UpdatedAt: now}
	api.cfg.Jobs = []config.Job{job}

	if err := api.startJob(job, now); err == nil {
		t.Fatal("startJob returned nil error for a custom CLI")
	}
	if got := api.cfg.Jobs[0]; got.LastStatus != jobStatusFailed || !strings.Contains(got.LastError, "headroom") {
		t.Fatalf("job status = %q, error = %q; want failed naming the CLI", got.LastStatus, got.LastError)
	}
	if api.manager.Get(jobSessionKey(job.ID)) != nil {
		t.Fatal("custom CLI job started a session")
	}
}

func waitForJobSessionExit(t *testing.T, api *apiHandler, session string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		info := api.manager.GetSessionInfo(session)
		if info.ProcessExited {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("session %s did not exit", session)
}

// installFakeAgent puts an executable named name on PATH that echoes its
// arguments, so a job's output shows exactly which CLI ran and how. Job
// sessions start a login shell, which rebuilds PATH from /etc/profile, so the
// fake directory is also prepended from a ~/.profile under a temporary HOME.
func installFakeAgent(t *testing.T, name string) {
	t.Helper()
	home := t.TempDir()
	binDir := filepath.Join(home, "bin")
	if err := os.Mkdir(binDir, 0755); err != nil {
		t.Fatalf("mkdir fake bin: %v", err)
	}
	script := "#!/bin/sh\nprintf 'fake " + name + ":'; printf ' [%s]' \"$@\"\n"
	if err := os.WriteFile(filepath.Join(binDir, name), []byte(script), 0755); err != nil {
		t.Fatalf("write fake %s: %v", name, err)
	}
	profile := "PATH=" + binDir + ":$PATH\nexport PATH\n"
	if err := os.WriteFile(filepath.Join(home, ".profile"), []byte(profile), 0644); err != nil {
		t.Fatalf("write fake profile: %v", err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func newJobsTestAPI(t *testing.T) *apiHandler {
	t.Helper()
	dir := t.TempDir()
	projectDir := filepath.Join(dir, "proj")
	if err := os.Mkdir(projectDir, 0755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	return &apiHandler{
		configPath: filepath.Join(dir, "config.json"),
		cfg:        &config.Config{},
		projects: []scanner.Project{{
			Name: "proj",
			Path: projectDir,
		}},
		manager: ptyPkg.NewManager(),
	}
}
