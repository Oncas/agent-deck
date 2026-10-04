package server

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Worktree struct {
	Name   string `json:"name"`
	Branch string `json:"branch"`
	Path   string `json:"path"`
}

// gitListWorktrees runs `git worktree list --porcelain` and returns all worktrees
// except the main one.
func gitListWorktrees(projectPath string) ([]Worktree, error) {
	out, err := runGit(projectPath, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, fmt.Errorf("git worktree list: %w", err)
	}

	absMain, err := filepath.Abs(projectPath)
	if err != nil {
		return nil, fmt.Errorf("resolving project path: %w", err)
	}

	return parseWorktreePorcelain(out, absMain), nil
}

// parseWorktreePorcelain parses the porcelain output of `git worktree list --porcelain`.
// Each entry is separated by a blank line. The first entry (main worktree) is skipped.
func parseWorktreePorcelain(output, mainPath string) []Worktree {
	var worktrees []Worktree

	// Normalize mainPath for comparison
	absMain, _ := filepath.Abs(mainPath)
	mainBase := filepath.Base(absMain)
	namePrefix := mainBase + "--"

	// Split into blocks separated by blank lines
	blocks := strings.Split(strings.TrimSpace(output), "\n\n")

	for _, block := range blocks {
		block = strings.TrimSpace(block)
		if block == "" {
			continue
		}

		var wtPath, branch string

		for _, line := range strings.Split(block, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "worktree ") {
				wtPath = strings.TrimPrefix(line, "worktree ")
			} else if strings.HasPrefix(line, "branch ") {
				// branch refs/heads/branch-name
				ref := strings.TrimPrefix(line, "branch ")
				branch = strings.TrimPrefix(ref, "refs/heads/")
			}
		}

		if wtPath == "" {
			continue
		}

		// Skip the main worktree
		absWt, _ := filepath.Abs(wtPath)
		if absWt == absMain {
			continue
		}

		// Derive name by stripping the "<mainBase>--" prefix used by gitAddWorktree.
		// Using LastIndex would break for branches containing "--" (e.g. sanitized
		// "feature/-fix" -> "feature--fix") and diverge from the Name set at create time.
		dirName := filepath.Base(wtPath)
		name := strings.TrimPrefix(dirName, namePrefix)

		worktrees = append(worktrees, Worktree{
			Name:   name,
			Branch: branch,
			Path:   wtPath,
		})
	}

	return worktrees
}

// sanitizeBranchForDir converts a branch name to a safe directory suffix.
// Replaces `/` with `-` and strips leading/trailing `-`.
func sanitizeBranchForDir(branch string) string {
	result := strings.ReplaceAll(branch, "/", "-")
	result = strings.Trim(result, "-")
	return result
}

// gitAddWorktree creates a new worktree as a sibling directory to the project.
// Dir name: parentDir/projectBaseName--sanitizedBranch.
// If isNew is true, creates a new branch with `git worktree add -b branch dir`.
// If startPoint is set, the new branch starts from that branch/ref/commit.
// If isNew is false, checks out an existing branch with `git worktree add dir branch`.
// Remote-tracking refs such as "origin/foo" create/check out a local "foo"
// branch, unless an exact local branch named "origin/foo" already exists.
func gitAddWorktree(projectPath, branch string, isNew bool, startPoint string) (*Worktree, error) {
	absProject, err := filepath.Abs(projectPath)
	if err != nil {
		return nil, fmt.Errorf("resolving project path: %w", err)
	}

	checkoutBranch := branch
	dirBranch := branch
	trackingRemote := ""
	if !isNew && !localBranchExists(absProject, branch) {
		if short, _, ok := splitRemoteRef(branch, gitRemotes(absProject)); ok && short != "" {
			checkoutBranch = short
			dirBranch = short
			if !localBranchExists(absProject, short) {
				trackingRemote = branch
			}
		}
	}

	parentDir := filepath.Dir(absProject)
	baseName := filepath.Base(absProject)
	sanitized := sanitizeBranchForDir(dirBranch)
	wtDir := filepath.Join(parentDir, baseName+"--"+sanitized)

	var out string
	if isNew {
		if startPoint != "" {
			out, err = runGit(absProject, "worktree", "add", "-b", branch, wtDir, startPoint)
		} else {
			out, err = runGit(absProject, "worktree", "add", "-b", branch, wtDir)
		}
	} else if trackingRemote != "" {
		out, err = runGit(absProject, "worktree", "add", "-b", checkoutBranch, "--track", wtDir, trackingRemote)
	} else {
		out, err = runGit(absProject, "worktree", "add", wtDir, checkoutBranch)
	}
	if err != nil {
		return nil, fmt.Errorf("git worktree add: %s: %w", strings.TrimSpace(out), err)
	}

	return &Worktree{
		Name:   sanitized,
		Branch: checkoutBranch,
		Path:   wtDir,
	}, nil
}

