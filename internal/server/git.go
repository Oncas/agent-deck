package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"hash"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxGitRevisionHashFileSize = 8 << 20
)

type GitStatus struct {
	Branch       string    `json:"branch"`
	Ahead        int       `json:"ahead"`
	Behind       int       `json:"behind"`
	Files        []GitFile `json:"files"`
	LinesAdded   int       `json:"lines_added"`
	LinesDeleted int       `json:"lines_deleted"`
	IsGitRepo    bool      `json:"is_git_repo"`
	TrunkBranch  string    `json:"trunk_branch,omitempty"`
	DiffBase     string    `json:"diff_base,omitempty"`
}

type GitFile struct {
	Status     string `json:"status"`
	Name       string `json:"name"`
	Revertible bool   `json:"revertible"`
	Revision   string `json:"revision,omitempty"`
}

type gitFileIdentity struct {
	Exists bool
	Mode   string
	Hash   string
}

type gitStatusOptions struct {
	includeFileRevisions bool
	// againstTrunk diffs the working tree against the trunk fork point instead
	// of HEAD, so committed branch work is listed alongside uncommitted edits.
	againstTrunk bool
}

type gitWorkingHashCacheKey struct {
	ProjectPath string
	Filename    string
}

type gitWorkingHashCacheEntry struct {
	Size         int64
	ModifiedNano int64
	Mode         fs.FileMode
	Hash         string
}

var gitWorkingHashCache sync.Map

type GitBlameLine struct {
	Line         int    `json:"line"`
	OriginalLine int    `json:"original_line"`
	Commit       string `json:"commit"`
	ShortCommit  string `json:"short_commit"`
	Author       string `json:"author"`
	AuthorEmail  string `json:"author_email,omitempty"`
	AuthorTime   int64  `json:"author_time,omitempty"`
	Summary      string `json:"summary,omitempty"`
}

// getGitStatus reports the working tree against HEAD: uncommitted changes only.
func getGitStatus(projectPath string) GitStatus {
	return getGitStatusWithOptions(projectPath, gitStatusOptions{includeFileRevisions: true})
}

func getGitStatusSummary(projectPath string) GitStatus {
	return getGitStatusWithOptions(projectPath, gitStatusOptions{})
}

// getGitStatusAgainstTrunk reports the working tree against the trunk fork
// point, so committed branch work shows up alongside uncommitted edits. Falls
// back to the HEAD comparison when there is no local trunk to fork from.
func getGitStatusAgainstTrunk(projectPath string) GitStatus {
	return getGitStatusWithOptions(projectPath, gitStatusOptions{includeFileRevisions: true, againstTrunk: true})
}

func getGitStatusWithOptions(projectPath string, options gitStatusOptions) GitStatus {
	result := GitStatus{IsGitRepo: isGitWorkTree(projectPath)}
	if !result.IsGitRepo {
		result.Files = nonGitProjectFiles(projectPath)
		for _, file := range result.Files {
			result.LinesAdded += countWorkingFileLines(projectPath, file.Name)
		}
		return result
	}

	if out, err := runGit(projectPath, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		result.Branch = strings.TrimSpace(out)
	}

	if out, err := runGit(projectPath, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"); err == nil {
		parts := strings.Fields(strings.TrimSpace(out))
		if len(parts) == 2 {
			result.Ahead, _ = strconv.Atoi(parts[0])
			result.Behind, _ = strconv.Atoi(parts[1])
		}
	}

	result.TrunkBranch = gitMainBranch(projectPath)
	if options.againstTrunk {
		result.DiffBase = gitTrunkForkPoint(projectPath, result.TrunkBranch)
	}

	if result.DiffBase != "" {
		result.Files = gitFilesChangedSince(projectPath, result.DiffBase)
		result.LinesAdded, result.LinesDeleted = gitLineStatsSince(projectPath, result.DiffBase, result.Files)
		return result
	}

	if out, err := runGit(projectPath, "status", "--porcelain", "-uall", "-z"); err == nil {
		result.Files = append(result.Files, parseGitStatusRecords(out)...)
	}

	if options.includeFileRevisions {
		headIdentities := gitHeadFileIdentities(projectPath, result.Files)
		for i := range result.Files {
			result.Files[i].Revision = gitFileRevision(projectPath, result.Files[i].Name, headIdentities[result.Files[i].Name])
		}
		pruneGitWorkingHashCache(projectPath, result.Files)
	}

	result.LinesAdded, result.LinesDeleted = gitLineStats(projectPath, result.Files)

	return result
}

// parseGitStatusRecords reads NUL-terminated `git status --porcelain -z`
// records. The -z form is what keeps pathnames raw: default porcelain output
// wraps any name holding a space or non-ASCII byte in C-style quotes, and those
// quotes travel on as part of the filename, so the file can no longer be opened.
//
// Rename and copy entries spend two records — the new path, then the original.
// The original is consumed and dropped so the panel lists where the file landed.
func parseGitStatusRecords(out string) []GitFile {
	var files []GitFile
	records := strings.Split(out, "\x00")
	for i := 0; i < len(records); i++ {
		record := records[i]
		if len(record) < 4 {
			continue
		}
		if record[0] == 'R' || record[0] == 'C' {
			i++
		}
		status := strings.TrimSpace(record[:2])
		files = append(files, GitFile{Status: status, Name: record[3:], Revertible: true})
	}
	return files
}

