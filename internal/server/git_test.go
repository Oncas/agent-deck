package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// mustGit runs a git command in dir and fails the test on error.
func mustGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := runGit(dir, args...)
	if err != nil {
		t.Fatalf("git %v failed: %v\n%s", args, err, out)
	}
	return out
}

// writeRepoFile writes content to name within the repo and stages+commits it.
func commitFile(t *testing.T, dir, name, content, message string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	mustGit(t, dir, "add", "--", name)
	mustGit(t, dir, "commit", "-m", message)
}

// initRepo creates a temp git repo with a single commit on the "main" branch.
func initRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	mustGit(t, dir, "-c", "init.defaultBranch=main", "init")
	mustGit(t, dir, "config", "user.email", "test@example.com")
	mustGit(t, dir, "config", "user.name", "Test")
	mustGit(t, dir, "config", "commit.gpgsign", "false")
	commitFile(t, dir, "readme.txt", "v1\n", "initial commit")
	return dir
}

func changedFileRevision(t *testing.T, dir, name string) string {
	t.Helper()
	for _, file := range getGitStatus(dir).Files {
		if file.Name == name {
			if file.Revision == "" {
				t.Fatalf("revision for %s is empty", name)
			}
			return file.Revision
		}
	}
	t.Fatalf("changed file %s not found", name)
	return ""
}

func TestGitMainBranch(t *testing.T) {
	t.Run("prefers main", func(t *testing.T) {
		dir := initRepo(t)
		if got := gitMainBranch(dir); got != "main" {
			t.Fatalf("gitMainBranch = %q, want %q", got, "main")
		}
	})

	t.Run("falls back to master", func(t *testing.T) {
		dir := initRepo(t)
		mustGit(t, dir, "branch", "-m", "main", "master")
		if got := gitMainBranch(dir); got != "master" {
			t.Fatalf("gitMainBranch = %q, want %q", got, "master")
		}
	})
}

func TestGetGitStatusAgainstTrunkIncludesCommittedWork(t *testing.T) {
	dir := initRepo(t)
	mustGit(t, dir, "checkout", "-b", "feature")
	commitFile(t, dir, "committed.txt", "one\ntwo\n", "committed branch work")
	if err := os.WriteFile(filepath.Join(dir, "dirty.txt"), []byte("dirty\n"), 0644); err != nil {
		t.Fatalf("write dirty.txt: %v", err)
	}

	headStatus := getGitStatus(dir)
	if len(headStatus.Files) != 1 || headStatus.Files[0].Name != "dirty.txt" {
		t.Fatalf("HEAD comparison files = %#v, want only dirty.txt", headStatus.Files)
	}
	if headStatus.DiffBase != "" {
		t.Errorf("HEAD comparison DiffBase = %q, want empty", headStatus.DiffBase)
	}
	if headStatus.TrunkBranch != "main" {
		t.Errorf("TrunkBranch = %q, want %q", headStatus.TrunkBranch, "main")
	}

	status := getGitStatusAgainstTrunk(dir)
	if !isGitCommitHash(status.DiffBase) {
		t.Fatalf("DiffBase = %q, want a commit hash", status.DiffBase)
	}
	want := []GitFile{
		{Status: "A", Name: "committed.txt"},
		{Status: "??", Name: "dirty.txt"},
	}
	if len(status.Files) != len(want) {
		t.Fatalf("files = %#v, want %#v", status.Files, want)
	}
	for i := range want {
		if status.Files[i] != want[i] {
			t.Errorf("files[%d] = %#v, want %#v", i, status.Files[i], want[i])
		}
	}
	if status.LinesAdded != 3 {
		t.Errorf("LinesAdded = %d, want 3", status.LinesAdded)
	}
}

func TestGetGitStatusAgainstTrunkExcludesTrunkOnlyCommits(t *testing.T) {
	dir := initRepo(t)
	mustGit(t, dir, "checkout", "-b", "feature")
	commitFile(t, dir, "mine.txt", "mine\n", "branch work")
	mustGit(t, dir, "checkout", "main")
	commitFile(t, dir, "theirs.txt", "theirs\n", "trunk moved on")
	mustGit(t, dir, "checkout", "feature")

	status := getGitStatusAgainstTrunk(dir)
	if len(status.Files) != 1 || status.Files[0].Name != "mine.txt" {
		t.Fatalf("files = %#v, want only mine.txt", status.Files)
	}
	if status.LinesDeleted != 0 {
		t.Errorf("LinesDeleted = %d, want 0 — trunk-only commits must not appear as deletions", status.LinesDeleted)
	}
}

