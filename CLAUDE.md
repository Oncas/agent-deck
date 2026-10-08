# Agent Deck

Desktop app for managing multiple Git projects with integrated terminals.
Go backend + Electron frontend. Supports pluggable AI CLIs (Claude, OpenAI
Codex, Gemini) selectable from the settings UI.

## Build & Run

All builds happen in Docker — no local Go toolchain needed.

- Build Go binary:

  ```bash
  BUILD_COMMIT_DATE="$(git show -s --format=%cs HEAD 2>/dev/null || true)" && \
    BUILD_VERSION="$(./scripts/version.sh)" && \
    docker compose build --build-arg BUILD_COMMIT_DATE="$BUILD_COMMIT_DATE" \
      --build-arg BUILD_VERSION="$BUILD_VERSION" builder && \
    docker create --name agentdeck-extract agentdeck-builder && \
    docker cp agentdeck-extract:/agentdeck ./agentdeck && \
    docker rm agentdeck-extract && \
    chmod +x ./agentdeck
  ```

- Versions come from git tags (`v1.2.0`) through `scripts/version.sh`; anything
  but a clean tagged checkout builds as `<last tag>-dev+<commit>`. Every build
  path passes it as the `BUILD_VERSION` build arg, next to `BUILD_COMMIT_DATE`.
- Run with Electron (dev): `make electron` (builds binary + downloads Electron + launches)
- Run with Electron + static UI hot reload: `make electron-dev`
- No-`make` hot-reload equivalent: `./scripts/electron-dev.sh`
- Package AppImage and launch it with `--no-sandbox`: `./scripts/electron-package.sh` (outputs to `./dist/`)
- Package without launching: `./scripts/electron-package.sh --no-start`
- Install the version tagged at HEAD as the stable app: `./scripts/release.sh`
  (builds it, copies it to `~/Applications/AgentDeck-<version>.AppImage` and
  points the menu entry there; refuses untagged or uncommitted checkouts)
- Go mod tidy: `docker compose run --rm dev "go mod tidy"`
- Clean all: `make clean`

Public Linux x86-64 downloads are built by `.github/workflows/release.yml` when
a stable `vMAJOR.MINOR.PATCH` tag is pushed. It tests and smoke-checks the actual
AppImage, then creates a draft release for manual testing and publication.
`release.sh` remains a local installer and does not publish anything. See
`docs/releases.md` for versioning and the maintainer checklist. Packaging uses
`npm ci` with `electron/package-lock.json`; keep the lockfile in sync when
changing dependencies.

Note: If `make` is not installed, run the docker compose commands from the Makefile manually.

## Architecture

```text
cmd/agentdeck/
  main.go              # Entry point (flag parsing, server startup)
  static/              # Embedded web UI (index.html, app.js, style.css)
internal/
  server/
    server.go          # HTTP server setup, mux routing
    api.go             # REST API handlers
    websocket.go       # WebSocket handler for PTY terminal streaming
    git.go             # Git CLI integration (status, pull, diff)
  config/config.go     # JSON config load/save
  pty/
    manager.go         # PTY session manager (create/get/restart sessions)
    session.go         # Individual PTY session (fork/exec, I/O streaming)
  scanner/scanner.go   # Project directory discovery (finds .git dirs)
electron/
  main.js              # Electron app — spawns Go binary as child process
  preload.js           # IPC bridge for opening external URLs
  package.json         # Electron-builder config
```

## Key Dependencies

- `github.com/creack/pty` — PTY management for terminal sessions
- `nhooyr.io/websocket` — WebSocket server for terminal I/O
- Frontend runtime assets are vendored under `cmd/agentdeck/static/vendor/`

## API Endpoints

- `GET /ws/{name}` — WebSocket terminal stream (binary: keyboard input, text: JSON resize commands)
- `GET /api/projects` — List projects with pin status
- `GET /api/projects/{name}/status` — Git status (branch, ahead/behind, changes).
  `?base=trunk` compares the working tree against the `main`/`master` fork point
  instead of HEAD, so committed branch work is listed too, and returns the
  resolved `diff_base` commit. Diff reads (`/file`, `/file/blob`) accept that
  commit as `?base=<sha>` to move the original side of the diff onto it.