func gitHeadFileIdentities(projectPath string, files []GitFile) map[string]gitFileIdentity {
	identities := make(map[string]gitFileIdentity, len(files))
	if len(files) == 0 {
		return identities
	}

	args := []string{"ls-tree", "-z", "HEAD", "--"}
	for _, file := range files {
		rel, err := cleanProjectRelPath(file.Name)
		if err != nil {
			continue
		}
		args = append(args, ":(literal)"+filepath.ToSlash(rel))
	}
	if len(args) == 4 {
		return identities
	}

	out, err := runGit(projectPath, args...)
	if err != nil {
		return identities
	}
	for _, record := range strings.Split(out, "\x00") {
		metadata, name, ok := strings.Cut(record, "\t")
		if !ok {
			continue
		}
		fields := strings.Fields(metadata)
		if len(fields) != 3 {
			continue
		}
		identities[name] = gitFileIdentity{Exists: true, Mode: fields[0], Hash: fields[2]}
	}
	return identities
}

func gitFileRevision(projectPath, filename string, head gitFileIdentity) string {
	working := gitWorkingFileIdentity(projectPath, filename)
	digest := sha256.New()
	writeGitFileIdentity(digest, "head", head)
	writeGitFileIdentity(digest, "working", working)
	return fmt.Sprintf("%x", digest.Sum(nil))
}

func gitWorkingFileIdentity(projectPath, filename string) gitFileIdentity {
	cacheKey := gitWorkingHashCacheKey{ProjectPath: projectPath, Filename: filename}
	path, err := projectFilePath(projectPath, filename)
	if err != nil {
		gitWorkingHashCache.Delete(cacheKey)
		return gitFileIdentity{}
	}
	info, err := os.Lstat(path)
	if err != nil {
		gitWorkingHashCache.Delete(cacheKey)
		return gitFileIdentity{}
	}
	if info.Mode()&os.ModeSymlink != 0 {
		// Diff loading follows in-project symlinks, so revision hashing must do
		// the same. Symlinks bypass the metadata cache because their target can
		// change without changing the link's own stat information.
		gitWorkingHashCache.Delete(cacheKey)
		workingHash, ok := gitWorkingFileHash(path, info)
		if !ok {
			return gitFileIdentity{}
		}
		return gitFileIdentity{Exists: true, Mode: gitModeForFileInfo(info), Hash: workingHash}
	}
	if cached, ok := gitWorkingHashCache.Load(cacheKey); ok {
		entry := cached.(gitWorkingHashCacheEntry)
		if entry.Size == info.Size() && entry.ModifiedNano == info.ModTime().UnixNano() && entry.Mode == info.Mode() {
			return gitFileIdentity{Exists: true, Mode: gitModeForFileInfo(info), Hash: entry.Hash}
		}
	}

	workingHash, ok := gitWorkingFileHash(path, info)
	if !ok {
		gitWorkingHashCache.Delete(cacheKey)
		return gitFileIdentity{}
	}
	gitWorkingHashCache.Store(cacheKey, gitWorkingHashCacheEntry{
		Size:         info.Size(),
		ModifiedNano: info.ModTime().UnixNano(),
		Mode:         info.Mode(),
		Hash:         workingHash,
	})
	return gitFileIdentity{
		Exists: true,
		Mode:   gitModeForFileInfo(info),
		Hash:   workingHash,
	}
}

func gitWorkingFileHash(path string, info fs.FileInfo) (string, bool) {
	if info.Mode()&os.ModeSymlink != 0 {
		targetInfo, err := os.Stat(path)
		if err != nil {
			return "", false
		}
		info = targetInfo
	}
	if !info.Mode().IsRegular() || info.Size() > maxGitRevisionHashFileSize {
		return fmt.Sprintf("metadata:%d:%d", info.Size(), info.ModTime().UnixNano()), true
	}

	file, err := os.Open(path)
	if err != nil {
		return "", false
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", false
	}
	return fmt.Sprintf("%x", digest.Sum(nil)), true
}

func pruneGitWorkingHashCache(projectPath string, files []GitFile) {
	currentFiles := make(map[string]struct{}, len(files))
	for _, file := range files {
		currentFiles[file.Name] = struct{}{}
	}
	gitWorkingHashCache.Range(func(key, _ any) bool {
		cacheKey, ok := key.(gitWorkingHashCacheKey)
		if ok && cacheKey.ProjectPath == projectPath {
			if _, exists := currentFiles[cacheKey.Filename]; !exists {
				gitWorkingHashCache.Delete(cacheKey)
			}
		}
		return true
	})
}

func invalidateGitWorkingHash(projectPath, filename string) {
	gitWorkingHashCache.Delete(gitWorkingHashCacheKey{ProjectPath: projectPath, Filename: filename})
}

func gitModeForFileInfo(info fs.FileInfo) string {
	mode := info.Mode()
	if mode&os.ModeSymlink != 0 {
		return "120000"
	}
	if mode.IsRegular() {
		if mode.Perm()&0111 != 0 {
			return "100755"
		}
		return "100644"
	}
	return mode.String()
}

func writeGitFileIdentity(digest hash.Hash, label string, identity gitFileIdentity) {
	fmt.Fprintf(digest, "%s\x00%t\x00%s\x00%s\x00", label, identity.Exists, identity.Mode, identity.Hash)
}