func TestGetGitStatusAgainstTrunkFallsBackWithoutTrunk(t *testing.T) {
	dir := initRepo(t)
	mustGit(t, dir, "branch", "-m", "main", "wip")
	if err := os.WriteFile(filepath.Join(dir, "dirty.txt"), []byte("dirty\n"), 0644); err != nil {
		t.Fatalf("write dirty.txt: %v", err)
	}

	status := getGitStatusAgainstTrunk(dir)
	if status.TrunkBranch != "" {
		t.Errorf("TrunkBranch = %q, want empty", status.TrunkBranch)
	}
	if status.DiffBase != "" {
		t.Errorf("DiffBase = %q, want empty", status.DiffBase)
	}
	if len(status.Files) != 1 || status.Files[0].Name != "dirty.txt" || !status.Files[0].Revertible {
		t.Fatalf("files = %#v, want revertible dirty.txt from the HEAD comparison", status.Files)
	}
}

func TestGetGitStatusAgainstTrunkPrefersOriginWhenAhead(t *testing.T) {
	dir := initRepo(t)
	base := strings.TrimSpace(mustGit(t, dir, "rev-parse", "HEAD"))
	mustGit(t, dir, "checkout", "-b", "feature")
	commitFile(t, dir, "mine.txt", "mine\n", "feature work")
	featureTip := strings.TrimSpace(mustGit(t, dir, "rev-parse", "HEAD"))

	mustGit(t, dir, "update-ref", "refs/remotes/origin/main", base)

	mustGit(t, dir, "checkout", "main")
	commitFile(t, dir, "upstream.txt", "upstream\n", "upstream trunk work")
	upstreamTip := strings.TrimSpace(mustGit(t, dir, "rev-parse", "HEAD"))
	mustGit(t, dir, "update-ref", "refs/remotes/origin/main", upstreamTip)
	mustGit(t, dir, "reset", "--hard", base)

	mustGit(t, dir, "checkout", "feature")
	mustGit(t, dir, "reset", "--hard", featureTip)
	mustGit(t, dir, "merge", "--no-ff", "-m", "sync from origin/main", "refs/remotes/origin/main")

	status := getGitStatusAgainstTrunk(dir)
	if status.DiffBase != upstreamTip {
		t.Fatalf("DiffBase = %q, want origin/main tip %q — the pulled-in commits should stay out of the diff", status.DiffBase, upstreamTip)
	}
	if len(status.Files) != 1 || status.Files[0].Name != "mine.txt" {
		t.Fatalf("files = %#v, want only mine.txt — upstream.txt was pulled from origin/main and must not appear as branch work", status.Files)
	}
}

func TestGetGitStatusAgainstTrunkUsesLocalWhenOriginStale(t *testing.T) {
	dir := initRepo(t)
	base := strings.TrimSpace(mustGit(t, dir, "rev-parse", "HEAD"))
	mustGit(t, dir, "update-ref", "refs/remotes/origin/main", base)
	commitFile(t, dir, "local.txt", "local\n", "unpushed trunk work")
	localTip := strings.TrimSpace(mustGit(t, dir, "rev-parse", "HEAD"))

	mustGit(t, dir, "checkout", "-b", "feature")
	commitFile(t, dir, "mine.txt", "mine\n", "feature work")

	status := getGitStatusAgainstTrunk(dir)
	if status.DiffBase != localTip {
		t.Fatalf("DiffBase = %q, want local main tip %q — local main is ahead of origin/main, so its tip is the fork point", status.DiffBase, localTip)
	}
	if len(status.Files) != 1 || status.Files[0].Name != "mine.txt" {
		t.Fatalf("files = %#v, want only mine.txt — local.txt is in local main and must not appear as branch work", status.Files)
	}
}

func TestReadBaseBytesRejectsNonCommitBase(t *testing.T) {
	dir := initRepo(t)

	if _, ok := readBaseBytes(dir, "", "readme.txt"); !ok {
		t.Fatal("readBaseBytes with empty base failed, want HEAD content")
	}
	if _, ok := readBaseBytes(dir, "--upload-pack=touch /tmp/pwn", "readme.txt"); ok {
		t.Error("readBaseBytes accepted a non-hash base, want rejection")
	}
	if _, ok := readBaseBytes(dir, "HEAD", "readme.txt"); ok {
		t.Error("readBaseBytes accepted a symbolic base, want full-hash only")
	}
}