- `POST /api/projects/{name}/pull` — Git pull
- `POST /api/projects/{name}/pin` — Toggle pin
- `GET /api/projects/{name}/diff` — File diff
- `GET /api/github/activity/today`, `GET /api/gitlab/activity/today` - This
  user's contribution counts for today on GitHub or GitLab (merge requests are
  counted as `pull_requests`). The `activity_provider` setting picks which one
  the right panel shows.
- `GET /api/claude/usage` / `GET /api/codex/usage` — Estimated API cost, conversations
  and messages for today, this week and this month, from `~/.claude/projects`
  (or `$CLAUDE_CONFIG_DIR`) and `~/.codex/sessions`. Cached for 5 minutes;
  `?fresh=1` reloads, `?tz=` sets the day boundaries. Both include `limits`
  (5-hour and weekly windows) for subscription logins. Both are read live from
  the undocumented endpoints behind the CLIs' own `/usage` and `/status`, with
  the login each CLI saved: Anthropic's `/api/oauth/usage` with the token in
  `.credentials.json`, and ChatGPT's `/backend-api/wham/usage` with the one in
  `~/.codex/auth.json`. Codex also logs the windows with each reply, but only
  while it talks to OpenAI directly (through a custom model provider they are
  empty), so those logs are just the fallback. Tokens are never refreshed here;
  when a fetch fails, the last reading is returned with its original
  `observed_at`.
- `GET /api/sessions/status` — Agent state per session (`busy|waiting|shell|idle|unknown`)
- `GET /api/power` — Whether the machine should be kept awake, and why
- `GET|POST /api/config` — Configuration
- `POST /api/projects/{name}/restart` — Restart PTY session
- `POST /api/rescan` — Re-scan projects directory
- `GET|POST /api/workspaces`, `PATCH|DELETE /api/workspaces/{id}` — Named
  multi-project workspaces. Each has one terminal session, `workspace:<id>`,
  started in its fixed `working_directory` (a leading `~/` is expanded); the
  tracked `projects` and `active_project` choose what the Git panel shows, and
  Claude sessions start with an `--add-dir` for each tracked checkout
  (`workspaceAddDirs`). `POST /api/workspaces/{id}/terminal/{start,stop}` and
  `GET .../terminal/output` control that session, and `/ws/workspace:<id>`
  attaches to it.

Every request passes `localRequestsOnly` (`internal/server/local_requests.go`)
first: the `Host` must be loopback, `Sec-Fetch-Site` must be `same-origin` or
`none`, and state-changing requests may only carry the app's own `Origin`. A web
page in any browser on the machine can reach `127.0.0.1`, so loopback binding
alone does not protect the terminal and file endpoints. New routes are covered
automatically; don't add CORS headers.

## Configuration

`config.json` at project root for development builds. The AppImage reads
`$XDG_CONFIG_HOME/agentdeck/config.json` (default `~/.config/agentdeck/`), so a
packaged build and a dev build never share settings or scheduled jobs; see
`getConfigPath` in `electron/main.js`. `databases.json`, `saved-queries/` and
`.agentdeck/job-logs/` live next to whichever config is in use.

```json
{
  "scan_paths": ["/home/user/projects", "/home/user/personal-projects"],
  "extra_projects": ["/path/to/project"],
  "pinned_projects": ["project-name"],
  "cli": "claude",
  "activity_provider": "github"
}
```

## Code Conventions

- Standard Go project layout (`cmd/`, `internal/`)
- No linter config — use default `go vet`
- Frontend tests live in `cmd/agentdeck/static-tests/` (run with
  `node --test *_test.js` there), outside `static/`, so `//go:embed static`
  doesn't ship them in the binary.
- Static assets embedded in the binary (served from `cmd/agentdeck/static/`);
  `make electron-dev` serves that directory from disk and reloads the renderer
  when static files change.
- Frontend: vanilla JS, no build step, theme files in
  `cmd/agentdeck/static/themes/*.json`
