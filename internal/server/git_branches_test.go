package server

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSplitRemoteRef(t *testing.T) {
	remotes := []string{"origin", "upstream"}
	tests := []struct {
		name       string
		ref        string
		wantShort  string
		wantRemote string
		wantIs     bool
	}{
		{"local simple", "main", "", "", false},
		{"local with slash", "feature/foo", "", "", false},
		{"origin branch", "origin/foo", "foo", "origin", true},
		{"upstream branch", "upstream/bar", "bar", "upstream", true},
		{"remote branch with slash", "origin/feature/foo", "feature/foo", "origin", true},
		{"remote name only", "origin", "", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			short, remote, is := splitRemoteRef(tt.ref, remotes)
			if short != tt.wantShort || remote != tt.wantRemote || is != tt.wantIs {
				t.Errorf("splitRemoteRef(%q) = (%q, %q, %v), want (%q, %q, %v)",
					tt.ref, short, remote, is, tt.wantShort, tt.wantRemote, tt.wantIs)
			}
		})
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func TestGitListBranchesIncludesRemotes(t *testing.T) {
	clone := newRemotePair(t)

	// Create a remote-only branch: push it, then drop the local copy.
	git(t, clone, "checkout", "-b", "remote-only")
	git(t, clone, "push", "-u", "origin", "remote-only")
	git(t, clone, "checkout", "main")
	git(t, clone, "branch", "-D", "remote-only")

	localBranches, _ := gitListBranches(clone)
	branches, current := gitListBranchesWithRemotes(clone)

	if current != "main" {
		t.Errorf("current = %q, want main", current)
	}
	if !contains(branches, "main") {
		t.Errorf("want local main in %v", branches)
	}
	if contains(localBranches, "origin/remote-only") {
		t.Errorf("local branch list should not include remote refs: %v", localBranches)
	}
	if !contains(branches, "origin/main") {
		t.Errorf("want origin/main in %v", branches)
	}
	if !contains(branches, "origin/remote-only") {
		t.Errorf("want origin/remote-only in %v", branches)
	}
	for _, b := range branches {
		if b == "origin/HEAD" {
			t.Errorf("origin/HEAD should be filtered out, got %v", branches)
		}
	}
}

func headBranch(t *testing.T, dir string) string {
	return strings.TrimSpace(git(t, dir, "rev-parse", "--abbrev-ref", "HEAD"))
}

func revParse(t *testing.T, dir, ref string) string {
	return strings.TrimSpace(git(t, dir, "rev-parse", ref))
}

// pushBranch creates branch foo from main, pushes it to origin, and returns to
// main so the branch exists both locally and as origin/foo, in sync.
func pushBranch(t *testing.T, clone, name string) {
	t.Helper()
	git(t, clone, "checkout", "-b", name)
	git(t, clone, "push", "-u", "origin", name)
	git(t, clone, "checkout", "main")
}

func TestGitCheckoutRemoteOnlyCreatesTrackingBranch(t *testing.T) {
	clone := newRemotePair(t)
	pushBranch(t, clone, "feat")
	git(t, clone, "branch", "-D", "feat") // now feat is remote-only

	res, err := gitCheckout(clone, "origin/feat", "")
	if err != nil {
		t.Fatalf("checkout failed: %v (%s)", err, res.Output)
	}
	if res.Conflict {
		t.Fatalf("unexpected conflict: %+v", res)
	}
	if got := headBranch(t, clone); got != "feat" {
		t.Errorf("HEAD = %q, want feat", got)
	}
}

func TestGitCheckoutRemoteOnlyTracksSelectedRemote(t *testing.T) {
	clone := newRemotePair(t)
	pushBranch(t, clone, "feat")
	git(t, clone, "branch", "-D", "feat") // feat is now remote-only on origin

	// Add a second remote that also carries a "feat" branch. A bare short-name
	// checkout would be ambiguous here and could resolve to the wrong remote.
	root := t.TempDir()
	remote2 := filepath.Join(root, "remote2.git")
	git(t, root, "init", "--bare", "-b", "main", remote2)
	git(t, clone, "remote", "add", "upstream", remote2)
	git(t, clone, "push", "upstream", "origin/feat:refs/heads/feat")
	git(t, clone, "fetch", "upstream")

	res, err := gitCheckout(clone, "origin/feat", "")
	if err != nil {
		t.Fatalf("checkout failed: %v (%s)", err, res.Output)
	}
	if got := headBranch(t, clone); got != "feat" {
		t.Errorf("HEAD = %q, want feat", got)
	}
	// The created branch must track exactly the selected remote, not upstream.
	up := strings.TrimSpace(git(t, clone, "rev-parse", "--abbrev-ref", "feat@{upstream}"))
	if up != "origin/feat" {
		t.Errorf("feat tracks %q, want origin/feat", up)
	}
}

func TestGitCheckoutRemoteInSyncSwitches(t *testing.T) {
	clone := newRemotePair(t)
	pushBranch(t, clone, "feat") // local feat == origin/feat

	res, err := gitCheckout(clone, "origin/feat", "")
	if err != nil {
		t.Fatalf("checkout failed: %v (%s)", err, res.Output)
	}
	if res.Conflict {
		t.Fatalf("unexpected conflict: %+v", res)
	}
	if got := headBranch(t, clone); got != "feat" {
		t.Errorf("HEAD = %q, want feat", got)
	}
}

func TestGitCheckoutRemoteDivergedReportsConflict(t *testing.T) {
	clone := newRemotePair(t)
	pushBranch(t, clone, "feat")
	// Add a local-only commit on feat so it diverges from origin/feat.
	git(t, clone, "checkout", "feat")
	if err := os.WriteFile(filepath.Join(clone, "extra.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, clone, "add", ".")
	git(t, clone, "commit", "-m", "local extra")
	git(t, clone, "checkout", "main")

	res, err := gitCheckout(clone, "origin/feat", "")
	if err != nil {
		t.Fatalf("checkout returned error: %v (%s)", err, res.Output)
	}
	if !res.Conflict {
		t.Fatalf("expected conflict, got %+v", res)
	}
	if res.Branch != "feat" || res.Remote != "origin/feat" {
		t.Errorf("conflict fields = (%q, %q), want (feat, origin/feat)", res.Branch, res.Remote)
	}
	if got := headBranch(t, clone); got != "main" {
		t.Errorf("HEAD = %q, want main (checkout must not switch on conflict)", got)
	}
}

func TestGitCheckoutActionLocalKeepsLocalCommits(t *testing.T) {
	clone := newRemotePair(t)
	pushBranch(t, clone, "feat")
	git(t, clone, "checkout", "feat")
	if err := os.WriteFile(filepath.Join(clone, "extra.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, clone, "add", ".")
	git(t, clone, "commit", "-m", "local extra")
	localTip := revParse(t, clone, "feat")
	git(t, clone, "checkout", "main")

	res, err := gitCheckout(clone, "origin/feat", "local")
	if err != nil {
		t.Fatalf("checkout failed: %v (%s)", err, res.Output)
	}
	if got := headBranch(t, clone); got != "feat" {
		t.Errorf("HEAD = %q, want feat", got)
	}
	if got := revParse(t, clone, "HEAD"); got != localTip {
		t.Errorf("tip = %q, want local tip %q (local commits must be kept)", got, localTip)
	}
}

func TestGitCheckoutActionResetRemoteResetsToRemoteTip(t *testing.T) {
	clone := newRemotePair(t)
	pushBranch(t, clone, "feat")
	remoteTip := revParse(t, clone, "origin/feat")
	git(t, clone, "checkout", "feat")
	if err := os.WriteFile(filepath.Join(clone, "extra.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, clone, "add", ".")
	git(t, clone, "commit", "-m", "local extra")
	git(t, clone, "checkout", "main")

	res, err := gitCheckout(clone, "origin/feat", "reset-remote")
	if err != nil {
		t.Fatalf("checkout failed: %v (%s)", err, res.Output)
	}
	if got := headBranch(t, clone); got != "feat" {
		t.Errorf("HEAD = %q, want feat", got)
	}
	if got := revParse(t, clone, "HEAD"); got != remoteTip {
		t.Errorf("tip = %q, want remote tip %q (must reset to remote)", got, remoteTip)
	}
}

func TestGitCheckoutLocalBranchUnchanged(t *testing.T) {
	clone := newRemotePair(t)
	pushBranch(t, clone, "feat") // local feat exists

	res, err := gitCheckout(clone, "feat", "")
	if err != nil {
		t.Fatalf("checkout failed: %v (%s)", err, res.Output)
	}
	if res.Conflict {
		t.Fatalf("local checkout must not conflict: %+v", res)
	}
	if got := headBranch(t, clone); got != "feat" {
		t.Errorf("HEAD = %q, want feat", got)
	}
}

// A local branch whose name collides with a "<remote>/" prefix (here literally
// "origin/foo" with an "origin" remote) must check out as the local branch the
// user picked, not be split into the short name "foo" and treated as remote.
func TestGitCheckoutLocalSlashBranchPreferredOverRemote(t *testing.T) {
	clone := newRemotePair(t)
	git(t, clone, "checkout", "-b", "origin/foo")
	git(t, clone, "checkout", "main")

	res, err := gitCheckout(clone, "origin/foo", "")
	if err != nil {
		t.Fatalf("checkout failed: %v (%s)", err, res.Output)
	}
	if res.Conflict {
		t.Fatalf("local slash branch must not conflict: %+v", res)
	}
	if got := headBranch(t, clone); got != "origin/foo" {
		t.Errorf("HEAD = %q, want origin/foo (local branch, not derived short name)", got)
	}
}

func TestGitFetchRetrievesNewRemoteBranch(t *testing.T) {
	clone := newRemotePair(t)
	remoteURL := strings.TrimSpace(git(t, clone, "remote", "get-url", "origin"))

	// A second actor clones the same remote and pushes a new branch.
	root := t.TempDir()
	clone2 := filepath.Join(root, "clone2")
	git(t, root, "clone", remoteURL, clone2)
	git(t, clone2, "checkout", "-b", "shared")
	git(t, clone2, "push", "-u", "origin", "shared")

	// Before fetch, clone does not know about origin/shared.
	if before, _ := gitListBranchesWithRemotes(clone); contains(before, "origin/shared") {
		t.Fatalf("origin/shared present before fetch: %v", before)
	}

	if _, err := gitFetch(clone); err != nil {
		t.Fatalf("gitFetch failed: %v", err)
	}

	after, _ := gitListBranchesWithRemotes(clone)
	if !contains(after, "origin/shared") {
		t.Errorf("origin/shared missing after fetch: %v", after)
	}
}

// --- test repo helpers ---

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v in %s failed: %v\n%s", args, dir, err, out)
	}
	return string(out)
}

// newRemotePair creates a bare "remote" repo and a clone of it, returning the
// clone path. The clone has an initial commit on main pushed to the remote.
func newRemotePair(t *testing.T) (clone string) {
	t.Helper()
	root := t.TempDir()
	remote := filepath.Join(root, "remote.git")
	git(t, root, "init", "--bare", "-b", "main", remote)

	clone = filepath.Join(root, "clone")
	git(t, root, "clone", remote, clone)
	git(t, clone, "config", "user.email", "test@example.com")
	git(t, clone, "config", "user.name", "Test")
	git(t, clone, "config", "commit.gpgsign", "false")
	if err := os.WriteFile(filepath.Join(clone, "f.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, clone, "add", ".")
	git(t, clone, "commit", "-m", "init")
	git(t, clone, "push", "-u", "origin", "main")
	return clone
}
