# Agent Deck

A desktop app for running AI coding agents across many Git repos from one
window. Each project gets terminal tabs running the AI CLI you pick (Claude
Code, Codex, Gemini, opencode, Kimi, Cursor or your own wrapper), next to a Git
panel, diff viewer and editor. You can watch several agents work and review
what they changed without switching tools.

```
Agent Deck window (Electron) -> local Go server on 127.0.0.1 -> terminals running claude / codex / ...
```

Everything builds in Docker, so on Linux you don't need Go or Node installed.

## What it does

**Agents**

- **Tabs per project or worktree**, each running your AI CLI. Split a tab to run
  a second agent next to the first, with a different CLI if you like.
- **Restart and resume** a session's last conversation, for CLIs that support it.
- **Live status** per session (working, waiting for permission, idle, done but
  not looked at), with desktop notifications.
- **Scheduled jobs**: run a prompt on a cron schedule with the selected CLI, with
  run history and logs.
- **Permission bypass per CLI** (Claude, Codex sandbox, Gemini yolo, ...), off by
  default.

**Git**

- Branch, ahead/behind and changed files, kept fresh by a background fetch. You
  can also compare against the `main`/`master` fork point to see everything
  committed on the branch.
- Pull, commit, revert, switch branches, clean up merged branches.
- Diff viewer with blame, image diffs and per-file "viewed" marks.
- Create, open and remove worktrees.
- Status overview of every project, with "Pull all".

**Tools**

- Built-in editor (Monaco), find in files, go to file, go to project.
- Read-only database browser for PostgreSQL, MySQL and SQLite.
- Start and stop a project's Docker Compose stack.
- Keeps the machine awake while agents are working.
- Claude Code and Codex usage: estimated API cost and messages for today, this
  week and this month, read from each CLI's local session logs. On a
  subscription it also shows the 5-hour and weekly limits; on an API key, the
  month against a budget you set.
- Command palette, configurable keymap and 15 themes.

## What you need

- At least one AI CLI, installed and logged in: `claude`, `codex`, `gemini`,
  `opencode`, `kimi` or `cursor-agent`. Agent Deck starts them, it doesn't
  install them. **Settings** shows which ones it found.
