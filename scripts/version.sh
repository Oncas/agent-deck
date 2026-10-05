#!/usr/bin/env sh
# Prints the version a build from this checkout gets.
#
# A clean checkout of a version tag builds that version: v1.2.3 -> 1.2.3.
# Anything else is a dev build of the last tagged version, marked with its
# commit, and with ".dirty" when there are uncommitted changes:
# 1.2.3-dev+abc1234 or 1.2.3-dev+abc1234.dirty. Before the first tag, the
# version in electron/package.json stands in for the last tag.
set -eu

cd "$(dirname "$0")/.."

dirty=""
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
	dirty=".dirty"
fi

if tag="$(git describe --tags --exact-match --match 'v[0-9]*' HEAD 2>/dev/null)" && [ -z "$dirty" ]; then
	echo "${tag#v}"
	exit 0
fi

base="$(git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD 2>/dev/null || true)"
base="${base#v}"
if [ -z "$base" ]; then
	base="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' electron/package.json)"
fi
commit="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "${base:-0.0.0}-dev+${commit}${dirty}"
