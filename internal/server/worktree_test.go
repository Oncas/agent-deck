package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGitAddWorktreeCreatesNewBranchFromStartPoint(t *testing.T) {
	dir := initRepo(t)
	mustGit(t, dir, "checkout", "-b", "base")
	commitFile(t, dir, "base.txt", "base\n", "base commit")
	baseTip := revParse(t, dir, "HEAD")
	mustGit(t, dir, "checkout", "main")

	wt, err := gitAddWorktree(dir, "feature/from-base", true, "base")
	if err != nil {
		t.Fatalf("gitAddWorktree failed: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(wt.Path) })

	if wt.Name != "feature-from-base" {
		t.Fatalf("worktree name = %q, want feature-from-base", wt.Name)
	}
	if got := headBranch(t, wt.Path); got != "feature/from-base" {
		t.Fatalf("worktree HEAD branch = %q, want feature/from-base", got)
	}
	if got := revParse(t, wt.Path, "HEAD"); got != baseTip {
		t.Fatalf("worktree HEAD = %q, want base tip %q", got, baseTip)
	}
	if _, err := os.Stat(filepath.Join(wt.Path, "base.txt")); err != nil {
		t.Fatalf("base file missing from worktree: %v", err)
	}
}

func TestGitAddWorktreeCreatesNewBranchFromRemoteStartPoint(t *testing.T) {
	clone := newRemotePair(t)
	pushBranch(t, clone, "remote-base")
	git(t, clone, "branch", "-D", "remote-base")
	remoteTip := revParse(t, clone, "origin/remote-base")

	wt, err := gitAddWorktree(clone, "work/from-remote", true, "origin/remote-base")
	if err != nil {
		t.Fatalf("gitAddWorktree failed: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(wt.Path) })

	if got := headBranch(t, wt.Path); got != "work/from-remote" {
		t.Fatalf("worktree HEAD branch = %q, want work/from-remote", got)
	}
	if got := revParse(t, wt.Path, "HEAD"); got != remoteTip {
		t.Fatalf("worktree HEAD = %q, want remote tip %q", got, remoteTip)
	}
}

func TestGitAddWorktreeRemoteOnlyBranchCreatesTrackingBranch(t *testing.T) {
	clone := newRemotePair(t)
	pushBranch(t, clone, "feat")
	git(t, clone, "branch", "-D", "feat")

	wt, err := gitAddWorktree(clone, "origin/feat", false, "")
	if err != nil {
		t.Fatalf("gitAddWorktree failed: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(wt.Path) })

	if wt.Name != "feat" {
		t.Fatalf("worktree name = %q, want feat", wt.Name)
	}
	if wt.Branch != "feat" {
		t.Fatalf("worktree branch = %q, want feat", wt.Branch)
	}
	if got := headBranch(t, wt.Path); got != "feat" {
		t.Fatalf("worktree HEAD branch = %q, want feat", got)
	}
	upstream := strings.TrimSpace(git(t, wt.Path, "rev-parse", "--abbrev-ref", "@{upstream}"))
	if upstream != "origin/feat" {
		t.Fatalf("worktree upstream = %q, want origin/feat", upstream)
	}
}

func TestGitRemoveWorktreeWithDeletedBranch(t *testing.T) {
	dir := initRepo(t)
	wt, err := gitAddWorktree(dir, "deleted-branch", true, "")
	if err != nil {
		t.Fatalf("gitAddWorktree failed: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(wt.Path) })

	mustGit(t, dir, "update-ref", "-d", "refs/heads/deleted-branch")

	if err := gitRemoveWorktree(dir, wt.Path, true, wt.Branch); err != nil {
		t.Fatalf("gitRemoveWorktree failed: %v", err)
	}
	if _, err := os.Stat(wt.Path); !os.IsNotExist(err) {
		t.Fatalf("worktree path still exists after removal: %v", err)
	}
}

func TestGitRemoveWorktreeWithDeletedBranchProtectsChanges(t *testing.T) {
	dir := initRepo(t)
	wt, err := gitAddWorktree(dir, "deleted-dirty-branch", true, "")
	if err != nil {
		t.Fatalf("gitAddWorktree failed: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(wt.Path) })

	if err := os.WriteFile(filepath.Join(wt.Path, "untracked.txt"), []byte("keep me\n"), 0o644); err != nil {
		t.Fatalf("write untracked file: %v", err)
	}
	mustGit(t, dir, "update-ref", "-d", "refs/heads/deleted-dirty-branch")

	if err := gitRemoveWorktree(dir, wt.Path, false, wt.Branch); err == nil {
		t.Fatal("gitRemoveWorktree succeeded despite untracked file")
	}
	if _, err := os.Stat(filepath.Join(wt.Path, "untracked.txt")); err != nil {
		t.Fatalf("untracked file was not preserved: %v", err)
	}
}

func TestGitRemoveWorktreeWhenDirectoryDeleted(t *testing.T) {
	dir := initRepo(t)
	wt, err := gitAddWorktree(dir, "vanished", true, "")
	if err != nil {
		t.Fatalf("gitAddWorktree failed: %v", err)
	}

	if err := os.RemoveAll(wt.Path); err != nil {
		t.Fatalf("removing worktree directory: %v", err)
	}
	mustGit(t, dir, "update-ref", "-d", "refs/heads/vanished")

	if err := gitRemoveWorktree(dir, wt.Path, true, wt.Branch); err != nil {
		t.Fatalf("gitRemoveWorktree failed: %v", err)
	}
	if listed := findWorktreeByName(dir, wt.Name); listed != nil {
		t.Fatalf("worktree still registered after removal: %+v", listed)
	}
}

func TestGitRemoveWorktreeWhenDirectoryDeletedDeletesBranch(t *testing.T) {
	dir := initRepo(t)
	wt, err := gitAddWorktree(dir, "vanished-with-branch", true, "")
	if err != nil {
		t.Fatalf("gitAddWorktree failed: %v", err)
	}

	if err := os.RemoveAll(wt.Path); err != nil {
		t.Fatalf("removing worktree directory: %v", err)
	}

	if err := gitRemoveWorktree(dir, wt.Path, true, wt.Branch); err != nil {
		t.Fatalf("gitRemoveWorktree failed: %v", err)
	}
	if listed := findWorktreeByName(dir, wt.Name); listed != nil {
		t.Fatalf("worktree still registered after removal: %+v", listed)
	}
	if localBranchExists(dir, wt.Branch) {
		t.Fatalf("branch %q still exists after removal", wt.Branch)
	}
}

func TestResolveWorktreeGitPath(t *testing.T) {
	wtPath := filepath.Join(string(filepath.Separator), "projects", "worktree")
	absPath := filepath.Join(string(filepath.Separator), "git", "logs", "HEAD")

	if got := resolveWorktreeGitPath(wtPath, " .git/logs/HEAD\n"); got != filepath.Join(wtPath, ".git", "logs", "HEAD") {
		t.Fatalf("relative path resolved to %q", got)
	}
	if got := resolveWorktreeGitPath(wtPath, absPath+"\n"); got != absPath {
		t.Fatalf("absolute path changed to %q", got)
	}
}
