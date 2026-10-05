#!/usr/bin/env sh
set -eu

log()  { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n'   "$*" >&2; exit 1; }

os="$(uname -s)"
if [ "$os" != "Linux" ]; then
	die "unsupported OS '$os' — this script installs an XDG .desktop launcher and only runs on Linux."
fi
if grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null; then
	die "detected WSL — no native GUI session to register the launcher with."
fi

# XDG .desktop files are the freedesktop standard, supported across GNOME, KDE, XFCE,
# Cinnamon, MATE, LXQt, Budgie, Pantheon, and most tiling-WM launchers (rofi, wofi,
# krunner, ulauncher). We don't gate on a specific DE — just print what we detected,
# and warn if there's no graphical session at all.
detected_de="${XDG_CURRENT_DESKTOP:-${DESKTOP_SESSION:-unknown}}"
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] && [ "$detected_de" = "unknown" ]; then
	warn "no graphical session detected — the launcher will be written, but nothing will pick it up until you log into a desktop."
fi

# Resolved before the cd below, so a relative path means the caller's folder.
given_appimage=""
if [ -n "${1:-}" ] && [ "$1" != "--uninstall" ]; then
	given_appimage="$(readlink -f "$1" 2>/dev/null || printf '%s' "$1")"
fi

cd "$(dirname "$0")/.."

APP_ID="agentdeck"
APP_NAME="Agent Deck"
APP_COMMENT="Manage multiple Git projects with integrated terminals"
# XDG spec: a relative XDG_DATA_HOME must be treated as unset. Without this
# guard, the cd above resolves it under the repo and the .desktop file lands
# somewhere no launcher will look.
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
case "$DATA_HOME" in /*) ;; *) DATA_HOME="$HOME/.local/share" ;; esac
DESKTOP_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/512x512/apps"
DESKTOP_FILE="$DESKTOP_DIR/${APP_ID}.desktop"
ICON_FILE="$ICON_DIR/${APP_ID}.png"

if [ "${1:-}" = "--uninstall" ]; then
	removed=0
	[ -e "$DESKTOP_FILE" ] && { rm -f "$DESKTOP_FILE"; removed=1; }
	[ -e "$ICON_FILE" ]    && { rm -f "$ICON_FILE";    removed=1; }
	if command -v update-desktop-database >/dev/null 2>&1; then
		update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
	fi
	if [ "$removed" = "1" ]; then
		log "Removed '$APP_NAME' launcher."
	else
		log "Nothing to remove — '$APP_NAME' launcher is not installed."
	fi
	exit 0
fi

# An AppImage given as the argument (release.sh passes the installed stable
# one); otherwise the latest build in ./dist.
appimage="$given_appimage"
if [ -n "$appimage" ]; then
	[ -f "$appimage" ] || die "no AppImage at '$appimage'."
else
	for candidate in dist/*.AppImage; do
		if [ -e "$candidate" ]; then
			appimage="$candidate"
			break
		fi
	done
	if [ -z "$appimage" ]; then
		die "no AppImage found in ./dist; run ./scripts/electron-package.sh --no-start first."
	fi
fi
appimage_abs="$(readlink -f "$appimage")"
[ -x "$appimage_abs" ] || chmod +x "$appimage_abs"

mkdir -p "$DESKTOP_DIR" "$ICON_DIR"

# Extract the embedded icon. .DirIcon at the squashfs root is a symlink to a png
# inside usr/share/icons/...; --appimage-extract only follows the literal pattern,
# so we resolve the symlink target and extract that explicitly.
icon_value="$APP_ID"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
(cd "$tmpdir" && "$appimage_abs" --appimage-extract .DirIcon >/dev/null 2>&1) || true
icon_target=""
if [ -L "$tmpdir/squashfs-root/.DirIcon" ]; then
	icon_target="$(readlink "$tmpdir/squashfs-root/.DirIcon" 2>/dev/null || true)"
elif [ -f "$tmpdir/squashfs-root/.DirIcon" ]; then
	icon_target=".DirIcon"
fi
if [ -n "$icon_target" ]; then
	(cd "$tmpdir" && "$appimage_abs" --appimage-extract "$icon_target" >/dev/null 2>&1) || true
	extracted="$tmpdir/squashfs-root/$icon_target"
	if [ -f "$extracted" ]; then
		cp "$extracted" "$ICON_FILE"
		icon_value="$ICON_FILE"
	fi
fi

# Desktop Entry spec: paths with spaces are quoted; ", `, $, \ must be backslash-escaped inside.
# shellcheck disable=SC2016  # single quotes are intentional — $ and ` are literal match patterns, not expansions.
exec_path="$(printf '%s' "$appimage_abs" | sed 's/\\/\\\\/g; s/"/\\"/g; s/`/\\`/g; s/\$/\\$/g')"

# --class pins the identity the desktop matches StartupWMClass against, and
# APP_ID is used for both so they cannot drift. On X11 that identity is WM_CLASS
# (which Electron set from the app name); under native Wayland
# (--ozone-platform-hint=auto) it is the xdg-shell app_id, which Chromium
# otherwise derives from the executable name — so without --class the window
# would stop matching StartupWMClass and show a generic, ungrouped icon.
# APP_ID is deliberately space-free: a .desktop Exec= value is re-split by the
# launcher, and only shell-style parsers keep --class="two words" as one
# argument.
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME
Comment=$APP_COMMENT
Exec="$exec_path" --no-sandbox --ozone-platform-hint=auto --class=$APP_ID %U
Icon=$icon_value
Terminal=false
Categories=Development;
StartupWMClass=$APP_ID
EOF
chmod +x "$DESKTOP_FILE"

if command -v update-desktop-database >/dev/null 2>&1; then
	update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

if [ "$icon_value" = "$ICON_FILE" ]; then
	icon_display="$ICON_FILE"
else
	icon_display="(no icon found in AppImage; using theme name '$APP_ID')"
fi

log "Installed '$APP_NAME' launcher."
log ""
log "  Desktop file  $DESKTOP_FILE"
log "  Icon          $icon_display"
log "  AppImage      $appimage_abs"
log "  Desktop env   $detected_de"
log ""
log "Press Super and search for \"$APP_NAME\"."
