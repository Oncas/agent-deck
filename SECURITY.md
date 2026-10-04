# Security Policy

## Scope

Agent Deck is a local developer tool. Treat the HTTP server, Electron shell,
terminal sessions, project file editor, Docker controls, and saved configuration
as trusted-user surfaces on the same workstation.

## Local Access

The server should listen on loopback by default. Only bind it to a non-loopback
host when you understand that project files, terminal commands, git operations,
Docker controls, and saved connection settings may become reachable from other
machines on the network.

## Secrets

`config.json` can contain database passwords, project paths, saved commands, and
other local workflow details. Keep it out of git and avoid sharing diagnostic
bundles that include it. The app writes this file with owner-only permissions
where supported by the host filesystem.

## Destructive Actions

The app can run shell commands, edit files, delete files, revert git changes,
control Docker services, and start AI coding agents with elevated permission
flags. Review prompts, project paths, and saved commands before running them in
repositories that contain production credentials or unreleased work.

## Third-Party Downloads

Electron runtime downloads should be verified against Electron release
checksums before extraction. Frontend runtime assets are vendored into the
static bundle so the app does not depend on public CDNs at runtime.

## Reporting

Do not include secrets, private repository contents, database dumps, or terminal
logs in public reports. Share the smallest reproduction, the affected version or
commit, and the exact local action needed to trigger the issue.
