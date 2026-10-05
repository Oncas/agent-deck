#!/usr/bin/env sh
# Builds the version tagged at HEAD and installs it as the stable app: the
# AppImage is copied to ~/Applications and the "Agent Deck" menu entry is
# pointed at it. Test builds in ./dist (electron-package.sh) and dev builds
# (make electron-dev) never replace it.
#
#   git tag v1.2.0
#   ./scripts/release.sh
#
# Set AGENTDECK_INSTALL_DIR to install somewhere other than ~/Applications.
# Older versions there are kept, so going back is a matter of running
# install-launcher.sh with the older AppImage.
set -eu

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."

[ "$(uname -s)" = "Linux" ] || die "release.sh installs the Linux AppImage; on macOS use make electron-package-mac."

# A release is exactly a tagged commit, so it can always be rebuilt and the
# version in the app says which code it is.
if [ -n "$(git status --porcelain)" ]; then
	die "there are uncommitted changes. Commit or stash them first."
fi
version="$(./scripts/version.sh)"
case "$version" in
*-dev*)
	die "HEAD has no version tag. Tag it first, e.g.: git tag v1.2.0"
	;;
esac

install_dir="${AGENTDECK_INSTALL_DIR:-$HOME/Applications}"
target="$install_dir/AgentDeck-$version.AppImage"

log "Building Agent Deck $version..."
./scripts/electron-package.sh --no-start
built="dist/AgentDeck-$version.AppImage"
[ -f "$built" ] || die "the build did not produce $built."

# Copied under a temporary name and renamed into place, so a running copy of
# the same version keeps working.
mkdir -p "$install_dir"
cp "$built" "$target.tmp"
chmod +x "$target.tmp"
mv -f "$target.tmp" "$target"

./scripts/install-launcher.sh "$target"
log ""
log "Agent Deck $version is now the stable app: $target"