func TestGetGitStatusIncludesLineSummary(t *testing.T) {
	dir := initRepo(t)

	if err := os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("v2\nextra\n"), 0644); err != nil {
		t.Fatalf("write readme.txt: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "new.txt"), []byte("one\ntwo\n"), 0644); err != nil {
		t.Fatalf("write new.txt: %v", err)
	}

	status := getGitStatus(dir)
	if !status.IsGitRepo {
		t.Fatal("IsGitRepo = false, want true")
	}
	if len(status.Files) != 2 {
		t.Fatalf("changed files = %d, want 2: %#v", len(status.Files), status.Files)
	}
	if status.LinesAdded != 4 {
		t.Errorf("LinesAdded = %d, want 4", status.LinesAdded)
	}
	if status.LinesDeleted != 1 {
		t.Errorf("LinesDeleted = %d, want 1", status.LinesDeleted)
	}
}

func TestGitFileRevisionTracksDisplayedComparison(t *testing.T) {
	t.Run("tracked content and mode", func(t *testing.T) {
		dir := initRepo(t)
		path := filepath.Join(dir, "readme.txt")
		if err := os.WriteFile(path, []byte("v2\n"), 0644); err != nil {
			t.Fatalf("write tracked file: %v", err)
		}

		initial := changedFileRevision(t, dir, "readme.txt")
		if stable := changedFileRevision(t, dir, "readme.txt"); stable != initial {
			t.Fatalf("unchanged revision = %q, want %q", stable, initial)
		}

		mustGit(t, dir, "add", "--", "readme.txt")
		if staged := changedFileRevision(t, dir, "readme.txt"); staged != initial {
			t.Fatalf("staging-only revision = %q, want %q", staged, initial)
		}

		if err := os.WriteFile(path, []byte("v3\n"), 0644); err != nil {
			t.Fatalf("rewrite tracked file: %v", err)
		}
		contentChanged := changedFileRevision(t, dir, "readme.txt")
		if contentChanged == initial {
			t.Fatal("revision did not change with working content")
		}

		if err := os.Chmod(path, 0755); err != nil {
			t.Fatalf("chmod tracked file: %v", err)
		}
		if modeChanged := changedFileRevision(t, dir, "readme.txt"); modeChanged == contentChanged {
			t.Fatal("revision did not change with executable mode")
		}
	})

	t.Run("untracked content", func(t *testing.T) {
		dir := initRepo(t)
		path := filepath.Join(dir, "new.txt")
		if err := os.WriteFile(path, []byte("one\n"), 0644); err != nil {
			t.Fatalf("write untracked file: %v", err)
		}
		initial := changedFileRevision(t, dir, "new.txt")
		if err := os.WriteFile(path, []byte("two\n"), 0644); err != nil {
			t.Fatalf("rewrite untracked file: %v", err)
		}
		if changed := changedFileRevision(t, dir, "new.txt"); changed == initial {
			t.Fatal("revision did not change with untracked content")
		}
	})

	t.Run("deleted then recreated", func(t *testing.T) {
		dir := initRepo(t)
		path := filepath.Join(dir, "readme.txt")
		if err := os.Remove(path); err != nil {
			t.Fatalf("remove tracked file: %v", err)
		}
		deleted := changedFileRevision(t, dir, "readme.txt")
		if err := os.WriteFile(path, []byte("replacement\n"), 0644); err != nil {
			t.Fatalf("recreate tracked file: %v", err)
		}
		if recreated := changedFileRevision(t, dir, "readme.txt"); recreated == deleted {
			t.Fatal("revision did not change when deleted file was recreated")
		}
	})
}

func TestGetGitStatusSummaryOmitsFileRevisions(t *testing.T) {
	dir := initRepo(t)
	path := filepath.Join(dir, "readme.txt")
	if err := os.WriteFile(path, []byte("v2\n"), 0644); err != nil {
		t.Fatalf("write tracked file: %v", err)
	}

	cacheKey := gitWorkingHashCacheKey{ProjectPath: dir, Filename: "readme.txt"}
	gitWorkingHashCache.Delete(cacheKey)
	status := getGitStatusSummary(dir)
	if len(status.Files) != 1 {
		t.Fatalf("changed files = %d, want 1: %#v", len(status.Files), status.Files)
	}
	if status.Files[0].Revision != "" {
		t.Fatalf("summary revision = %q, want empty", status.Files[0].Revision)
	}
	if _, cached := gitWorkingHashCache.Load(cacheKey); cached {
		t.Fatal("summary status populated the working-file hash cache")
	}
}

func TestGitWorkingFileHashCapsLargeFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "large.bin")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create large file: %v", err)
	}
	if err := file.Truncate(maxGitRevisionHashFileSize + 1); err != nil {
		file.Close()
		t.Fatalf("truncate large file: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close large file: %v", err)
	}

	info, err := os.Lstat(path)
	if err != nil {
		t.Fatalf("stat large file: %v", err)
	}
	initial, ok := gitWorkingFileHash(path, info)
	if !ok {
		t.Fatal("large file hash unavailable")
	}
	if !strings.HasPrefix(initial, "metadata:") {
		t.Fatalf("large file hash = %q, want metadata fingerprint", initial)
	}

	changedTime := info.ModTime().Add(time.Second)
	if err := os.Chtimes(path, changedTime, changedTime); err != nil {
		t.Fatalf("change large file timestamp: %v", err)
	}
	changedInfo, err := os.Lstat(path)
	if err != nil {
		t.Fatalf("stat changed large file: %v", err)
	}
	changed, ok := gitWorkingFileHash(path, changedInfo)
	if !ok {
		t.Fatal("changed large file hash unavailable")
	}
	if changed == initial {
		t.Fatal("large file metadata fingerprint did not change")
	}
}

func TestWriteWorkingFileInvalidatesSameStatHashCache(t *testing.T) {
	dir := initRepo(t)
	path := filepath.Join(dir, "readme.txt")
	if err := os.WriteFile(path, []byte("v2\n"), 0644); err != nil {
		t.Fatalf("write initial change: %v", err)
	}
	initial := changedFileRevision(t, dir, "readme.txt")
	initialInfo, err := os.Lstat(path)
	if err != nil {
		t.Fatalf("stat initial change: %v", err)
	}

	if err := writeWorkingFile(dir, "readme.txt", "v3\n"); err != nil {
		t.Fatalf("write through application helper: %v", err)
	}
	if err := os.Chtimes(path, initialInfo.ModTime(), initialInfo.ModTime()); err != nil {
		t.Fatalf("restore file timestamp: %v", err)
	}
	matchingInfo, err := os.Lstat(path)
	if err != nil {
		t.Fatalf("stat rewritten file: %v", err)
	}
	if matchingInfo.Size() != initialInfo.Size() || !matchingInfo.ModTime().Equal(initialInfo.ModTime()) || matchingInfo.Mode() != initialInfo.Mode() {
		t.Fatal("rewritten file does not reproduce the cached stat metadata")
	}
	if changed := changedFileRevision(t, dir, "readme.txt"); changed == initial {
		t.Fatal("revision reused a stale hash after an application write")
	}
}

