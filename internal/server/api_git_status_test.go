package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"agentdeck/internal/scanner"
)

func newGitStatusTestHandler(dir string) *apiHandler {
	return &apiHandler{projects: []scanner.Project{{Name: "proj", Path: dir}}}
}

func getProjectJSON(t *testing.T, handler http.HandlerFunc, target string, out any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("X-Project-Name", "proj")
	rec := httptest.NewRecorder()
	handler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s = %d, want 200: %s", target, rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
		t.Fatalf("decode %s response: %v", target, err)
	}
}

// branchWithCommittedAndDirtyWork puts "readme.txt" through all three states the
// panel has to distinguish: "v1" at the trunk fork point, "v2" committed on the
// branch, "v3" uncommitted in the working tree.
func branchWithCommittedAndDirtyWork(t *testing.T) string {
	t.Helper()
	dir := initRepo(t)
	mustGit(t, dir, "checkout", "-b", "feature")
	commitFile(t, dir, "readme.txt", "v2\n", "branch edit")
	if err := os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("v3\n"), 0644); err != nil {
		t.Fatalf("write readme.txt: %v", err)
	}
	return dir
}

func TestProjectStatusComparesAgainstTrunkOnRequest(t *testing.T) {
	dir := branchWithCommittedAndDirtyWork(t)
	api := newGitStatusTestHandler(dir)

	var headStatus GitStatus
	getProjectJSON(t, api.handleProjectStatus, "/api/projects/proj/status", &headStatus)
	if headStatus.DiffBase != "" {
		t.Errorf("DiffBase = %q, want empty without base=trunk", headStatus.DiffBase)
	}
	if headStatus.TrunkBranch != "main" {
		t.Errorf("TrunkBranch = %q, want %q", headStatus.TrunkBranch, "main")
	}

	var trunkStatus GitStatus
	getProjectJSON(t, api.handleProjectStatus, "/api/projects/proj/status?base=trunk", &trunkStatus)
	if !isGitCommitHash(trunkStatus.DiffBase) {
		t.Fatalf("DiffBase = %q, want a commit hash", trunkStatus.DiffBase)
	}
	if len(trunkStatus.Files) != 1 || trunkStatus.Files[0].Name != "readme.txt" {
		t.Fatalf("files = %#v, want readme.txt", trunkStatus.Files)
	}
	if trunkStatus.Files[0].Revertible {
		t.Error("Revertible = true, want false — the committed half cannot be reverted")
	}
}

func TestReadFileUsesBaseCommitForOriginalSide(t *testing.T) {
	dir := branchWithCommittedAndDirtyWork(t)
	api := newGitStatusTestHandler(dir)

	var trunkStatus GitStatus
	getProjectJSON(t, api.handleProjectStatus, "/api/projects/proj/status?base=trunk", &trunkStatus)

	var headFile struct {
		Original string `json:"original"`
		Modified string `json:"modified"`
	}
	getProjectJSON(t, api.handleReadFile, "/api/projects/proj/file?path=readme.txt", &headFile)
	if headFile.Original != "v2\n" || headFile.Modified != "v3\n" {
		t.Errorf("HEAD diff = %q -> %q, want %q -> %q", headFile.Original, headFile.Modified, "v2\n", "v3\n")
	}

	var baseFile struct {
		Original string `json:"original"`
		Modified string `json:"modified"`
	}
	getProjectJSON(t, api.handleReadFile, "/api/projects/proj/file?path=readme.txt&base="+trunkStatus.DiffBase, &baseFile)
	if baseFile.Original != "v1\n" {
		t.Errorf("base diff original = %q, want %q — committed branch work must be visible", baseFile.Original, "v1\n")
	}
	if baseFile.Modified != "v3\n" {
		t.Errorf("base diff modified = %q, want %q", baseFile.Modified, "v3\n")
	}
}

func TestReadFileRejectsNonCommitBase(t *testing.T) {
	api := newGitStatusTestHandler(initRepo(t))

	req := httptest.NewRequest(http.MethodGet, "/api/projects/proj/file?path=readme.txt&base=main", nil)
	req.Header.Set("X-Project-Name", "proj")
	rec := httptest.NewRecorder()
	api.handleReadFile(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for a symbolic base: %s", rec.Code, rec.Body.String())
	}
}