// gitTrunkForkPoint returns the merge base between trunk and HEAD — the commit
// the current branch forked from. Diffing against it shows the branch's own
// work without the commits trunk has gained since.
//
// Both refs/remotes/origin/<trunk> and refs/heads/<trunk> are considered, and
// the newer merge base wins. A worktree that merged origin/<trunk> into HEAD
// without advancing local <trunk> would otherwise diff against the stale local
// tip and surface those merged-in commits as branch work.
func gitTrunkForkPoint(projectPath, trunk string) string {
	if trunk == "" {
		return ""
	}
	var bases []string
	for _, ref := range []string{"refs/remotes/origin/" + trunk, "refs/heads/" + trunk} {
		if _, err := runGit(projectPath, "show-ref", "--verify", "--quiet", ref); err != nil {
			continue
		}
		out, err := runGit(projectPath, "merge-base", ref, "HEAD")
		if err != nil {
			continue
		}
		base := strings.TrimSpace(out)
		if isGitCommitHash(base) {
			bases = append(bases, base)
		}
	}
	if len(bases) == 0 {
		return ""
	}
	best := bases[0]
	for _, b := range bases[1:] {
		if _, err := runGit(projectPath, "merge-base", "--is-ancestor", best, b); err == nil {
			best = b
		}
	}
	return best
}

// gitFilesChangedSince lists files differing between base and the working tree.
// A plain `git diff <commit>` compares the working tree to that commit, so
// committed and uncommitted changes arrive in one pass; untracked files need a
// second pass because no diff reports them. Nothing here is revertible: the
// committed half of a change cannot be undone from the working tree.
func gitFilesChangedSince(projectPath, base string) []GitFile {
	files := []GitFile{}
	seen := make(map[string]bool)

	if out, err := runGit(projectPath, "diff", "--name-status", "-z", base, "--"); err == nil {
		// -z pairs each status with its raw pathname, leaving names that hold a
		// space or non-ASCII byte unquoted. Rename and copy pairs carry a third
		// record, the destination, which is the name the panel lists.
		records := strings.Split(out, "\x00")
		for i := 0; i+1 < len(records); i += 2 {
			status, name := records[i], records[i+1]
			if status == "" {
				continue
			}
			if status[0] == 'R' || status[0] == 'C' {
				if i+2 >= len(records) {
					break
				}
				name = records[i+2]
				i++
			}
			if name == "" || seen[name] {
				continue
			}
			seen[name] = true
			files = append(files, GitFile{Status: shortDiffStatus(status), Name: name})
		}
	}

	for _, name := range gitUntrackedFiles(projectPath) {
		if seen[name] {
			continue
		}
		seen[name] = true
		files = append(files, GitFile{Status: "??", Name: name})
	}

	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	return files
}

func gitUntrackedFiles(projectPath string) []string {
	out, err := runGit(projectPath, "ls-files", "--others", "--exclude-standard")
	if err != nil {
		return nil
	}
	var names []string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			names = append(names, line)
		}
	}
	return names
}

// shortDiffStatus drops the similarity score git appends to rename and copy
// statuses (R100, C75) so the panel renders a single-letter badge.
func shortDiffStatus(status string) string {
	switch status[0] {
	case 'R', 'C':
		return status[:1]
	}
	return status
}

func isGitWorkTree(projectPath string) bool {
	out, err := runGit(projectPath, "rev-parse", "--is-inside-work-tree")
	return err == nil && strings.TrimSpace(out) == "true"
}

func nonGitProjectFiles(projectPath string) []GitFile {
	files := []GitFile{}
	_ = filepath.WalkDir(projectPath, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if path == projectPath {
			return nil
		}
		if entry.IsDir() {
			switch entry.Name() {
			case ".git", "node_modules", "vendor":
				return fs.SkipDir
			}
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(projectPath, path)
		if err != nil {
			return nil
		}
		files = append(files, GitFile{Status: "??", Name: filepath.ToSlash(rel)})
		return nil
	})
	sort.Slice(files, func(i, j int) bool {
		return files[i].Name < files[j].Name
	})
	return files
}

func gitLineStats(projectPath string, files []GitFile) (int, int) {
	return gitLineStatsSince(projectPath, "HEAD", files)
}

func gitLineStatsSince(projectPath, base string, files []GitFile) (int, int) {
	added, deleted := 0, 0
	if out, err := runGit(projectPath, "diff", "--numstat", base, "--"); err == nil {
		added, deleted = parseGitNumstat(out)
	} else {
		for _, args := range [][]string{
			{"diff", "--numstat", "--"},
			{"diff", "--cached", "--numstat", "--"},
		} {
			if out, err := runGit(projectPath, args...); err == nil {
				a, d := parseGitNumstat(out)
				added += a
				deleted += d
			}
		}
	}

	for _, file := range files {
		if file.Status == "??" {
			added += countWorkingFileLines(projectPath, file.Name)
		}
	}

	return added, deleted
}

func parseGitNumstat(out string) (int, int) {
	added, deleted := 0, 0
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		if n, err := strconv.Atoi(fields[0]); err == nil {
			added += n
		}
		if n, err := strconv.Atoi(fields[1]); err == nil {
			deleted += n
		}
	}
	return added, deleted
}

func cleanProjectRelPath(filename string) (string, error) {
	clean := filepath.Clean(filename)
	if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path traversal denied")
	}
	return clean, nil
}

