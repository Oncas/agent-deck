package server

import (
	"fmt"
	"io/fs"
	"net/http"
)

func newDevReloadHandler(staticFS fs.FS, enabled bool) func(w http.ResponseWriter, r *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		if !enabled {
			writeJSON(w, map[string]any{"enabled": false})
			return
		}

		stamp, err := staticReloadStamp(staticFS)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, map[string]any{
			"enabled": true,
			"stamp":   stamp,
		})
	}
}

func newStaticHandler(staticFS fs.FS, devMode bool) http.Handler {
	handler := http.FileServer(http.FS(staticFS))
	if !devMode {
		return handler
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		handler.ServeHTTP(w, r)
	})
}

func staticReloadStamp(staticFS fs.FS) (string, error) {
	var newest int64
	var files int
	var totalSize int64

	err := fs.WalkDir(staticFS, ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}

		info, err := entry.Info()
		if err != nil {
			return err
		}
		files++
		totalSize += info.Size()
		if mod := info.ModTime().UnixNano(); mod > newest {
			newest = mod
		}
		return nil
	})
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%d:%d:%d", newest, files, totalSize), nil
}
