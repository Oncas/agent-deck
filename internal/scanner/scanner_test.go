package scanner

import (
	"os"
	"path/filepath"
	"testing"
)

func mkRepo(t *testing.T, path string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(path, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}

	return path
}

func mkDir(t *testing.T, path string) string {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}

	return path
}

func mkLink(t *testing.T, target, link string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
}

func names(projects []Project) []string {
	out := make([]string, len(projects))
	for i, p := range projects {
		out[i] = p.Name
	}

	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}

	return true
}

func TestScanNamesNestedReposByRelativePath(t *testing.T) {
	root := t.TempDir()
	mkRepo(t, filepath.Join(root, "services", "acme", "web-frontend"))
	mkRepo(t, filepath.Join(root, "shared", "dev-tools"))

	got, err := Scan([]string{root}, nil)
	if err != nil {
		t.Fatal(err)
	}

	want := []string{"services/acme/web-frontend", "shared/dev-tools"}
	if !equal(names(got), want) {
		t.Fatalf("names = %v, want %v", names(got), want)
	}
}

func TestScanExcludesRootRepoButFindsChildren(t *testing.T) {
	root := mkRepo(t, t.TempDir())
	mkRepo(t, filepath.Join(root, "services", "admin"))

	got, err := Scan([]string{root}, nil)
	if err != nil {
		t.Fatal(err)
	}

	if !equal(names(got), []string{"services/admin"}) {
		t.Fatalf("names = %v, want [services/admin]", names(got))
	}
}

func TestScanFollowsSymlinkedRepo(t *testing.T) {
	target := mkRepo(t, filepath.Join(t.TempDir(), "web-frontend"))
	root := t.TempDir()
	mkLink(t, target, filepath.Join(root, "services", "acme", "web-frontend"))

	got, err := Scan([]string{root}, nil)
	if err != nil {
		t.Fatal(err)
	}

	if len(got) != 1 {
		t.Fatalf("got %d projects, want 1: %v", len(got), names(got))
	}
	if got[0].Name != "services/acme/web-frontend" {
		t.Errorf("Name = %q, want services/acme/web-frontend", got[0].Name)
	}
	resolved, err := filepath.EvalSymlinks(target)
	if err != nil {
		t.Fatal(err)
	}
	if got[0].Path != resolved {
		t.Errorf("Path = %q, want resolved target %q", got[0].Path, resolved)
	}
}

func TestScanFollowsSymlinkedDirectory(t *testing.T) {
	target := t.TempDir()
	project := mkRepo(t, filepath.Join(target, "services", "admin"))
	root := t.TempDir()
	mkLink(t, target, filepath.Join(root, "linked-workspace"))

	got, err := Scan([]string{root}, nil)
	if err != nil {
		t.Fatal(err)
	}

	if len(got) != 1 {
		t.Fatalf("got %d projects, want 1: %v", len(got), names(got))
	}
	if got[0].Name != "linked-workspace/services/admin" {
		t.Errorf("Name = %q, want linked-workspace/services/admin", got[0].Name)
	}
	resolvedProject, err := filepath.EvalSymlinks(project)
	if err != nil {
		t.Fatal(err)
	}
	if got[0].Path != resolvedProject {
		t.Errorf("Path = %q, want resolved target %q", got[0].Path, resolvedProject)
	}
}

func TestScanStopsAtSymlinkCycles(t *testing.T) {
	root := t.TempDir()
	project := mkRepo(t, filepath.Join(root, "project"))
	mkLink(t, root, filepath.Join(root, "loop"))

	got, err := Scan([]string{root}, nil)
	if err != nil {
		t.Fatal(err)
	}

	resolvedProject, err := filepath.EvalSymlinks(project)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Name != "project" || got[0].Path != resolvedProject {
		t.Fatalf("projects = %#v, want project discovered once", got)
	}
}

func TestScanDoesNotEnterRepoThroughSymlinkedSubdirectory(t *testing.T) {
	root := t.TempDir()
	repo := mkRepo(t, filepath.Join(root, "repo"))
	linkedSubdir := mkDir(t, filepath.Join(repo, "src"))
	mkRepo(t, filepath.Join(linkedSubdir, "nested"))
	// The alias sorts before repo, so leaf semantics cannot depend on seeing
	// the repository's real path first.
	mkLink(t, linkedSubdir, filepath.Join(root, "alias"))

	got, err := Scan([]string{root}, nil)
	if err != nil {
		t.Fatal(err)
	}

	if !equal(names(got), []string{"repo"}) {
		t.Fatalf("names = %v, want [repo]", names(got))
	}
}

func TestScanFollowsExternalRepoNestedInsideAnotherRepo(t *testing.T) {
	outer := mkRepo(t, filepath.Join(t.TempDir(), "outer"))
	target := mkRepo(t, filepath.Join(outer, "nested"))
	root := t.TempDir()
	mkLink(t, target, filepath.Join(root, "nested"))

	got, err := Scan([]string{root}, nil)
	if err != nil {
		t.Fatal(err)
	}

	resolvedTarget, err := filepath.EvalSymlinks(target)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Name != "nested" || got[0].Path != resolvedTarget {
		t.Fatalf("projects = %#v, want external nested repo", got)
	}
}