func pathWithin(base, target string) bool {
	rel, err := filepath.Rel(base, target)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func nearestExistingPath(path string) (string, error) {
	for {
		if _, err := os.Lstat(path); err == nil {
			return path, nil
		} else if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(path)
		if parent == path {
			return "", fmt.Errorf("no existing parent for path")
		}
		path = parent
	}
}

func projectFilePath(projectPath, filename string) (string, error) {
	rel, err := cleanProjectRelPath(filename)
	if err != nil {
		return "", err
	}
	absProject, err := filepath.Abs(projectPath)
	if err != nil {
		return "", err
	}
	realProject, err := filepath.EvalSymlinks(absProject)
	if err != nil {
		return "", err
	}
	target := filepath.Join(realProject, rel)
	existing, err := nearestExistingPath(target)
	if err != nil {
		return "", err
	}
	realExisting, err := filepath.EvalSymlinks(existing)
	if err != nil {
		return "", err
	}
	if !pathWithin(realProject, realExisting) {
		return "", fmt.Errorf("path traversal denied")
	}
	return target, nil
}

func countWorkingFileLines(projectPath, filename string) int {
	absFile, err := projectFilePath(projectPath, filename)
	if err != nil {
		return 0
	}
	content, err := os.ReadFile(absFile)
	if err != nil || len(content) == 0 {
		return 0
	}
	lines := bytes.Count(content, []byte{'\n'})
	if !bytes.HasSuffix(content, []byte{'\n'}) {
		lines++
	}
	return lines
}

func gitDiffFile(projectPath, filename string) string {
	rel, err := cleanProjectRelPath(filename)
	if err != nil {
		return ""
	}
	// Try staged diff first, then unstaged, then show untracked file content
	if out, err := runGit(projectPath, "diff", "--cached", "--", rel); err == nil && strings.TrimSpace(out) != "" {
		return out
	}
	if out, err := runGit(projectPath, "diff", "--", rel); err == nil && strings.TrimSpace(out) != "" {
		return out
	}
	// Untracked file — show contents
	if out, err := runGit(projectPath, "show", ":"+rel); err != nil {
		if content, ok := readWorkingBytes(projectPath, rel); ok {
			return "+++ new file\n" + string(content)
		}
	} else {
		return out
	}
	return ""
}

func gitBlameFile(projectPath, filename, ref string) ([]GitBlameLine, error) {
	rel, err := cleanProjectRelPath(filename)
	if err != nil {
		return nil, err
	}

	switch ref {
	case "", "working":
		out, err := runGit(projectPath, "blame", "--line-porcelain", "--", rel)
		if err == nil {
			return parseGitBlamePorcelain(out), nil
		}
		tracked, trackedErr := gitFileTracked(projectPath, rel)
		if trackedErr == nil && !tracked {
			if content, ok := readWorkingBytes(projectPath, rel); ok {
				return synthesizeUncommittedBlame(content, "Untracked file"), nil
			}
		}
		return nil, gitBlameCommandError(out, err)
	case "head":
		out, err := runGit(projectPath, "blame", "--line-porcelain", "HEAD", "--", rel)
		if err != nil {
			return nil, gitBlameCommandError(out, err)
		}
		return parseGitBlamePorcelain(out), nil
	default:
		return nil, fmt.Errorf("invalid blame ref")
	}
}

func gitFileTracked(projectPath, rel string) (bool, error) {
	out, err := runGit(projectPath, "ls-files", "--error-unmatch", "--", rel)
	if err == nil {
		return true, nil
	}
	if strings.Contains(out, "did not match any file(s) known to git") {
		return false, nil
	}
	return false, gitBlameCommandError(out, err)
}

func parseGitBlamePorcelain(out string) []GitBlameLine {
	var lines []GitBlameLine
	var current *GitBlameLine

	for _, raw := range strings.Split(out, "\n") {
		if raw == "" {
			continue
		}
		if strings.HasPrefix(raw, "\t") {
			if current != nil {
				lines = append(lines, *current)
				current = nil
			}
			continue
		}

		fields := strings.Fields(raw)
		if len(fields) >= 3 {
			commit := cleanBlameCommitHash(fields[0])
			if isGitCommitHash(commit) {
				originalLine, _ := strconv.Atoi(fields[1])
				finalLine, _ := strconv.Atoi(fields[2])
				current = &GitBlameLine{
					Line:         finalLine,
					OriginalLine: originalLine,
					Commit:       commit,
					ShortCommit:  shortGitCommit(commit),
				}
				continue
			}
		}
		if current == nil {
			continue
		}

		key, value, ok := strings.Cut(raw, " ")
		if !ok {
			continue
		}
		switch key {
		case "author":
			current.Author = value
		case "author-mail":
			current.AuthorEmail = strings.Trim(value, "<>")
		case "author-time":
			current.AuthorTime, _ = strconv.ParseInt(value, 10, 64)
		case "summary":
			current.Summary = value
		}
	}

	return lines
}

func cleanBlameCommitHash(value string) string {
	return strings.TrimPrefix(value, "^")
}

func synthesizeUncommittedBlame(content []byte, summary string) []GitBlameLine {
	lineCount := bytes.Count(content, []byte{'\n'})
	if len(content) > 0 && !bytes.HasSuffix(content, []byte{'\n'}) {
		lineCount++
	}
	lines := make([]GitBlameLine, 0, lineCount)
	for line := 1; line <= lineCount; line++ {
		lines = append(lines, GitBlameLine{
			Line:         line,
			OriginalLine: line,
			Commit:       "0000000000000000000000000000000000000000",
			ShortCommit:  "uncommitted",
			Author:       "Not Committed Yet",
			Summary:      summary,
		})
	}
	return lines
}

func isGitCommitHash(value string) bool {
	if len(value) < 40 || len(value) > 64 {
		return false
	}
	for _, r := range value {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') {
			continue
		}
		return false
	}
	return true
}

