#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/gamepack-updater.XXXXXX")"
trap 'rm -rf "$test_directory"' EXIT
harness="${GAMEPACK_UPDATE_HARNESS:-$test_directory/GPUpdateHarness}"
xcrun clang++ -std=c++17 -fobjc-arc -mmacosx-version-min=14.0 -Wno-deprecated-declarations \
  native/macos/GPUpdateSupport.mm tests/macos-update-harness.mm \
  -framework Foundation -framework AppKit -framework Security -framework CoreServices -lz -o "$harness"
node scripts/ci/test-macos-updater.mjs "$harness" "$test_directory" "$@"
xcrun clang++ -std=c++17 -fobjc-arc -mmacosx-version-min=14.0 -Wno-deprecated-declarations \
  native/macos/GPUpdateSupport.mm tests/macos-update-network.mm \
  -framework Foundation -framework AppKit -framework Security -framework CoreServices -lz -o "$test_directory/network-tests"
"$test_directory/network-tests"
xcrun clang++ -std=c++17 tests/update-archive-limits.test.cpp -o "$test_directory/archive-limits"
"$test_directory/archive-limits"
