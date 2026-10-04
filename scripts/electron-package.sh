#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

start_app=1
if [ "${1:-}" = "--no-start" ]; then
	start_app=0
	shift
fi

BUILD_COMMIT_DATE="$(git show -s --format=%cs HEAD 2>/dev/null || true)"
mkdir -p dist
rm -f dist/*.AppImage

docker compose build --build-arg "BUILD_COMMIT_DATE=${BUILD_COMMIT_DATE}" electron-builder
# Run as the invoking user so the AppImage in ./dist/ is not root-owned.
docker compose run --rm --user "$(id -u):$(id -g)" electron-builder

appimage=""
for candidate in dist/*.AppImage; do
	if [ -e "$candidate" ]; then
		appimage="$candidate"
		break
	fi
done
if [ -z "$appimage" ]; then
	echo "No AppImage found in ./dist" >&2
	exit 1
fi

chmod +x "$appimage"
ls -lh "$appimage"

if [ "$start_app" -eq 1 ]; then
	# Prepended, not conditional on "$#": passing any extra flag must not drop
	# --no-sandbox (the AppImage will not start at all where unprivileged user
	# namespaces are restricted). Caller args come last so they win on conflict.
	# --ozone-platform-hint must arrive on argv: Ozone selects its backend
	# before main.js runs, so setting it in-app has no effect.
	set -- --no-sandbox --ozone-platform-hint=auto "$@"
	exec "$appimage" "$@"
fi
