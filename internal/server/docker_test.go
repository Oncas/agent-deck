package server

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"agentdeck/internal/scanner"
)

func TestResolveDockerProjectsFindsRepositoryComposeFiles(t *testing.T) {
	root := t.TempDir()
	composeProject := filepath.Join(root, "compose-project")
	legacyProject := filepath.Join(root, "legacy-project")
	noComposeProject := filepath.Join(root, "no-compose-project")

	for _, path := range []string{composeProject, legacyProject, noComposeProject} {
		if err := os.MkdirAll(path, 0755); err != nil {
			t.Fatalf("mkdir %s: %v", path, err)
		}
	}
	if err := os.WriteFile(filepath.Join(composeProject, "compose.yaml"), []byte("services: {}\n"), 0644); err != nil {
		t.Fatalf("write compose.yaml: %v", err)
	}
	if err := os.WriteFile(filepath.Join(legacyProject, "docker-compose.yml"), []byte("services: {}\n"), 0644); err != nil {
		t.Fatalf("write docker-compose.yml: %v", err)
	}

	got := resolveDockerProjects([]projectDockerInfo{
		{Name: "compose", Path: composeProject},
		{Name: "legacy", Path: legacyProject},
		{Name: "none", Path: noComposeProject},
	})
	want := map[string]string{
		"compose": "compose.yaml",
		"legacy":  "docker-compose.yml",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("resolveDockerProjects() = %#v, want %#v", got, want)
	}
}

