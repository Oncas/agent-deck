#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

open_dmg=1
if [ "${1:-}" = "--no-open" ]; then
	open_dmg=0
	shift
fi

case "$(uname -s)" in
	Darwin) ;;
	*)
		echo "electron-package-mac.sh must run on macOS (electron-builder produces .dmg natively)" >&2
		exit 1
		;;
esac

BUILD_COMMIT_DATE="$(git show -s --format=%cs HEAD 2>/dev/null || true)"
GO_ARCH="$(uname -m | sed 's/x86_64/amd64/')"

# Cross-compile darwin Go binary inside the existing builder image.
docker compose build \
	--build-arg "BUILD_COMMIT_DATE=${BUILD_COMMIT_DATE}" \
	--build-arg "GO_OS=darwin" \
	--build-arg "GO_ARCH=${GO_ARCH}" \
	builder

extract_name="agentdeck-extract-mac-$$"
docker create --name "$extract_name" agentdeck-builder >/dev/null
trap 'docker rm "$extract_name" >/dev/null 2>&1 || true' EXIT
docker cp "$extract_name:/agentdeck" ./electron/agentdeck
chmod +x ./electron/agentdeck

cd electron
[ -d node_modules ] || npm install
rm -rf dist
npx electron-builder --mac dmg

dmg=""
for candidate in dist/*.dmg; do
	if [ -e "$candidate" ]; then
		dmg="$candidate"
		break
	fi
done
if [ -z "$dmg" ]; then
	echo "No .dmg found in ./electron/dist" >&2
	exit 1
fi

ls -lh "$dmg"

if [ "$open_dmg" -eq 1 ]; then
	open "$dmg"
fi