- When removing frontend DOM that `app.js` references, first make the JS
  tolerant of missing optional nodes with optional chaining or null guards, then
  remove the HTML and command/keymap entry points. This avoids dev hot-reload
  crashes where a removed element causes startup-time `null` dereferences and
  blanks the UI.
- CLI selection: `cli` config field (`claude` default, `openai`, `gemini`,
  `opencode`, `kimi`, `cursor`). Command mapping lives in `internal/pty/cli.go`.
  Applies to newly started PTY sessions — restart a project to pick up a change.
- Scheduled jobs run the same `cli` one-shot, through `JobCommand` in
  `internal/pty/cli.go` (`claude -p`, `codex exec`, `opencode run`, …), resolved
  at each run. Custom integrations only define an interactive command, so a job
  fails with an error while one is selected.

## GitHub and GitLab activity

The activity tile shells out to the `gh` or `glab` CLI (`forgeCLI` in
`internal/server/forge.go`), so it uses whatever account `gh auth login` or
`glab auth login` established - no token lives in this app's config. Each CLI
gets only its own login, host and proxy variables from the environment.
`GET /api/capabilities` reports `gh` and `glab` under `dependencies`.

`activity_provider` is `github`, `gitlab` or empty (off); a config that still
has the old `show_github_activity: true` loads as `github`.

GitHub: reads `gh api /users/<login>/events --paginate` and counts the events
that land on the local day. The events feed takes no date filter and holds at
most 300 events over 90 days, which is plenty for "today".

GitLab: reads `glab api events --paginate`, the signed-in user's own events,
asking the server for a few days around today and keeping the local day.
`gitlab_host` selects a self-managed instance and is passed as `--hostname`;
empty leaves glab to its own default (`GITLAB_HOST`, else gitlab.com).

## Usage tracking

The right panel's usage box and its Settings rows are built from
`USAGE_PROVIDERS` in `app.js`; the backend routes and caches from
`usageProviders` in `internal/server/usage.go`. To add a provider:

1. Write a loader that reads the CLI's logs into a `usageResponse`, using
   `usageAccumulator` for the per-period totals, and list it in
   `usageProviders`.
2. Add a `USAGE_PROVIDERS` entry with the same id.
3. Add `show_<id>_usage`, `<id>_billing` and `<id>_monthly_budget` to
   `config.Config` and the config PATCH payload in `api.go`.

`static-tests/app_wiring_test.js` fails if any of the three is missing.

## opencode status

opencode publishes no per-session state file, so `StatusProbe` infers its state
from terminal output: bytes within `opencodeBusyWindow` mean `busy`, silence
means `idle`. The TUI emits nothing while idle, which is what makes this
readable. The fallback runs only after the Claude and Codex branches decline,
and only for sessions whose stored CLI is `opencode`, so a plain shell streaming
build logs is never mistaken for a working agent.

There is no `waiting` state — opencode exposes no permission-wait signal — so
opencode panes show busy or idle only.

## Icons

Icons are inline SVGs, not an icon font or external library. They live in the
`ICONS` map in `cmd/agentdeck/static/icons.js` (Lucide-style: 24x24
viewBox, `stroke-width="2"`, `currentColor`, rounded caps/joins). Each entry maps
a name to the SVG inner paths only — `iconHTML()` wraps them in the `<svg>`.

To use an icon in markup, add `<span data-icon="name"></span>`; `hydrateIcons()`
replaces it with the SVG on load. To add a new icon, paste its inner paths as a
new `ICONS` entry, keeping the Lucide conventions so it matches the existing set.

- Source for new icons: [Lucide](https://lucide.dev) (ISC license), so every
  icon stays redistributable. Paste the inner paths of the Lucide SVG unchanged;
  its license ships as `static/LICENSE-lucide.txt`.

## Docker Services

- `builder` — Multi-stage Go build (Alpine + Go 1.24)
- `dev` — Development shell with Go toolchain and volume mounts
- `electron` — X11-forwarded Electron runtime
- `electron-builder` — AppImage packaging (Node 20 + electron-builder)
