package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadMigratesEnabledLegacyCustomDangerousCommand(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	data := `{
		"main_directory": "/workspace",
		"dangerous_permissions": {"custom": true, "claude": true},
		"cli_integrations": [{
			"id": "custom",
			"name": "Custom",
			"command": "custom-cli",
			"dangerous_command": "custom-cli --unsafe"
		}]
	}`
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := cfg.CLIIntegrations[0].Command; got != "custom-cli --unsafe" {
		t.Fatalf("migrated command = %q, want custom-cli --unsafe", got)
	}
	if len(cfg.ScanPaths) != 1 || cfg.ScanPaths[0] != "/workspace" {
		t.Fatalf("scan_paths = %v, want migrated main_directory", cfg.ScanPaths)
	}
	if cfg.DangerousPermissions["custom"] {
		t.Fatalf("custom dangerous permission was not removed")
	}
	if !cfg.DangerousPermissions["claude"] {
		t.Fatalf("built-in dangerous permission was removed")
	}
	if err := Save(path, cfg); err != nil {
		t.Fatalf("Save: %v", err)
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read saved config: %v", err)
	}
	if strings.Contains(string(saved), "dangerous_command") {
		t.Fatalf("saved config still contains legacy dangerous_command: %s", saved)
	}
	if strings.Contains(string(saved), "main_directory") {
		t.Fatalf("saved config still contains legacy main_directory: %s", saved)
	}
	if !strings.Contains(string(saved), `"scan_paths"`) {
		t.Fatalf("saved config does not contain scan_paths: %s", saved)
	}
}

func TestLoadPrefersScanPathsOverLegacyMainDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	data := `{
		"scan_paths": ["/workspace/one", "/workspace/two"],
		"main_directory": "/workspace/legacy"
	}`
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.ScanPaths) != 2 || cfg.ScanPaths[0] != "/workspace/one" || cfg.ScanPaths[1] != "/workspace/two" {
		t.Fatalf("scan_paths = %v, want explicit scan_paths", cfg.ScanPaths)
	}
}

func TestLoadPrefersExplicitEmptyScanPathsOverLegacyMainDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	data := `{
		"scan_paths": [],
		"main_directory": "/workspace/legacy"
	}`
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.ScanPaths) != 0 {
		t.Fatalf("scan_paths = %v, want explicit empty list", cfg.ScanPaths)
	}
}

func TestLoadDropsDisabledLegacyCustomDangerousCommand(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	data := `{
		"cli_integrations": [{
			"id": "custom",
			"name": "Custom",
			"command": "custom-cli",
			"dangerous_command": "custom-cli --unsafe"
		}]
	}`
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := cfg.CLIIntegrations[0].Command; got != "custom-cli" {
		t.Fatalf("migrated command = %q, want custom-cli", got)
	}
}