func shortGitCommit(commit string) string {
	if commit == "" {
		return ""
	}
	if strings.Trim(commit, "0") == "" {
		return "uncommitted"
	}
	if len(commit) > 8 {
		return commit[:8]
	}
	return commit
}

func gitBlameCommandError(out string, err error) error {
	message := strings.TrimSpace(out)
	if message == "" && err != nil {
		message = err.Error()
	}
	if message == "" {
		message = "git blame failed"
	}
	return fmt.Errorf("%s", message)
}

func writeWorkingFile(projectPath, filename, content string) error {
	absFile, err := projectFilePath(projectPath, filename)
	if err != nil {
		return err
	}
	err = os.WriteFile(absFile, []byte(content), 0644)
	// A same-size write can retain identical stat metadata on coarse-mtime
	// filesystems, so explicit application writes must never reuse the cache.
	invalidateGitWorkingHash(projectPath, filename)
	return err
}

func createWorkingFile(projectPath, filename, content string) error {
	absFile, err := projectFilePath(projectPath, filename)
	if err != nil {
		return err
	}
	// Create parent directories if needed
	if err := os.MkdirAll(filepath.Dir(absFile), 0755); err != nil {
		return err
	}
	err = os.WriteFile(absFile, []byte(content), 0644)
	invalidateGitWorkingHash(projectPath, filename)
	return err
}

func renameWorkingFile(projectPath, oldName, newName string) error {
	absOld, err := projectFilePath(projectPath, oldName)
	if err != nil {
		return err
	}
	absNew, err := projectFilePath(projectPath, newName)
	if err != nil {
		return err
	}
	// Create parent directories for the new path if needed
	if err := os.MkdirAll(filepath.Dir(absNew), 0755); err != nil {
		return err
	}
	return os.Rename(absOld, absNew)
}

func deleteWorkingFile(projectPath, filename string) error {
	absFile, err := projectFilePath(projectPath, filename)
	if err != nil {
		return err
	}
	return os.Remove(absFile)
}

func gitDirtyCount(projectPath string) int {
	out, err := runGit(projectPath, "status", "--porcelain", "-uall")
	if err != nil {
		return 0
	}
	count := 0
	for _, line := range strings.Split(out, "\n") {
		if len(line) >= 4 {
			count++
		}
	}
	return count
}

func projectChangeCount(projectPath string) (int, bool) {
	if !isGitWorkTree(projectPath) {
		return len(nonGitProjectFiles(projectPath)), false
	}
	return gitDirtyCount(projectPath), true
}

func gitListBranches(projectPath string) ([]string, string) {
	out, err := runGit(projectPath, "branch", "--list", "--format=%(refname:short)")
	if err != nil {
		return nil, ""
	}
	current := ""
	if c, err := runGit(projectPath, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		current = strings.TrimSpace(c)
	}
	var branches []string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			branches = append(branches, line)
		}
	}
	return branches, current
}

func gitListBranchesWithRemotes(projectPath string) ([]string, string) {
	branches, current := gitListBranches(projectPath)
	if branches == nil {
		return nil, current
	}
	if out, err := runGit(projectPath, "for-each-ref", "--format=%(refname:short)", "refs/remotes/"); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasSuffix(line, "/HEAD") {
				continue
			}
			branches = append(branches, line)
		}
	}
	return branches, current
}

// splitRemoteRef reports whether ref names a remote-tracking branch (its first
// path segment matches a known remote). When it does, it returns the short
// branch name (ref with the remote segment stripped) and the remote name. A
// bare remote name like "origin" is not a branch and reports false.
func splitRemoteRef(ref string, remotes []string) (short, remote string, isRemote bool) {
	for _, r := range remotes {
		if strings.HasPrefix(ref, r+"/") {
			return strings.TrimPrefix(ref, r+"/"), r, true
		}
	}
	return "", "", false
}

// CheckoutResult is the outcome of a checkout request. When Conflict is true no
// branch switch happened: a local branch with the same name as the requested
// remote branch exists but diverges from it, and the caller must choose how to
// resolve it (re-call with action "local" or "reset-remote").
type CheckoutResult struct {
	Output   string `json:"output,omitempty"`
	Conflict bool   `json:"conflict,omitempty"`
	Branch   string `json:"branch,omitempty"`
	Remote   string `json:"remote,omitempty"`
}

func gitRemotes(projectPath string) []string {
	out, err := runGit(projectPath, "remote")
	if err != nil {
		return nil
	}
	var remotes []string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			remotes = append(remotes, line)
		}
	}
	return remotes
}

func localBranchExists(projectPath, name string) bool {
	_, err := runGit(projectPath, "rev-parse", "--verify", "--quiet", "refs/heads/"+name)
	return err == nil
}

