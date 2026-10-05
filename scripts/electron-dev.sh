#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

BINARY="agentdeck"
IMAGE="agentdeck-builder"
ELECTRON_VERSION="34.5.8"
ELECTRON_DIR="electron"
ELECTRON_DIST="$ELECTRON_DIR/dist"
ELECTRON_ZIP="$ELECTRON_DIR/electron-v${ELECTRON_VERSION}-linux-x64.zip"
ELECTRON_SHASUMS="$ELECTRON_DIR/SHASUMS256.txt"

need() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf 'error: %s is required\n' "$1" >&2
		exit 1
	fi
}

need docker

BUILD_COMMIT_DATE="$(git show -s --format=%cs HEAD 2>/dev/null || true)"
BUILD_VERSION="$(./scripts/version.sh)"

docker compose build \
	--build-arg "BUILD_COMMIT_DATE=${BUILD_COMMIT_DATE}" \
	--build-arg "BUILD_VERSION=${BUILD_VERSION}" \
	builder
docker rm -f "${BINARY}-extract" >/dev/null 2>&1 || true
docker create --network none --name "${BINARY}-extract" "$IMAGE" >/dev/null
docker cp "${BINARY}-extract:/agentdeck" "./${BINARY}"
docker rm "${BINARY}-extract" >/dev/null
chmod +x "./${BINARY}"

if [ ! -f "$ELECTRON_DIST/electron" ]; then
	need curl
	need sha256sum
	need unzip
	printf 'Downloading Electron v%s...\n' "$ELECTRON_VERSION"
	mkdir -p "$ELECTRON_DIST"
	curl -L -o "$ELECTRON_ZIP" "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-linux-x64.zip"
	curl -L -o "$ELECTRON_SHASUMS" "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/SHASUMS256.txt"
	(cd "$ELECTRON_DIR" && grep -E "^[0-9a-f]{64} [* ]electron-v${ELECTRON_VERSION}-linux-x64\.zip\$" SHASUMS256.txt | sha256sum -c -)
	(cd "$ELECTRON_DIST" && unzip -qo "../electron-v${ELECTRON_VERSION}-linux-x64.zip")
	rm -f "$ELECTRON_ZIP" "$ELECTRON_SHASUMS"
	printf 'Electron ready.\n'
else
	printf 'Electron already downloaded.\n'
fi

cp "./${BINARY}" "$ELECTRON_DIR/$BINARY"
AGENTDECK_DEV=1 exec "$ELECTRON_DIST/electron" --no-sandbox --ozone-platform-hint=auto "$ELECTRON_DIR/main.js" --dev "$@"
