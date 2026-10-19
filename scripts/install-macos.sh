#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
build=1
launch=1
for argument in "$@"; do
  case "$argument" in
    --no-build) build=0 ;;
    --no-launch) launch=0 ;;
    *) printf 'Usage: bash scripts/install-macos.sh [--no-build] [--no-launch]\n' >&2; exit 1 ;;
  esac
done
if [[ "$build" == 1 ]]; then bash scripts/build-macos.sh; fi
if [[ "$launch" == 1 ]]; then
  bash scripts/macos/install-app.sh "$PWD/dist/GamePack.app"
else
  bash scripts/macos/install-app.sh "$PWD/dist/GamePack.app" --no-launch
fi