func TestProjectComposeFileUsesDockerComposePrecedence(t *testing.T) {
	projectPath := t.TempDir()
	for _, name := range []string{"compose.yml", "compose.yaml"} {
		if err := os.WriteFile(filepath.Join(projectPath, name), []byte("services: {}\n"), 0644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	if got := projectComposeFile(projectPath); got != "compose.yaml" {
		t.Fatalf("projectComposeFile() = %q, want %q", got, "compose.yaml")
	}
}

func TestResolveDockerProjectsIgnoresParentComposeFile(t *testing.T) {
	parentPath := t.TempDir()
	projectPath := filepath.Join(parentPath, "project")
	if err := os.MkdirAll(projectPath, 0755); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	if err := os.WriteFile(filepath.Join(parentPath, "compose.yaml"), []byte("services: {}\n"), 0644); err != nil {
		t.Fatalf("write parent compose.yaml: %v", err)
	}

	got := resolveDockerProjects([]projectDockerInfo{{Name: "project", Path: projectPath}})
	if len(got) != 0 {
		t.Fatalf("resolveDockerProjects() = %#v, want parent Compose file ignored", got)
	}
}

func TestResolveDockerIncludesExtraProjects(t *testing.T) {
	projectPath := t.TempDir()
	if err := os.WriteFile(filepath.Join(projectPath, "compose.yaml"), []byte("services: {}\n"), 0644); err != nil {
		t.Fatalf("write compose.yaml: %v", err)
	}

	api := &apiHandler{
		projects: []scanner.Project{{
			Name:         "extra",
			Path:         projectPath,
			FromScanPath: false,
		}},
	}
	api.resolveDocker()

	if got := api.dockerComposeFiles["extra"]; got != "compose.yaml" {
		t.Fatalf("extra project compose file = %q, want %q", got, "compose.yaml")
	}
}

func TestDockerComposeUpCommandStartsWholeProjectStack(t *testing.T) {
	projectPath := t.TempDir()
	cmd := dockerComposeUpCommand(projectPath)

	if got, want := cmd.Args[1:], []string{"compose", "up"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("docker compose args = %v, want %v", got, want)
	}
	if cmd.Dir != projectPath {
		t.Fatalf("docker compose dir = %q, want %q", cmd.Dir, projectPath)
	}
}

func TestDockerCommandFallsBackToInteractiveShellPATH(t *testing.T) {
	resetShellEnvPathCache(t)

	toolDir := t.TempDir()
	dockerPath := writeExecutableAt(t, toolDir, "docker", "#!/bin/sh\n")
	shellPath := writeExecutable(t, "shell", "#!/bin/sh\nprintf 'shell startup noise\\nPATH=%s\\n' \"$SHELL_PATH\"\n")

	t.Setenv("PATH", t.TempDir())
	t.Setenv("SHELL", shellPath)
	t.Setenv("SHELL_PATH", toolDir)

	cmd := dockerCommand("compose", "ps")
	if cmd.Path != dockerPath {
		t.Fatalf("docker path = %q, want %q", cmd.Path, dockerPath)
	}
	if got := commandEnvValue(cmd.Env, "PATH"); got != toolDir {
		t.Fatalf("child PATH = %q, want %q", got, toolDir)
	}
	if count := commandEnvCount(cmd.Env, "PATH"); count != 1 {
		t.Fatalf("child env has %d PATH entries, want 1", count)
	}
}

func TestDockerCommandPrefersProcessPATH(t *testing.T) {
	resetShellEnvPathCache(t)

	toolDir := t.TempDir()
	dockerPath := writeExecutableAt(t, toolDir, "docker", "#!/bin/sh\n")

	t.Setenv("PATH", toolDir)
	// A shell probe here would be both slow and wrong: the process PATH
	// already resolves docker, so the fallback must not run.
	t.Setenv("SHELL", filepath.Join(t.TempDir(), "shell-must-not-run"))

	cmd := dockerCommand("compose", "ps")
	if cmd.Path != dockerPath {
		t.Fatalf("docker path = %q, want %q", cmd.Path, dockerPath)
	}
	if cmd.Env != nil {
		t.Fatalf("child env = %v, want inherited (nil)", cmd.Env)
	}
}

func TestDockerCommandKeepsBareNameWhenUnresolvable(t *testing.T) {
	resetShellEnvPathCache(t)

	t.Setenv("PATH", t.TempDir())
	t.Setenv("SHELL", filepath.Join(t.TempDir(), "missing-shell"))

	cmd := dockerCommand("compose", "ps")
	if cmd.Args[0] != "docker" {
		t.Fatalf("docker argv[0] = %q, want %q", cmd.Args[0], "docker")
	}
}

func TestDockerDependencyUsesInteractiveShellPATH(t *testing.T) {
	resetShellEnvPathCache(t)

	toolDir := t.TempDir()
	dockerPath := writeExecutableAt(t, toolDir, "docker", "#!/bin/sh\n")
	shellPath := writeExecutable(t, "shell", "#!/bin/sh\nprintf 'PATH=%s\\n' \"$SHELL_PATH\"\n")

	t.Setenv("PATH", t.TempDir())
	t.Setenv("SHELL", shellPath)
	t.Setenv("SHELL_PATH", toolDir)

	got := dockerDependency()
	if !got.Available {
		t.Fatalf("docker dependency reported unavailable: %+v", got)
	}
	if got.Path != dockerPath {
		t.Fatalf("docker dependency path = %q, want %q", got.Path, dockerPath)
	}
}

func commandEnvValue(env []string, key string) string {
	value := ""
	for _, entry := range env {
		if name, v, ok := strings.Cut(entry, "="); ok && name == key {
			value = v
		}
	}
	return value
}

func commandEnvCount(env []string, key string) int {
	count := 0
	for _, entry := range env {
		if name, _, ok := strings.Cut(entry, "="); ok && name == key {
			count++
		}
	}
	return count
}

func TestDockerManagerStartRunsComposeUpFromProject(t *testing.T) {
	projectPath := t.TempDir()
	toolDir := t.TempDir()
	capturePath := filepath.Join(t.TempDir(), "docker-command")
	dockerPath := filepath.Join(toolDir, "docker")
	script := strings.Join([]string{
		"#!/bin/sh",
		"if [ \"$2\" = \"down\" ] || [ \"$2\" = \"ps\" ]; then exit 0; fi",
		"printf '%s\\n' \"$PWD\" \"$@\" > \"$DOCKER_CAPTURE\"",
		"trap 'exit 0' TERM INT",
		"while :; do sleep 1; done",
		"",
	}, "\n")
	if err := os.WriteFile(dockerPath, []byte(script), 0755); err != nil {
		t.Fatalf("write fake docker: %v", err)
	}
	t.Setenv("DOCKER_CAPTURE", capturePath)
	t.Setenv("PATH", toolDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	manager := newDockerManager()
	if err := manager.Start(projectPath); err != nil {
		t.Fatalf("start Docker stack: %v", err)
	}
	t.Cleanup(func() {
		manager.Stop(projectPath)
		waitForDockerState(t, manager, projectPath, false)
	})

	deadline := time.Now().Add(2 * time.Second)
	for {
		data, err := os.ReadFile(capturePath)
		if err == nil {
			got := strings.Split(strings.TrimSpace(string(data)), "\n")
			want := []string{projectPath, "compose", "up"}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("fake docker received %v, want %v", got, want)
			}
			break
		}
		if !os.IsNotExist(err) {
			t.Fatalf("read fake docker capture: %v", err)
		}
		if time.Now().After(deadline) {
			t.Fatal("fake docker command did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// Reproduces a desktop launch: the app process PATH lacks docker, only the
// login shell knows where it lives. Start must still run compose up.
func TestDockerManagerStartResolvesDockerFromShellPATH(t *testing.T) {
	resetShellEnvPathCache(t)

	projectPath := t.TempDir()
	toolDir := t.TempDir()
	capturePath := filepath.Join(t.TempDir(), "docker-command")
	script := strings.Join([]string{
		"#!/bin/sh",
		"if [ \"$2\" = \"down\" ] || [ \"$2\" = \"ps\" ]; then exit 0; fi",
		"printf '%s\\n' \"$PWD\" \"$@\" > \"$DOCKER_CAPTURE\"",
		"trap 'exit 0' TERM INT",
		"while :; do sleep 1; done",
		"",
	}, "\n")
	writeExecutableAt(t, toolDir, "docker", script)
	shellPath := writeExecutable(t, "shell", "#!/bin/sh\nprintf 'PATH=%s\\n' \"$SHELL_PATH\"\n")

	t.Setenv("DOCKER_CAPTURE", capturePath)
	t.Setenv("PATH", t.TempDir())
	t.Setenv("SHELL", shellPath)
	t.Setenv("SHELL_PATH", toolDir)

	manager := newDockerManager()
	if err := manager.Start(projectPath); err != nil {
		t.Fatalf("start Docker stack: %v", err)
	}
	t.Cleanup(func() {
		manager.Stop(projectPath)
		waitForDockerState(t, manager, projectPath, false)
	})

	deadline := time.Now().Add(2 * time.Second)
	for {
		data, err := os.ReadFile(capturePath)
		if err == nil {
			got := strings.Split(strings.TrimSpace(string(data)), "\n")
			want := []string{projectPath, "compose", "up"}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("fake docker received %v, want %v", got, want)
			}
			break
		}
		if !os.IsNotExist(err) {
			t.Fatalf("read fake docker capture: %v", err)
		}
		if time.Now().After(deadline) {
			t.Fatal("fake docker command did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestDockerManagerStopRunsComposeDownWithoutTrackedProcess(t *testing.T) {
	projectPath := t.TempDir()
	toolDir := t.TempDir()
	capturePath := filepath.Join(t.TempDir(), "docker-command")
	dockerPath := filepath.Join(toolDir, "docker")
	script := "#!/bin/sh\nprintf '%s\\n' \"$PWD\" \"$@\" > \"$DOCKER_CAPTURE\"\n"
	if err := os.WriteFile(dockerPath, []byte(script), 0755); err != nil {
		t.Fatalf("write fake docker: %v", err)
	}
	t.Setenv("DOCKER_CAPTURE", capturePath)
	t.Setenv("PATH", toolDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	manager := newDockerManager()
	if err := manager.Stop(projectPath); err != nil {
		t.Fatalf("stop Docker stack: %v", err)
	}

	data, err := os.ReadFile(capturePath)
	if err != nil {
		t.Fatalf("read fake docker capture: %v", err)
	}
	got := strings.Split(strings.TrimSpace(string(data)), "\n")
	want := []string{projectPath, "compose", "down"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("fake docker received %v, want %v", got, want)
	}
}

func TestDockerManagerStatusUsesComposeStateWithoutTrackedProcess(t *testing.T) {
	projectPath := t.TempDir()
	toolDir := t.TempDir()
	dockerPath := filepath.Join(toolDir, "docker")
	script := "#!/bin/sh\nif [ \"$2\" = \"ps\" ]; then printf 'container-id\\n'; fi\n"
	if err := os.WriteFile(dockerPath, []byte(script), 0755); err != nil {
		t.Fatalf("write fake docker: %v", err)
	}
	t.Setenv("PATH", toolDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	running, output := newDockerManager().GetStatus(projectPath)
	if !running {
		t.Fatal("GetStatus() reported an externally running Compose stack as stopped")
	}
	if output != "" {
		t.Fatalf("GetStatus() output = %q, want empty output", output)
	}
}

func TestDockerManagerRestartDoesNotBlockOtherProjectStatus(t *testing.T) {
	projectPath := t.TempDir()
	otherProjectPath := t.TempDir()
	toolDir := t.TempDir()
	startedPath := filepath.Join(t.TempDir(), "started")
	stoppingPath := filepath.Join(t.TempDir(), "stopping")
	dockerPath := filepath.Join(toolDir, "docker")
	script := strings.Join([]string{
		"#!/bin/sh",
		"if [ \"$2\" = \"down\" ] || [ \"$2\" = \"ps\" ]; then exit 0; fi",
		"touch \"$DOCKER_STARTED\"",
		"trap 'touch \"$DOCKER_STOPPING\"; sleep 1; exit 0' TERM INT",
		"while :; do sleep 1; done",
		"",
	}, "\n")
	if err := os.WriteFile(dockerPath, []byte(script), 0755); err != nil {
		t.Fatalf("write fake docker: %v", err)
	}
	t.Setenv("DOCKER_STARTED", startedPath)
	t.Setenv("DOCKER_STOPPING", stoppingPath)
	t.Setenv("PATH", toolDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	manager := newDockerManager()
	if err := manager.Start(projectPath); err != nil {
		t.Fatalf("start Docker stack: %v", err)
	}
	t.Cleanup(func() {
		_ = manager.Stop(projectPath)
	})
	waitForFile(t, startedPath)

	restartDone := make(chan error, 1)
	go func() {
		restartDone <- manager.Start(projectPath)
	}()
	waitForFile(t, stoppingPath)

	statusDone := make(chan struct{})
	go func() {
		manager.GetStatus(otherProjectPath)
		close(statusDone)
	}()
	select {
	case <-statusDone:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("GetStatus() for another project blocked during stack teardown")
	}

	select {
	case err := <-restartDone:
		if err != nil {
			t.Fatalf("restart Docker stack: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Docker stack restart did not finish")
	}
}

func waitForDockerState(t *testing.T, manager *dockerManager, projectPath string, wantRunning bool) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for {
		running, _ := manager.GetStatus(projectPath)
		if running == wantRunning {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("Docker running state = %t, want %t", running, wantRunning)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func waitForFile(t *testing.T, path string) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Stat(path); err == nil {
			return
		} else if !os.IsNotExist(err) {
			t.Fatalf("stat %s: %v", path, err)
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", path)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