// gitCheckout checks out branch, which may be a local name ("feat") or a
// remote-tracking ref ("origin/feat"). For a remote ref with a same-name local
// branch that diverges from it, and no action given, it reports a conflict
// without switching. action "local" keeps the local branch; "reset-remote"
// resets the local branch to the remote tip.
func gitCheckout(projectPath, branch, action string) (CheckoutResult, error) {
	// A name like "feature/foo" can be both a real local branch and shaped like a
	// remote ref when a remote happens to be named "feature" (likewise a local
	// branch literally named "origin/foo"). An exact local branch always wins —
	// it's the entry the user picked in the list — so resolve it directly before
	// treating the name as a remote-tracking ref and deriving a wrong short name.
	if action == "" && localBranchExists(projectPath, branch) {
		out, err := runGit(projectPath, "checkout", branch)
		return CheckoutResult{Output: out}, err
	}

	short, _, isRemote := splitRemoteRef(branch, gitRemotes(projectPath))
	if !isRemote {
		out, err := runGit(projectPath, "checkout", branch)
		return CheckoutResult{Output: out}, err
	}

	remoteRef := branch // e.g. "origin/feat"
	switch action {
	case "local":
		out, err := runGit(projectPath, "checkout", short)
		return CheckoutResult{Output: out}, err
	case "reset-remote":
		out, err := runGit(projectPath, "checkout", "-B", short, remoteRef)
		return CheckoutResult{Output: out}, err
	}

	// Initial request: decide whether the same-name local branch conflicts.
	if localBranchExists(projectPath, short) {
		localTip, errL := runGit(projectPath, "rev-parse", short)
		remoteTip, errR := runGit(projectPath, "rev-parse", remoteRef)
		if errL == nil && errR == nil && strings.TrimSpace(localTip) != strings.TrimSpace(remoteTip) {
			return CheckoutResult{Conflict: true, Branch: short, Remote: remoteRef}, nil
		}
		// Same-name local branch is in sync with the remote — just switch to it.
		out, err := runGit(projectPath, "checkout", short)
		return CheckoutResult{Output: out}, err
	}
	// No local branch yet: create one that tracks the exact remote ref the user
	// picked. Checking out the short name would lean on git's DWIM guessing,
	// which fails (or picks the wrong remote) when several remotes carry the
	// same branch or checkout.guess is disabled.
	out, err := runGit(projectPath, "checkout", "-b", short, "--track", remoteRef)
	return CheckoutResult{Output: out}, err
}

// gitMainBranch returns the local trunk branch name, preferring "main" then
// "master". Returns "" if neither exists locally.
func gitMainBranch(projectPath string) string {
	for _, name := range []string{"main", "master"} {
		if _, err := runGit(projectPath, "show-ref", "--verify", "--quiet", "refs/heads/"+name); err == nil {
			return name
		}
	}
	return ""
}

type mergedBranch struct {
	Name   string `json:"name"`
	Reason string `json:"reason"` // "merged" (ancestry) or "squashed"
}

// gitMergedBranches returns local branches whose work is already in the main
// branch. It detects both ancestry merges (commits reachable from main) and
// squash/rebase merges (main contains an equivalent of the branch's combined
// patch). The current HEAD branch, "main", and "master" are always excluded.
func gitMergedBranches(projectPath string) []mergedBranch {
	main := gitMainBranch(projectPath)
	if main == "" {
		return nil
	}
	current := ""
	if c, err := runGit(projectPath, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		current = strings.TrimSpace(c)
	}
	protected := map[string]bool{"main": true, "master": true}
	if current != "" {
		protected[current] = true
	}

	var result []mergedBranch
	seen := map[string]bool{}

	// Ancestry-merged: branch tip is reachable from main.
	if out, err := runGit(projectPath, "branch", "--merged", main, "--format=%(refname:short)"); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
			name := strings.TrimSpace(line)
			if name == "" || protected[name] || seen[name] {
				continue
			}
			seen[name] = true
			result = append(result, mergedBranch{Name: name, Reason: "merged"})
		}
	}

	// Squash/rebase-merged: main already contains an equivalent of the branch's
	// combined patch, even though its tip is not an ancestor of main.
	branches, _ := gitListBranches(projectPath)
	for _, name := range branches {
		if protected[name] || seen[name] {
			continue
		}
		if isSquashMerged(projectPath, main, name) {
			seen[name] = true
			result = append(result, mergedBranch{Name: name, Reason: "squashed"})
		}
	}
	return result
}

// isSquashMerged reports whether main already contains an equivalent of the
// branch's changes. It synthesizes a single squashed commit of the branch on
// top of its merge base, then asks git cherry whether main holds an equivalent
// patch (a leading "-" on every reported commit means yes).
func isSquashMerged(projectPath, main, branch string) bool {
	base, err := runGit(projectPath, "merge-base", main, branch)
	if err != nil {
		return false
	}
	base = strings.TrimSpace(base)
	if base == "" {
		return false
	}
	tree, err := runGit(projectPath, "rev-parse", branch+"^{tree}")
	if err != nil {
		return false
	}
	tree = strings.TrimSpace(tree)

	// Isolate the synthetic commit in a throwaway object directory so this
	// read-only scan never mutates the project's object database. The real
	// objects are exposed as an alternate so cherry can still read main.
	realObjects, err := runGit(projectPath, "rev-parse", "--git-path", "objects")
	if err != nil {
		return false
	}
	realObjects = strings.TrimSpace(realObjects)
	if !filepath.IsAbs(realObjects) {
		realObjects = filepath.Join(projectPath, realObjects)
	}
	tmpObjects, err := os.MkdirTemp("", "merged-check-")
	if err != nil {
		return false
	}
	defer os.RemoveAll(tmpObjects)
	env := append(os.Environ(),
		"GIT_OBJECT_DIRECTORY="+tmpObjects,
		"GIT_ALTERNATE_OBJECT_DIRECTORIES="+realObjects,
	)

	synthetic, err := runGitEnv(projectPath, env, "commit-tree", tree, "-p", base, "-m", "squash-check")
	if err != nil {
		return false
	}
	synthetic = strings.TrimSpace(synthetic)
	out, err := runGitEnv(projectPath, env, "cherry", main, synthetic)
	if err != nil {
		return false
	}
	out = strings.TrimSpace(out)
	if out == "" {
		return true // branch contributes nothing not already in main
	}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if !strings.HasPrefix(line, "-") {
			return false
		}
	}
	return true
}