func TestGitWorkingSymlinkIdentityTracksDisplayedTarget(t *testing.T) {
	dir := t.TempDir()
	targetPath := filepath.Join(dir, "target.txt")
	if err := os.WriteFile(targetPath, []byte("one\n"), 0644); err != nil {
		t.Fatalf("write symlink target: %v", err)
	}
	if err := os.Symlink("target.txt", filepath.Join(dir, "link.txt")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	initial := gitWorkingFileIdentity(dir, "link.txt")
	if !initial.Exists || initial.Hash == "" {
		t.Fatalf("initial symlink identity unavailable: %#v", initial)
	}
	targetInfo, err := os.Lstat(targetPath)
	if err != nil {
		t.Fatalf("stat symlink target: %v", err)
	}

	if err := os.WriteFile(targetPath, []byte("two\n"), 0644); err != nil {
		t.Fatalf("rewrite symlink target: %v", err)
	}
	if err := os.Chtimes(targetPath, targetInfo.ModTime(), targetInfo.ModTime()); err != nil {
		t.Fatalf("restore symlink target timestamp: %v", err)
	}
	changed := gitWorkingFileIdentity(dir, "link.txt")
	if changed.Hash == initial.Hash {
		t.Fatal("symlink identity did not track its displayed target content")
	}
}

func TestGetGitStatusWithoutRepositoryIncludesProjectFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "nested"), 0755); err != nil {
		t.Fatalf("mkdir nested: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, ".git"), 0755); err != nil {
		t.Fatalf("mkdir .git: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "node_modules", "pkg"), 0755); err != nil {
		t.Fatalf("mkdir node_modules: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "vendor", "dep"), 0755); err != nil {
		t.Fatalf("mkdir vendor: %v", err)
	}
	for name, content := range map[string]string{
		".env":                    "",
		"nested/app.txt":          "one\ntwo",
		"root.txt":                "root\n",
		".git/internal-metadata":  "ignored\n",
		"node_modules/pkg/app.js": "ignored\n",
		"vendor/dep/app.go":       "ignored\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(name)), []byte(content), 0644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	status := getGitStatus(dir)
	if status.IsGitRepo {
		t.Fatal("IsGitRepo = true, want false")
	}
	want := []GitFile{
		{Status: "??", Name: ".env"},
		{Status: "??", Name: "nested/app.txt"},
		{Status: "??", Name: "root.txt"},
	}
	if len(status.Files) != len(want) {
		t.Fatalf("files = %#v, want %#v", status.Files, want)
	}
	for i := range want {
		if status.Files[i] != want[i] {
			t.Errorf("files[%d] = %#v, want %#v", i, status.Files[i], want[i])
		}
	}
	if status.Branch != "" {
		t.Errorf("Branch = %q, want empty", status.Branch)
	}
	if status.LinesAdded != 3 || status.LinesDeleted != 0 {
		t.Errorf("line summary = +%d -%d, want +3 -0", status.LinesAdded, status.LinesDeleted)
	}
	if count, isGitRepo := projectChangeCount(dir); count != 3 || isGitRepo {
		t.Errorf("projectChangeCount = (%d, %v), want (3, false)", count, isGitRepo)
	}
	if got := gitDiffFile(dir, "nested/app.txt"); got != "+++ new file\none\ntwo" {
		t.Errorf("gitDiffFile = %q, want new file contents", got)
	}
	if _, err := gitRevertFile(dir, "nested/app.txt", "??"); err == nil {
		t.Error("gitRevertFile removed a file outside a Git repository")
	}
	if _, err := gitRevertAll(dir); err == nil {
		t.Error("gitRevertAll succeeded outside a Git repository")
	}
	if _, err := os.Stat(filepath.Join(dir, "nested", "app.txt")); err != nil {
		t.Fatalf("non-Git file should remain after revert attempts: %v", err)
	}
}

func TestWorkingFileOperationsRejectPathTraversal(t *testing.T) {
	dir := initRepo(t)

	if err := writeWorkingFile(dir, "../outside.txt", "bad"); err == nil {
		t.Fatalf("writeWorkingFile accepted path traversal")
	}
	if _, ok := readWorkingBytes(dir, "../outside.txt"); ok {
		t.Fatalf("readWorkingBytes accepted path traversal")
	}
}

func TestWorkingFileOperationsRejectSymlinkEscape(t *testing.T) {
	dir := initRepo(t)
	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(outsideFile, []byte("secret\n"), 0644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}
	if err := os.Symlink(outsideFile, filepath.Join(dir, "link.txt")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	if err := writeWorkingFile(dir, "link.txt", "changed"); err == nil {
		t.Fatalf("writeWorkingFile accepted symlink escape")
	}
	if _, ok := readWorkingBytes(dir, "link.txt"); ok {
		t.Fatalf("readWorkingBytes accepted symlink escape")
	}
}

func TestParseGitBlamePorcelainKeepsBoundaryCommits(t *testing.T) {
	const commit = "1234567890abcdef1234567890abcdef12345678"
	out := "^" + commit + " 1 1 1\n" +
		"author Boundary Author\n" +
		"   \n" +
		"author-mail <boundary@example.com>\n" +
		"author-time 1700000000\n" +
		"summary initial import\n" +
		"boundary\n" +
		"filename app.go\n" +
		"\tpackage main\n"

	lines := parseGitBlamePorcelain(out)
	if len(lines) != 1 {
		t.Fatalf("len(lines) = %d, want 1: %#v", len(lines), lines)
	}
	if lines[0].Commit != commit {
		t.Fatalf("commit = %q, want %q", lines[0].Commit, commit)
	}
	if lines[0].ShortCommit != "12345678" || lines[0].Author != "Boundary Author" {
		t.Fatalf("boundary line parsed incorrectly: %#v", lines[0])
	}
}

func TestGitBlameFileIncludesCommittedAndWorkingLines(t *testing.T) {
	dir := initRepo(t)
	commitFile(t, dir, "app.go", "package main\n\nfunc main() {}\n", "add app")

	changed := "package main\n\nfunc run() {}\nfunc extra() {}\n"
	if err := os.WriteFile(filepath.Join(dir, "app.go"), []byte(changed), 0644); err != nil {
		t.Fatalf("write app.go: %v", err)
	}

	lines, err := gitBlameFile(dir, "app.go", "working")
	if err != nil {
		t.Fatalf("gitBlameFile failed: %v", err)
	}
	if len(lines) != 4 {
		t.Fatalf("len(lines) = %d, want 4: %#v", len(lines), lines)
	}
	if lines[0].Author != "Test" {
		t.Fatalf("first line author = %q, want Test", lines[0].Author)
	}
	if lines[0].Commit == "" || lines[0].ShortCommit == "uncommitted" {
		t.Fatalf("first line commit not parsed: %#v", lines[0])
	}
	if lines[3].Commit != "0000000000000000000000000000000000000000" {
		t.Fatalf("new line commit = %q, want zero hash", lines[3].Commit)
	}
	if lines[3].ShortCommit != "uncommitted" || lines[3].Author != "Not Committed Yet" {
		t.Fatalf("new line blame = %#v, want uncommitted author", lines[3])
	}
}

func TestGitBlameFileUsesHeadForDeletedWorkingFile(t *testing.T) {
	dir := initRepo(t)
	commitFile(t, dir, "gone.txt", "one\ntwo\n", "add gone")
	if err := os.Remove(filepath.Join(dir, "gone.txt")); err != nil {
		t.Fatalf("remove gone.txt: %v", err)
	}

	lines, err := gitBlameFile(dir, "gone.txt", "head")
	if err != nil {
		t.Fatalf("gitBlameFile head failed: %v", err)
	}
	if len(lines) != 2 {
		t.Fatalf("len(lines) = %d, want 2: %#v", len(lines), lines)
	}
	if lines[0].Author != "Test" || lines[0].Line != 1 || lines[0].OriginalLine != 1 {
		t.Fatalf("head blame line = %#v", lines[0])
	}
}

func TestGitBlameFileSynthesizesUntrackedFile(t *testing.T) {
	dir := initRepo(t)
	if err := os.WriteFile(filepath.Join(dir, "new.txt"), []byte("one\ntwo"), 0644); err != nil {
		t.Fatalf("write new.txt: %v", err)
	}

	lines, err := gitBlameFile(dir, "new.txt", "working")
	if err != nil {
		t.Fatalf("gitBlameFile untracked failed: %v", err)
	}
	if len(lines) != 2 {
		t.Fatalf("len(lines) = %d, want 2: %#v", len(lines), lines)
	}
	for _, line := range lines {
		if line.ShortCommit != "uncommitted" || line.Author != "Not Committed Yet" || line.Summary != "Untracked file" {
			t.Fatalf("untracked blame line = %#v", line)
		}
	}
}

func TestGitBlameFileDoesNotSynthesizeTrackedBlameFailure(t *testing.T) {
	dir := initRepo(t)
	commitFile(t, dir, "tracked.txt", "one\ntwo\n", "add tracked")
	commit := strings.TrimSpace(mustGit(t, dir, "rev-parse", "HEAD"))
	objectPath := filepath.Join(dir, ".git", "objects", commit[:2], commit[2:])
	if err := os.Remove(objectPath); err != nil {
		if os.IsNotExist(err) {
			t.Skipf("commit object is not loose: %v", err)
		}
		t.Fatalf("remove commit object: %v", err)
	}

	lines, err := gitBlameFile(dir, "tracked.txt", "working")
	if err == nil {
		t.Fatalf("gitBlameFile returned nil error and lines %#v, want git blame error", lines)
	}
	if strings.Contains(err.Error(), "Untracked file") {
		t.Fatalf("gitBlameFile error = %q, should not synthesize untracked blame", err)
	}
	if !strings.Contains(err.Error(), "no such commit") {
		t.Fatalf("gitBlameFile error = %q, want original blame failure", err)
	}
}

func TestGitBlameFileRejectsTraversal(t *testing.T) {
	dir := initRepo(t)
	_, err := gitBlameFile(dir, "../secret.txt", "working")
	if err == nil || !strings.Contains(err.Error(), "path traversal denied") {
		t.Fatalf("gitBlameFile traversal error = %v, want path traversal denied", err)
	}
}

func TestGitRevertFileRefusesUntrackedDirectory(t *testing.T) {
	dir := initRepo(t)
	if err := os.Mkdir(filepath.Join(dir, "untracked-dir"), 0755); err != nil {
		t.Fatalf("mkdir untracked-dir: %v", err)
	}

	if _, err := gitRevertFile(dir, "untracked-dir", "??"); err == nil {
		t.Fatalf("gitRevertFile removed an untracked directory")
	}
	if _, err := os.Stat(filepath.Join(dir, "untracked-dir")); err != nil {
		t.Fatalf("untracked directory should remain: %v", err)
	}
}

func TestGitRevertDirectoryRestoresOnlySelectedDirectory(t *testing.T) {
	dir := initRepo(t)
	if err := os.MkdirAll(filepath.Join(dir, "nested"), 0755); err != nil {
		t.Fatalf("mkdir nested: %v", err)
	}
	commitFile(t, dir, "nested/tracked.txt", "nested original\n", "add nested file")
	commitFile(t, dir, "outside.txt", "outside original\n", "add outside file")

	if err := os.WriteFile(filepath.Join(dir, "nested", "tracked.txt"), []byte("nested changed\n"), 0644); err != nil {
		t.Fatalf("modify nested tracked file: %v", err)
	}
	mustGit(t, dir, "add", "--", "nested/tracked.txt")
	if err := os.WriteFile(filepath.Join(dir, "nested", "staged.txt"), []byte("staged\n"), 0644); err != nil {
		t.Fatalf("write nested staged file: %v", err)
	}
	mustGit(t, dir, "add", "--", "nested/staged.txt")
	if err := os.MkdirAll(filepath.Join(dir, "nested", "untracked"), 0755); err != nil {
		t.Fatalf("mkdir nested untracked directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "nested", "untracked", "new.txt"), []byte("new\n"), 0644); err != nil {
		t.Fatalf("write nested untracked file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "outside.txt"), []byte("outside changed\n"), 0644); err != nil {
		t.Fatalf("modify outside file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "outside-new.txt"), []byte("outside new\n"), 0644); err != nil {
		t.Fatalf("write outside untracked file: %v", err)
	}

	if _, err := gitRevertDirectory(dir, "nested"); err != nil {
		t.Fatalf("gitRevertDirectory failed: %v", err)
	}
	content, err := os.ReadFile(filepath.Join(dir, "nested", "tracked.txt"))
	if err != nil {
		t.Fatalf("read restored nested file: %v", err)
	}
	if string(content) != "nested original\n" {
		t.Errorf("nested tracked content = %q, want original", content)
	}
	for _, name := range []string{"nested/staged.txt", "nested/untracked"} {
		if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(name))); !os.IsNotExist(err) {
			t.Errorf("%s still exists after directory revert: %v", name, err)
		}
	}
	for name, want := range map[string]string{
		"outside.txt":     "outside changed\n",
		"outside-new.txt": "outside new\n",
	} {
		content, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("read preserved %s: %v", name, err)
		}
		if string(content) != want {
			t.Errorf("%s content = %q, want %q", name, content, want)
		}
	}
}

func TestGitRevertDirectoryRejectsTraversal(t *testing.T) {
	dir := initRepo(t)
	if _, err := gitRevertDirectory(dir, "../outside"); err == nil || !strings.Contains(err.Error(), "path traversal denied") {
		t.Fatalf("gitRevertDirectory traversal error = %v, want path traversal denied", err)
	}
}

func TestGitMergedBranches(t *testing.T) {
	dir := initRepo(t)

	// ancestry-merged branch (fast-forward merge into main)
	mustGit(t, dir, "checkout", "-b", "ancestry")
	commitFile(t, dir, "a.txt", "a\n", "add a")
	mustGit(t, dir, "checkout", "main")
	mustGit(t, dir, "merge", "ancestry")

	// squash-merged branch (changes land in main as a single new commit)
	mustGit(t, dir, "checkout", "-b", "squashed")
	commitFile(t, dir, "s.txt", "s\n", "add s")
	mustGit(t, dir, "checkout", "main")
	mustGit(t, dir, "merge", "--squash", "squashed")
	mustGit(t, dir, "commit", "-m", "squash s")

	// divergent branch with real unmerged work
	mustGit(t, dir, "checkout", "-b", "divergent")
	commitFile(t, dir, "d.txt", "d\n", "add d")

	// ancestry-merged branch that is also the current HEAD
	mustGit(t, dir, "checkout", "main")
	mustGit(t, dir, "checkout", "-b", "currentmerged")
	commitFile(t, dir, "c.txt", "c\n", "add c")
	mustGit(t, dir, "checkout", "main")
	mustGit(t, dir, "merge", "currentmerged")
	mustGit(t, dir, "checkout", "currentmerged")

	got := gitMergedBranches(dir)
	gotReasons := map[string]string{}
	for _, b := range got {
		gotReasons[b.Name] = b.Reason
	}

	want := map[string]string{
		"ancestry": "merged",
		"squashed": "squashed",
	}
	if len(gotReasons) != len(want) {
		t.Fatalf("got %v, want %v", gotReasons, want)
	}
	for name, reason := range want {
		if gotReasons[name] != reason {
			t.Errorf("branch %q reason = %q, want %q", name, gotReasons[name], reason)
		}
	}
	// Exclusions
	for _, excluded := range []string{"main", "divergent", "currentmerged"} {
		if _, ok := gotReasons[excluded]; ok {
			t.Errorf("branch %q should be excluded but was reported", excluded)
		}
	}
}

func TestGitDeleteBranches(t *testing.T) {
	dir := initRepo(t)
	mustGit(t, dir, "branch", "feature-a")
	mustGit(t, dir, "branch", "feature-b")

	results := gitDeleteBranches(dir, []string{"feature-a", "does-not-exist"})

	byName := map[string]string{}
	for _, r := range results {
		byName[r.Branch] = r.Error
	}
	if _, ok := byName["feature-a"]; !ok {
		t.Fatalf("feature-a missing from results: %v", results)
	}
	if byName["feature-a"] != "" {
		t.Errorf("feature-a delete error = %q, want empty", byName["feature-a"])
	}
	if byName["does-not-exist"] == "" {
		t.Errorf("does-not-exist should report an error")
	}

	// feature-a removed, feature-b untouched
	branches, _ := gitListBranches(dir)
	set := map[string]bool{}
	for _, b := range branches {
		set[b] = true
	}
	if set["feature-a"] {
		t.Errorf("feature-a should have been deleted")
	}
	if !set["feature-b"] {
		t.Errorf("feature-b should still exist")
	}
}

// TestGitDeleteBranchesRefusesUnmerged ensures the delete path re-verifies the
// merged set server-side: an arbitrary request cannot force-delete unmerged
// work or trunk refs even though -D would otherwise succeed.
func TestGitDeleteBranchesRefusesUnmerged(t *testing.T) {
	dir := initRepo(t)

	// branch with real unmerged work
	mustGit(t, dir, "checkout", "-b", "divergent")
	commitFile(t, dir, "d.txt", "d\n", "add d")
	mustGit(t, dir, "checkout", "main")

	results := gitDeleteBranches(dir, []string{"divergent", "main"})
	byName := map[string]string{}
	for _, r := range results {
		byName[r.Branch] = r.Error
	}
	if byName["divergent"] == "" {
		t.Errorf("divergent (unmerged) should be refused, got no error")
	}
	if byName["main"] == "" {
		t.Errorf("main (trunk) should be refused, got no error")
	}

	branches, _ := gitListBranches(dir)
	set := map[string]bool{}
	for _, b := range branches {
		set[b] = true
	}
	if !set["divergent"] {
		t.Errorf("divergent should NOT have been deleted")
	}
	if !set["main"] {
		t.Errorf("main should NOT have been deleted")
	}
}

func TestGetGitStatusKeepsPathsWithSpacesUnquoted(t *testing.T) {
	dir := initRepo(t)
	commitFile(t, dir, "tracked file.txt", "v1\n", "add spaced file")
	if err := os.WriteFile(filepath.Join(dir, "tracked file.txt"), []byte("v2\n"), 0644); err != nil {
		t.Fatalf("write tracked file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "untracked file.txt"), []byte("new\n"), 0644); err != nil {
		t.Fatalf("write untracked file: %v", err)
	}
	mustGit(t, dir, "mv", "readme.txt", "renamed readme.txt")

	names := map[string]string{}
	for _, file := range getGitStatus(dir).Files {
		names[file.Name] = file.Status
	}

	for _, name := range []string{"tracked file.txt", "untracked file.txt", "renamed readme.txt"} {
		if _, ok := names[name]; !ok {
			t.Fatalf("expected unquoted %q in status, got %v", name, names)
		}
	}
	if _, ok := names["readme.txt"]; ok {
		t.Fatalf("rename source should not be listed: %v", names)
	}
}

func TestGetGitStatusAgainstTrunkKeepsPathsWithSpacesUnquoted(t *testing.T) {
	dir := initRepo(t)
	mustGit(t, dir, "checkout", "-b", "feature")
	commitFile(t, dir, "committed file.txt", "v1\n", "committed spaced file")
	if err := os.WriteFile(filepath.Join(dir, "untracked file.txt"), []byte("new\n"), 0644); err != nil {
		t.Fatalf("write untracked file: %v", err)
	}
	mustGit(t, dir, "mv", "readme.txt", "renamed readme.txt")
	mustGit(t, dir, "commit", "-m", "rename readme")

	names := map[string]string{}
	for _, file := range getGitStatusWithOptions(dir, gitStatusOptions{againstTrunk: true}).Files {
		names[file.Name] = file.Status
	}

	for _, name := range []string{"committed file.txt", "untracked file.txt", "renamed readme.txt"} {
		if _, ok := names[name]; !ok {
			t.Fatalf("expected unquoted %q in trunk status, got %v", name, names)
		}
	}
}
