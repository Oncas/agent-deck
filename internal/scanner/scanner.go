package scanner

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var skipDirs = map[string]bool{
	"vendor":       true,
	"node_modules": true,
}

type Project struct {
	Name           string
	Path           string
	HasPackageJSON bool
	FromScanPath   bool
}

func Scan(roots []string, extraPaths []string) ([]Project, error) {
	seenPaths := make(map[string]bool)
	seenNames := make(map[string]bool)
	seenRoots := make(map[string]bool)
	var projects []Project

	add := func(name, path string, fromScanPath bool) {
		abs, err := filepath.Abs(path)
		if err != nil {
			return
		}
		if resolved, err := filepath.EvalSymlinks(abs); err == nil {
			abs = resolved
		}
		if seenPaths[abs] || seenNames[name] {
			return
		}
		seenPaths[abs] = true
		seenNames[name] = true
		projects = append(projects, Project{
			Name:           name,
			Path:           abs,
			HasPackageJSON: hasFile(abs, "package.json"),
			FromScanPath:   fromScanPath,
		})
	}

	// Scan each configured directory tree in order. The first root wins when
	// roots overlap or produce the same project name.
	for _, root := range roots {
		if root == "" {
			continue
		}
		rootPath, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		if resolved, err := filepath.EvalSymlinks(rootPath); err == nil {
			rootPath = resolved
		}
		if seenRoots[rootPath] {
			continue
		}
		seenRoots[rootPath] = true
		walkRoot(rootPath, func(path, resolvedPath string) {
			add(relName(rootPath, path), resolvedPath, true)
		})
	}

	// Add extra individual project paths
	for _, p := range extraPaths {
		info, err := os.Stat(p)
		if err != nil || !info.IsDir() {
			continue
		}
		add(filepath.Base(p), p, false)
	}

	sort.Slice(projects, func(i, j int) bool {
		return strings.ToLower(projects[i].Name) < strings.ToLower(projects[j].Name)
	})

	return projects, nil
}

func walkRoot(rootPath string, add func(path, resolvedPath string)) {
	seenDirs := make(map[string]bool)

	var walk func(string, bool, bool)
	walk = func(path string, isRoot, viaSymlink bool) {
		resolvedPath, err := filepath.EvalSymlinks(path)
		if err != nil {
			return
		}
		if viaSymlink && hasRepoAncestorUnderRoot(resolvedPath, rootPath) {
			return
		}
		info, err := os.Stat(resolvedPath)
		if err != nil || !info.IsDir() || seenDirs[resolvedPath] {
			return
		}
		seenDirs[resolvedPath] = true

		if !isRoot && isRepo(resolvedPath) {
			add(path, resolvedPath)
			return
		}

		entries, err := os.ReadDir(resolvedPath)
		if err != nil {
			return
		}
		for _, entry := range entries {
			name := entry.Name()
			if strings.HasPrefix(name, ".") || skipDirs[name] {
				continue
			}

			childPath := filepath.Join(path, name)
			if entry.IsDir() {
				walk(childPath, false, false)
				continue
			}
			if entry.Type()&fs.ModeSymlink == 0 {
				continue
			}
			target, err := os.Stat(childPath)
			if err == nil && target.IsDir() {
				walk(childPath, false, true)
			}
		}
	}

	walk(rootPath, true, false)
}

func hasRepoAncestorUnderRoot(path, rootPath string) bool {
	for dir := filepath.Dir(path); ; dir = filepath.Dir(dir) {
		if isRepo(dir) {
			return dir != rootPath && containsPath(rootPath, dir)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return false
		}
	}
}

func containsPath(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func relName(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." {
		abs, _ := filepath.Abs(path)
		return filepath.Base(abs)
	}

	return rel
}

func isRepo(dir string) bool {
	fi, err := os.Stat(filepath.Join(dir, ".git"))

	return err == nil && fi.IsDir()
}

func hasFile(dir, name string) bool {
	_, err := os.Stat(filepath.Join(dir, name))
	return err == nil
}