- [Docker](https://docs.docker.com/get-docker/) with Compose v2 (`docker compose`)
  and `git` to build it. The build stamps the version from the last commit date.

Optional, per feature:

| Feature | Needs |
|---|---|
| GitHub activity tile | [`gh`](https://cli.github.com), logged in with `gh auth login` |
| Start/stop a project's Docker stack | A Compose file in that repo |
| Saved database passwords | A system keyring (GNOME Keyring, KWallet, Keychain) |
| Dev build with hot reload | `make`, `curl`, `unzip`, `sha256sum` |

## Where things live

| Thing | Location |
|---|---|
| AppImage settings | `~/.config/agentdeck/config.json` (or `$XDG_CONFIG_HOME/agentdeck/`) |
| Dev build settings | `config.json` in the repo root (gitignored) |
| macOS settings | `~/Library/Application Support/Agent Deck/` |
| Database connections, saved queries, job logs | Next to whichever `config.json` is in use |
| Built AppImage | `./dist/` |

The AppImage and the dev build read different config files, so you can use a
packaged build every day while working on the code. Copy one `config.json` over
the other when you want them in sync.

## Configuration

Most of this is editable from **Settings**.

```json
{
  "scan_paths": ["/home/user/work-projects", "/home/user/personal-projects"],
  "extra_projects": ["/path/to/another/repo"],
  "pinned_projects": ["project-name"],
  "cli": "claude",
  "cli_integrations": [
    {
      "id": "my-wrapper",
      "name": "My wrapper",
      "command": "my-wrapper claude",
      "resume_command": "my-wrapper claude --continue",
      "check_command": "my-wrapper"
    }
  ]
}
```

- `scan_paths`: folders searched for Git repos. Each repo becomes a project.
- `extra_projects`: single repos outside the scan paths.
- `pinned_projects`: shown at the top of the sidebar.
- `cli`: the AI CLI for new terminals and scheduled jobs - `claude`, `openai`
  (Codex), `gemini`, `opencode`, `kimi`, `cursor`, or the `id` of a custom
  integration. Running sessions keep their CLI until restarted.
- `cli_integrations`: your own launch commands, e.g. a wrapper around an AI CLI.
  `command` runs in the terminal, `resume_command` runs on "restart and resume",
  and `check_command` is what Settings looks for to show it as installed.

## Development

`make electron-dev` serves the UI (`cmd/agentdeck/static`) from disk and reloads
the window when you save. Changes to the Go backend or to Electron's
`main.js`/`preload.js` need a restart.

- The frontend is plain JavaScript, no build step.
- Themes: add a JSON file to `cmd/agentdeck/static/themes/` with a unique `id`
  and list it in `index.json`.
- Icons come from [Lucide](https://lucide.dev).
- Without `make`, the matching `docker compose` commands are in the `Makefile`.

[CLAUDE.md](./CLAUDE.md) covers the backend layout, the API and the Docker
services. It's also the instructions file for AI agents working on this repo.

## Caveats

- **It can run anything.** The local server runs commands, edits files and
  drives agents in your repos. It only answers requests from the app itself on
  `127.0.0.1` and refuses other websites in your browser, but don't expose it to
  a network. See [SECURITY.md](./SECURITY.md) to report a problem.
- **Custom integrations can't run scheduled jobs.** Jobs need one of the built-in
  CLIs.
- **opencode shows busy or idle only.** It doesn't report when it's waiting for
  permission.

## Setup

### Linux

You also need FUSE 2 to run the AppImage (`libfuse2` on Ubuntu 22.04+).

```bash
git clone https://github.com/Once4thewin/agent-deck.git
cd agent-deck
./scripts/electron-package.sh --no-start   # build the AppImage into ./dist/
./scripts/install-launcher.sh              # add "Agent Deck" to your app menu
```

Then press Super and search for "Agent Deck". The first build takes a few
minutes while Docker pulls images and downloads Electron; later builds are
cached.

On first launch it asks for the folder that holds your repos. Every Git repo
under it shows up in the sidebar. Pick your AI CLI in **Settings** (Claude Code
by default), then click a project to start a session.

#### Everyday commands

All run from the repo folder.

| What | Command |
|---|---|
| Build and launch the AppImage | `./scripts/electron-package.sh` |
| Build only | `./scripts/electron-package.sh --no-start` |
| Dev build with UI hot reload | `make electron-dev` |
| Dev build without `make` | `./scripts/electron-dev.sh` |
| Run the Go tests | `docker compose run --rm dev "apk add --no-cache git >/dev/null && go test ./..."` |
| Run the frontend tests | `cd cmd/agentdeck/static-tests && node --test *_test.js` |
| Remove build output | `make clean` |
| Remove the app menu entry | `./scripts/install-launcher.sh --uninstall` |
| Install a tagged version as the stable app | `./scripts/release.sh` |

#### Stable app and versions

Building from the repo puts whatever you have checked out into `./dist/`, so a
menu entry pointing there changes with every test build. To keep a stable app
while you work on the code, release a tagged version instead:

```bash
git tag v1.2.0
./scripts/release.sh
```

This builds that exact commit, copies it to `~/Applications/AgentDeck-1.2.0.AppImage`
and points the "Agent Deck" menu entry at it. Later test builds and
`make electron-dev` leave it alone, and they keep their own settings: the
AppImage reads `~/.config/agentdeck/`, dev builds the repo's `config.json`.
Older versions stay in `~/Applications`; to go back, run
`./scripts/install-launcher.sh` with the older AppImage.

Versions follow `MAJOR.MINOR.PATCH`: bug fixes raise the last number (1.2.0 ->
1.2.1), new features the middle one (1.2.1 -> 1.3.0), and breaking changes,
such as an old config no longer loading, the first (1.3.0 -> 2.0.0). A build
that isn't a clean tagged commit is marked as a dev build, such as
`1.2.0-dev+abc1234`. The version shows in the status bar and in
`agentdeck --version`.

### macOS

Apple Silicon only. You also need Node.js and npm.

```bash
git clone https://github.com/Once4thewin/agent-deck.git
cd agent-deck
make electron-package-mac   # writes a .dmg to ./dist/
```

Open the `.dmg` and drag Agent Deck to Applications. First launch works the same
as on Linux.

### Windows

No support currently.
