package server

import (
	"encoding/json"
	"testing"
	"testing/fstest"
)

func TestLoadThemesSortsThemeFiles(t *testing.T) {
	fs := fstest.MapFS{
		"themes/index.json": {Data: []byte(`["a.json","z.json"]`)},
		"themes/z.json":     {Data: testThemeJSON(t, "z_theme", "Z Theme", 30)},
		"themes/a.json":     {Data: testThemeJSON(t, "a_theme", "A Theme", 10)},
	}

	themes, err := loadThemes(fs)
	if err != nil {
		t.Fatalf("loadThemes: %v", err)
	}
	if len(themes) != 2 {
		t.Fatalf("themes length = %d, want 2", len(themes))
	}
	if themes[0].ID != "a_theme" || themes[1].ID != "z_theme" {
		t.Fatalf("theme order = %v, want a_theme then z_theme", []string{themes[0].ID, themes[1].ID})
	}
}

func TestLoadThemesRejectsInvalidThemeID(t *testing.T) {
	fs := fstest.MapFS{
		"themes/bad.json": {Data: testThemeJSON(t, "Bad Theme", "Bad Theme", 10)},
	}

	if _, err := loadThemes(fs); err == nil {
		t.Fatal("loadThemes error = nil, want invalid id error")
	}
}

func testThemeJSON(t *testing.T, id, name string, order int) []byte {
	t.Helper()
	data, err := json.Marshal(map[string]any{
		"id":    id,
		"name":  name,
		"order": order,
		"css": map[string]string{
			"--bg":   "#000000",
			"--text": "#ffffff",
		},
		"terminal": map[string]string{
			"background": "#000000",
			"foreground": "#ffffff",
		},
		"monaco": map[string]any{
			"base":    "vs-dark",
			"inherit": true,
			"rules":   []any{},
			"colors": map[string]string{
				"editor.background": "#000000",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return data
}