// gitRemoveWorktree removes a worktree by its path.
// If deleteBranch is true, also deletes the branch.
func gitRemoveWorktree(projectPath, wtPath string, deleteBranch bool, branchName string) error {
	branchExists := branchName != "" && localBranchExists(projectPath, branchName)
	removeArgs := []string{"worktree", "remove"}
	if branchName != "" && !branchExists && worktreeDirExists(wtPath) {
		// A worktree whose branch ref was deleted has an invalid (all-zero) HEAD.
		// Git consequently treats all of its tracked files as modifications and
		// refuses a normal removal. Verify it against its last reflog commit before
		// forcing removal so genuine uncommitted work remains protected.
		clean, err := staleWorktreeIsClean(wtPath)
		if err != nil {
			return fmt.Errorf("checking stale worktree: %w", err)
		}
		if !clean {
			return fmt.Errorf("git worktree remove: worktree contains modified or untracked files")
		}
		removeArgs = append(removeArgs, "--force")
	}
	removeArgs = append(removeArgs, wtPath)
	if out, err := runGit(projectPath, removeArgs...); err != nil {
		return fmt.Errorf("git worktree remove: %s: %w", strings.TrimSpace(out), err)
	}

	if deleteBranch && branchExists {
		if out, err := runGit(projectPath, "branch", "-D", branchName); err != nil {
			// The branch may have been deleted concurrently after the check above.
			if !localBranchExists(projectPath, branchName) {
				return nil
			}
			return fmt.Errorf("git branch -D: %s: %w", strings.TrimSpace(out), err)
		}
	}

	return nil
}

// worktreeDirExists reports whether the worktree still has a checkout on disk.
// A worktree whose directory was deleted by hand holds no work to protect, and
// every git command run inside it fails with "chdir: no such file or directory",
// so the cleanliness guard must be skipped for it.
func worktreeDirExists(wtPath string) bool {
	info, err := os.Stat(wtPath)
	return err == nil && info.IsDir()
}

// staleWorktreeIsClean checks a worktree whose branch ref is missing against
// the last valid commit recorded in its worktree HEAD reflog.
func staleWorktreeIsClean(wtPath string) (bool, error) {
	logPath, err := runGit(wtPath, "rev-parse", "--git-path", "logs/HEAD")
	if err != nil {
		return false, err
	}
	data, err := os.ReadFile(resolveWorktreeGitPath(wtPath, logPath))
	if err != nil {
		return false, err
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	base := ""
	for i := len(lines) - 1; i >= 0; i-- {
		fields := strings.Fields(lines[i])
		if len(fields) >= 2 && strings.Trim(fields[1], "0") != "" {
			base = fields[1]
			break
		}
	}
	if base == "" {
		return false, fmt.Errorf("no valid HEAD found in worktree reflog")
	}

	if _, err := runGit(wtPath, "diff", "--quiet", base, "--"); err != nil {
		return false, nil
	}
	untracked, err := runGit(wtPath, "ls-files", "--others", "--exclude-standard")
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(untracked) == "", nil
}

func resolveWorktreeGitPath(wtPath, gitPath string) string {
	gitPath = strings.TrimSpace(gitPath)
	if filepath.IsAbs(gitPath) {
		return gitPath
	}
	return filepath.Join(wtPath, gitPath)
}

// findWorktreeByName looks up a worktree by name from the list.
// Returns nil if not found.
func findWorktreeByName(projectPath, name string) *Worktree {
	worktrees, err := gitListWorktrees(projectPath)
	if err != nil {
		return nil
	}

	for i := range worktrees {
		if worktrees[i].Name == name {
			return &worktrees[i]
		}
	}

	return nil
}