type branchDeleteResult struct {
	Branch string `json:"branch"`
	Error  string `json:"error"`
}

// gitDeleteBranches force-deletes the named local branches, returning a result
// per branch. Each name is re-verified against the merged set server-side
// before deletion, so an arbitrary request body cannot force-delete unmerged
// work or trunk refs (main/master and the current HEAD are never merged
// candidates). Force (-D) is used because squash-merged branches are not
// ancestry-merged and -d would refuse them.
func gitDeleteBranches(projectPath string, names []string) []branchDeleteResult {
	allowed := map[string]bool{}
	for _, b := range gitMergedBranches(projectPath) {
		allowed[b.Name] = true
	}

	var results []branchDeleteResult
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		r := branchDeleteResult{Branch: name}
		if !allowed[name] {
			r.Error = "branch is not merged into the trunk; refusing to delete"
			results = append(results, r)
			continue
		}
		out, err := runGit(projectPath, "branch", "-D", name)
		if err != nil {
			msg := strings.TrimSpace(out)
			if msg == "" {
				msg = err.Error()
			}
			r.Error = msg
		}
		results = append(results, r)
	}
	return results
}

func gitCommit(projectPath string, files []string, message string) (string, error) {
	// Stage specified files
	for _, f := range files {
		if out, err := runGit(projectPath, "add", "--", f); err != nil {
			return out, err
		}
	}
	commitOut, err := runGit(projectPath, "commit", "-m", message)
	if err != nil {
		return commitOut, err
	}
	pushOut, pushErr := runGit(projectPath, "push")
	out := commitOut + pushOut
	if pushErr != nil {
		return out, pushErr
	}
	return out, nil
}

func gitCheckoutMain(projectPath string) (string, error) {
	// Try main first, then master
	out, err := runGit(projectPath, "checkout", "main")
	if err != nil {
		out, err = runGit(projectPath, "checkout", "master")
	}
	return out, err
}

func gitPull(projectPath string) (string, error) {
	return runGit(projectPath, "pull")
}

// gitFetch updates remote-tracking refs without modifying the working tree.
// Bounded by a hard timeout and runs with terminal prompts disabled so missing
// credentials fail fast rather than blocking on an unattended prompt.
func gitFetch(projectPath string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "fetch", "--prune", "--quiet")
	cmd.Dir = projectPath
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func gitRevertFile(projectPath, filename, status string) (string, error) {
	if !isGitWorkTree(projectPath) {
		return "", fmt.Errorf("git repository is not initialized")
	}
	rel, err := cleanProjectRelPath(filename)
	if err != nil {
		return "", err
	}
	if status == "??" {
		path, err := projectFilePath(projectPath, rel)
		if err != nil {
			return "", err
		}
		info, err := os.Lstat(path)
		if err != nil {
			return "", err
		}
		if info.IsDir() {
			return "", fmt.Errorf("refusing to remove directory: %s", rel)
		}
		return "", os.Remove(path)
	}
	// Staged changes — unstage first
	if status != "" && status[0] != ' ' {
		if out, err := runGit(projectPath, "reset", "HEAD", "--", rel); err != nil {
			return out, err
		}
	}
	return runGit(projectPath, "checkout", "--", rel)
}

func gitRevertDirectory(projectPath, directory string) (string, error) {
	if !isGitWorkTree(projectPath) {
		return "", fmt.Errorf("git repository is not initialized")
	}
	rel, err := cleanProjectRelPath(directory)
	if err != nil {
		return "", err
	}
	var output strings.Builder
	if out, err := runGit(projectPath, "reset", "HEAD", "--", rel); err != nil {
		return out, err
	} else {
		output.WriteString(out)
	}
	tracked, err := runGit(projectPath, "ls-files", "--", rel)
	if err != nil {
		return output.String() + tracked, err
	}
	if strings.TrimSpace(tracked) != "" {
		out, err := runGit(projectPath, "checkout", "--", rel)
		output.WriteString(out)
		if err != nil {
			return output.String(), err
		}
	}
	out, err := runGit(projectPath, "clean", "-fd", "--", rel)
	output.WriteString(out)
	return output.String(), err
}

func gitRevertAll(projectPath string) (string, error) {
	if !isGitWorkTree(projectPath) {
		return "", fmt.Errorf("git repository is not initialized")
	}
	// Reset staged changes
	if out, err := runGit(projectPath, "reset", "HEAD"); err != nil {
		return out, err
	}
	// Checkout all tracked files
	if out, err := runGit(projectPath, "checkout", "."); err != nil {
		return out, err
	}
	// Remove untracked files and directories
	return runGit(projectPath, "clean", "-fd")
}

func gitListIgnoredFiles(projectPath string) ([]string, error) {
	out, err := runGit(projectPath, "ls-files", "-z", "--others", "--ignored", "--exclude-standard")
	if err != nil {
		return nil, err
	}
	var files []string
	for _, name := range strings.Split(out, "\x00") {
		if name != "" {
			files = append(files, name)
		}
	}
	return files, nil
}