func TestScanReadsPackageJSONThroughSymlink(t *testing.T) {
	target := mkRepo(t, filepath.Join(t.TempDir(), "web"))
	if err := os.WriteFile(filepath.Join(target, "package.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	mkLink(t, target, filepath.Join(root, "web"))

	got, err := Scan([]string{root}, nil)
	if err != nil {
		t.Fatal(err)
	}

	if len(got) != 1 || !got[0].HasPackageJSON {
		t.Fatalf("HasPackageJSON not detected through symlink: %+v", got)
	}
}

func TestScanIgnoresBrokenAndNonRepoSymlinks(t *testing.T) {
	other := t.TempDir()
	plainDir := mkDir(t, filepath.Join(other, "not-a-repo"))
	root := t.TempDir()
	mkLink(t, plainDir, filepath.Join(root, "not-a-repo"))
	mkLink(t, filepath.Join(other, "gone"), filepath.Join(root, "broken"))

	got, err := Scan([]string{root}, nil)
	if err != nil {
		t.Fatal(err)
	}

	if len(got) != 0 {
		t.Fatalf("got %v, want no projects", names(got))
	}
}

func TestScanDeduplicatesRepoReachableTwice(t *testing.T) {
	root := t.TempDir()
	target := mkRepo(t, filepath.Join(root, "real", "admin"))
	mkLink(t, target, filepath.Join(root, "tree", "admin"))

	got, err := Scan([]string{root}, nil)
	if err != nil {
		t.Fatal(err)
	}

	if len(got) != 1 {
		t.Fatalf("got %d projects, want 1: %v", len(got), names(got))
	}
}

func TestScanSkipsVendorAndNodeModules(t *testing.T) {
	root := t.TempDir()
	mkRepo(t, filepath.Join(root, "app"))
	mkRepo(t, filepath.Join(root, "node_modules", "dep"))
	mkRepo(t, filepath.Join(root, "vendor", "pkg"))
	mkRepo(t, filepath.Join(root, ".cache", "hidden"))

	got, err := Scan([]string{root}, nil)
	if err != nil {
		t.Fatal(err)
	}

	if !equal(names(got), []string{"app"}) {
		t.Fatalf("names = %v, want [app]", names(got))
	}
}

func TestScanAddsExtraProjectsByBaseName(t *testing.T) {
	extra := mkRepo(t, filepath.Join(t.TempDir(), "dev-tools"))

	got, err := Scan(nil, []string{extra})
	if err != nil {
		t.Fatal(err)
	}

	if !equal(names(got), []string{"dev-tools"}) {
		t.Fatalf("names = %v, want [dev-tools]", names(got))
	}
	if got[0].FromScanPath {
		t.Errorf("FromScanPath = true, want false")
	}
}

func TestScanMultipleRoots(t *testing.T) {
	rootA := t.TempDir()
	rootB := t.TempDir()
	projectA := makeProject(t, rootA, "group/project-a")
	projectB := makeProject(t, rootB, "project-b")

	projects, err := Scan([]string{rootA, rootB}, nil)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(projects) != 2 {
		t.Fatalf("projects = %#v, want two projects", projects)
	}
	if projects[0].Name != "group/project-a" || projects[0].Path != projectA || !projects[0].FromScanPath {
		t.Fatalf("first project = %#v, want group/project-a from scan", projects[0])
	}
	if projects[1].Name != "project-b" || projects[1].Path != projectB || !projects[1].FromScanPath {
		t.Fatalf("second project = %#v, want project-b from scan", projects[1])
	}
}

func TestScanFirstRootWinsDuplicateProjectName(t *testing.T) {
	rootA := t.TempDir()
	rootB := t.TempDir()
	first := makeProject(t, rootA, "same-name")
	makeProject(t, rootB, "same-name")

	projects, err := Scan([]string{rootA, rootB}, nil)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(projects) != 1 || projects[0].Path != first {
		t.Fatalf("projects = %#v, want first root's project", projects)
	}
}

func TestScanDeduplicatesOverlappingRootsByPath(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "group")
	project := makeProject(t, nested, "project")

	projects, err := Scan([]string{root, nested}, nil)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(projects) != 1 || projects[0].Path != project || projects[0].Name != "group/project" {
		t.Fatalf("projects = %#v, want project named relative to first root", projects)
	}
}

func TestScanWalksSymlinkRootBeforeRealRoot(t *testing.T) {
	realRoot := t.TempDir()
	project := mkRepo(t, filepath.Join(realRoot, "project"))
	linkRoot := filepath.Join(t.TempDir(), "linked-root")
	mkLink(t, realRoot, linkRoot)

	projects, err := Scan([]string{linkRoot, realRoot}, nil)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(projects) != 1 || projects[0].Name != "project" || projects[0].Path != project {
		t.Fatalf("projects = %#v, want project discovered through symlink root", projects)
	}
}

func TestScanPreservesGitDirectoryRequirement(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "worktree")
	if err := os.MkdirAll(project, 0755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	if err := os.WriteFile(filepath.Join(project, ".git"), []byte("gitdir: elsewhere"), 0644); err != nil {
		t.Fatalf("write .git file: %v", err)
	}

	projects, err := Scan([]string{root}, nil)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(projects) != 0 {
		t.Fatalf("projects = %#v, want .git file ignored", projects)
	}
}

func makeProject(t *testing.T, root, relativePath string) string {
	t.Helper()
	path := filepath.Join(root, relativePath)
	if err := os.MkdirAll(filepath.Join(path, ".git"), 0755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	return path
}
