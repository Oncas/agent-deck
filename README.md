# Agent Deck

A desktop app for running AI coding agents across many Git repos from one
window. Each project gets terminal tabs running the AI CLI you pick (Claude
Code, Codex, Gemini, opencode, Kimi, Cursor or your own wrapper), next to a Git
panel, diff viewer and editor. You can watch several agents work and review
what they changed without switching tools.

```
Agent Deck window (Electron) -> local Go server on 127.0.0.1 -> terminals running claude / codex / ...
```

Linux users can download an AppImage containing Electron, the Go backend and
the UI. No repository checkout, Go, Node.js or Docker is needed to run it.
Contributors build in Docker, so they don't need a local Go toolchain.

## Installation

### Linux download (x86-64)

Open [Releases](https://github.com/Once4thewin/agent-deck/releases) and download
the latest published AppImage, `SHA256SUMS` and `install-launcher.sh`. If no
release has been published yet, use the [source-build instructions](#development).
The examples below use `1.0.1`; substitute the version you downloaded.

From the download folder, verify the files, put the AppImage somewhere permanent
and launch it:

```bash
sha256sum -c SHA256SUMS
mkdir -p ~/Applications
mv AgentDeck-1.0.1.AppImage ~/Applications/
chmod +x ~/Applications/AgentDeck-1.0.1.AppImage
~/Applications/AgentDeck-1.0.1.AppImage --no-sandbox --ozone-platform-hint=auto
```

To add "Agent Deck" to your app menu, run the optional installer from the same
download folder. It creates a `.desktop` entry pointing to your AppImage:

```bash
sh install-launcher.sh "$HOME/Applications/AgentDeck-1.0.1.AppImage"
```

Then open your app launcher and search for "Agent Deck". On first launch, select
the folder containing your repositories and pick your AI CLI in **Settings**.
Keep the AppImage at that location so the menu entry continues to work. Remove
the menu entry with `sh install-launcher.sh --uninstall`.

The current Linux launchers use `--no-sandbox`, which disables Chromium's
sandbox. `--ozone-platform-hint=auto` selects between X11 and Wayland.

**FUSE:** a normal AppImage launch needs FUSE 2. Package names include `fuse2`
on Arch, `libfuse2` on Ubuntu 22.04, `libfuse2t64` on Ubuntu 24.04 and
`fuse-libs` on Fedora. If FUSE is unavailable, run in extraction mode:

```bash
~/Applications/AgentDeck-1.0.1.AppImage --appimage-extract-and-run --no-sandbox --ozone-platform-hint=auto
```

The menu installer creates a normal FUSE-based launcher. For an extraction-only
setup, add `--appimage-extract-and-run` to its `Exec=` line, or launch using the
command above.

**Compatibility:** downloads currently target Intel/AMD x86-64 desktop Linux.
The maintainer uses Omarchy 4.0.4 (Arch), Hyprland and Wayland. Each release's
notes record its manual testing; CI also checks startup on Ubuntu 22.04 with a
virtual X11 display. Other modern distributions and desktops are expected to
work but are unverified. Older system libraries and graphics drivers can affect
compatibility. Linux ARM, macOS and Windows downloads are not provided.

**Updates:** download the next release, verify its checksums, place its AppImage
in `~/Applications/` and run the installer with the new path. Settings stay in
`~/.config/agentdeck/`. Updates are manual. You can keep older AppImages and
point the launcher back to one, subject to any config migration notes in the
release. Back up settings before a release that changes stored config.

If launch fails, run the AppImage from a terminal and include the output, app
version, distro/version, desktop and X11/Wayland session in a
[bug report](https://github.com/Once4thewin/agent-deck/issues).

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

- Git, a graphical Linux desktop and FUSE 2 (or extraction mode above).
- At least one AI CLI, installed and logged in: `claude`, `codex`, `gemini`,
  `opencode`, `kimi` or `cursor-agent`. Agent Deck starts them, it doesn't
  install them. **Settings** shows which ones it found.

Optional, per feature:

| Feature | Needs |
|---|---|
| GitHub activity tile | [`gh`](https://cli.github.com), logged in with `gh auth login` |
| Start/stop a project's Docker stack | Docker with Compose v2 and a Compose file in that repo |
| Saved database passwords | A system keyring (GNOME Keyring, KWallet, Keychain) |

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

### Linux source builds

Install [Docker](https://docs.docker.com/get-docker/) with Compose v2
(`docker compose`), Git, `make`, `curl`, `unzip` and `sha256sum`.
Then clone the repository:

```bash
git clone https://github.com/Once4thewin/agent-deck.git
cd agent-deck
make electron-dev
```

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

#### Build and test commands

All run from the repo folder.

| What | Command |
|---|---|
| Build and launch the AppImage | `./scripts/electron-package.sh` |
| Build only | `./scripts/electron-package.sh --no-start` |
| Run checkout without UI hot reload | `make electron` |
| Dev build with UI hot reload | `make electron-dev` |
| Dev build without `make` | `./scripts/electron-dev.sh` |
| Run the Go tests | `docker compose run --rm dev "apk add --no-cache git >/dev/null && go test ./..."` |
| Run the frontend tests | `cd cmd/agentdeck/static-tests && node --test *_test.js` |
| Remove build output | `make clean` |
| Remove the app menu entry | `./scripts/install-launcher.sh --uninstall` |
| Install a tagged version locally as the stable app | `./scripts/release.sh` |

#### Stable app and versions

Building from the repo puts whatever you have checked out into `./dist/`, so a
menu entry pointing there changes with every test build. Keep a downloaded
release in `~/Applications/` for daily use, or install a clean tagged checkout
locally:

```bash
git tag v1.2.0
./scripts/release.sh
```

This builds that exact commit, copies it to `~/Applications/AgentDeck-1.2.0.AppImage`
and points the "Agent Deck" menu entry at it. Later test builds and
`make electron-dev` leave it alone, and they keep their own settings: the
AppImage reads `~/.config/agentdeck/`, dev builds the repo's `config.json`.
Older versions stay in `~/Applications`; to go back, run
`./scripts/install-launcher.sh` with the older AppImage, checking any config
migration notes first. All AppImages share the packaged settings directory;
only development builds use the repo's separate settings.

Versions follow `MAJOR.MINOR.PATCH`: bug fixes raise the last number (1.2.0 ->
1.2.1), new features the middle one (1.2.1 -> 1.3.0), and breaking changes,
such as an old config no longer loading, the first (1.3.0 -> 2.0.0). Optional
config additions or automatic migrations do not by themselves require a major
version. A build that isn't a clean tagged commit is marked as a dev build, such as
`1.2.0-dev+abc1234`. The version shows in the status bar and in
`agentdeck --version`.

### macOS source builds (unverified)

Apple Silicon only. This path is unverified by the maintainer and does not
produce public release downloads. You also need Docker, Git, Node.js and npm.

```bash
git clone https://github.com/Once4thewin/agent-deck.git
cd agent-deck
make electron-package-mac   # writes a .dmg to ./dist/
```

Open the `.dmg` and drag Agent Deck to Applications. First launch works the same
as on Linux.

### Windows

No support currently.

## Publishing releases

Pushing a stable tag such as `v1.0.1` triggers the **Linux release** workflow.
It tests the tagged code, builds the AppImage, checks its startup and creates a
draft GitHub Release containing the AppImage, launcher installer and checksums.
Download and test that exact artifact on your machine, record your tested setup
in the notes and publish the draft manually.

`scripts/release.sh` only builds and installs a stable copy on the machine
running it. It does not upload or publish releases.
See [the release checklist](./docs/releases.md) for the full process.

## Caveats

- **It can run anything.** The local server runs commands, edits files and
  drives agents in your repos. It only answers requests from the app itself on
  `127.0.0.1` and refuses other websites in your browser, but don't expose it to
  a network. See [SECURITY.md](./SECURITY.md) to report a problem.
- **Custom integrations can't run scheduled jobs.** Jobs need one of the built-in
  CLIs.
- **opencode shows busy or idle only.** It doesn't report when it's waiting for
  permission.