func gitListFiles(projectPath string) []string {
	// List tracked + untracked (respecting gitignore)
	out, err := runGit(projectPath, "ls-files", "--cached", "--others", "--exclude-standard")
	if err != nil {
		return nil
	}
	seen := make(map[string]bool)
	var files []string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			files = append(files, line)
			seen[line] = true
		}
	}

	// Also include gitignored .env* files so they're visible in the editor
	envOut, err := runGit(projectPath, "ls-files", "--others", "--ignored", "--exclude-standard")
	if err == nil {
		for _, line := range strings.Split(strings.TrimSpace(envOut), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || seen[line] {
				continue
			}
			base := line
			if idx := strings.LastIndex(line, "/"); idx >= 0 {
				base = line[idx+1:]
			}
			if strings.HasPrefix(base, ".env") {
				files = append(files, line)
			}
		}
	}

	return files
}

type searchOptions struct {
	CaseSensitive bool
	WholeWord     bool
	UseRegex      bool
	Include       string // glob pattern for files to include
	Exclude       string // glob pattern for files to exclude
}

func gitGrepSearch(projectPath, query string, opts searchOptions) []searchResult {
	var results []searchResult

	args := []string{"grep", "-n", "-I", "--max-count=10"}

	if !opts.CaseSensitive {
		args = append(args, "-i")
	}
	if opts.WholeWord {
		args = append(args, "-w")
	}
	if !opts.UseRegex {
		args = append(args, "-F") // fixed string (literal match)
	}

	args = append(args, query, "--")

	// Add include globs
	if opts.Include != "" {
		for _, pattern := range strings.Fields(opts.Include) {
			pattern = strings.TrimSpace(pattern)
			if pattern != "" {
				args = append(args, pattern)
			}
		}
	}

	out, _ := runGit(projectPath, args...)

	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Format: file:line:content
		parts := strings.SplitN(line, ":", 3)
		if len(parts) < 3 {
			continue
		}

		file := parts[0]

		// Apply exclude filter
		if opts.Exclude != "" {
			excluded := false
			for _, pattern := range strings.Fields(opts.Exclude) {
				pattern = strings.TrimSpace(pattern)
				if pattern == "" {
					continue
				}
				if matched, _ := filepath.Match(pattern, filepath.Base(file)); matched {
					excluded = true
					break
				}
				// Also try matching against full path
				if matched, _ := filepath.Match(pattern, file); matched {
					excluded = true
					break
				}
				// Check if pattern is a directory prefix
				if strings.HasPrefix(file, strings.TrimSuffix(pattern, "/")+"/") {
					excluded = true
					break
				}
			}
			if excluded {
				continue
			}
		}

		lineNum, _ := strconv.Atoi(parts[1])
		results = append(results, searchResult{
			File:    file,
			Line:    lineNum,
			Content: strings.TrimSpace(parts[2]),
		})
		if len(results) >= 500 {
			break
		}
	}
	return results
}

type searchResult struct {
	File    string `json:"file"`
	Line    int    `json:"line"`
	Content string `json:"content"`
}

// readHeadBytes returns the raw bytes of a file at HEAD, and an exists flag
// (false if the file is not tracked or git show fails for any reason).
func readHeadBytes(projectPath, filename string) ([]byte, bool) {
	return readBaseBytes(projectPath, "", filename)
}

// readBaseBytes returns the raw bytes of a file at base, and an exists flag.
// An empty base means HEAD; anything else must be a full commit hash so a
// client-supplied value cannot smuggle git options into the revision.
// Uses Output() rather than CombinedOutput() so stderr does not corrupt
// binary content.
func readBaseBytes(projectPath, base, filename string) ([]byte, bool) {
	rel, err := cleanProjectRelPath(filename)
	if err != nil {
		return nil, false
	}
	revision := "HEAD"
	if base != "" {
		if !isGitCommitHash(base) {
			return nil, false
		}
		revision = base
	}
	cmd := exec.Command("git", "show", revision+":"+rel)
	cmd.Dir = projectPath
	data, err := cmd.Output()
	if err != nil {
		return nil, false
	}
	return data, true
}

// readWorkingBytes returns the raw bytes of a file from the working tree,
// and an exists flag. Guards against path traversal by requiring the
// resolved absolute path to stay within the project directory.
func readWorkingBytes(projectPath, filename string) ([]byte, bool) {
	absFile, err := projectFilePath(projectPath, filename)
	if err != nil {
		return nil, false
	}
	data, err := os.ReadFile(absFile)
	if err != nil {
		return nil, false
	}
	return data, true
}

// containsNul returns true if data contains a NUL byte within the first 8 KB.
// Same heuristic git uses to classify binary content.
func containsNul(data []byte) bool {
	limit := len(data)
	if limit > 8192 {
		limit = 8192
	}
	for i := 0; i < limit; i++ {
		if data[i] == 0 {
			return true
		}
	}
	return false
}

// classifyFile returns "image", "binary", or "text" based on extension and
// NUL-byte presence. Image extensions are checked first so SVG (which is
// technically text) is classified as image and rendered natively by the browser.
func classifyFile(original, modified []byte, filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg":
		return "image"
	}
	if containsNul(original) || containsNul(modified) {
		return "binary"
	}
	return "text"
}

// mimeFromExt returns an image MIME type for recognised extensions, falling
// back to application/octet-stream. Intended for the /file/blob endpoint —
// not a general-purpose MIME detector.
func mimeFromExt(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".ico":
		return "image/x-icon"
	case ".svg":
		return "image/svg+xml"
	}
	return "application/octet-stream"
}

func runGit(dir string, args ...string) (string, error) {
	return runGitEnv(dir, nil, args...)
}

// runGitEnv runs git with an explicit environment. A nil env inherits the
// current process environment unchanged.
func runGitEnv(dir string, env []string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if env != nil {
		cmd.Env = env
	}
	out, err := cmd.CombinedOutput()
	return string(out), err
}
