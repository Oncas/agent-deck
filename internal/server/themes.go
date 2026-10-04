package server

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"sort"
	"strings"
)

type themeDefinition struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Order    int               `json:"order,omitempty"`
	CSS      map[string]string `json:"css"`
	Terminal map[string]string `json:"terminal"`
	Monaco   map[string]any    `json:"monaco"`
}

func newThemesHandler(staticFS fs.FS) func(w http.ResponseWriter, r *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		themes, err := loadThemes(staticFS)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, themes)
	}
}

func loadThemes(staticFS fs.FS) ([]themeDefinition, error) {
	var themes []themeDefinition
	err := fs.WalkDir(staticFS, "themes", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || entry.Name() == "index.json" || !strings.HasSuffix(entry.Name(), ".json") {
			return nil
		}

		data, err := fs.ReadFile(staticFS, path)
		if err != nil {
			return err
		}

		var theme themeDefinition
		if err := json.Unmarshal(data, &theme); err != nil {
			return err
		}
		if err := validateTheme(theme); err != nil {
			return errors.New(path + ": " + err.Error())
		}
		themes = append(themes, theme)
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.SliceStable(themes, func(i, j int) bool {
		if themes[i].Order != themes[j].Order {
			return themes[i].Order < themes[j].Order
		}
		return themes[i].Name < themes[j].Name
	})
	return themes, nil
}

func validateTheme(theme themeDefinition) error {
	if !validThemeID(theme.ID) {
		return errors.New("theme id must use lowercase letters, numbers, dashes, or underscores")
	}
	if strings.TrimSpace(theme.Name) == "" {
		return errors.New("theme name is required")
	}
	if len(theme.CSS) == 0 {
		return errors.New("css colors are required")
	}
	if len(theme.Terminal) == 0 {
		return errors.New("terminal colors are required")
	}
	if len(theme.Monaco) == 0 {
		return errors.New("monaco theme is required")
	}
	return nil
}

func validThemeID(id string) bool {
	if id == "" {
		return false
	}
	for _, ch := range id {
		if ch >= 'a' && ch <= 'z' {
			continue
		}
		if ch >= '0' && ch <= '9' {
			continue
		}
		if ch == '-' || ch == '_' {
			continue
		}
		return false
	}
	return true
}
