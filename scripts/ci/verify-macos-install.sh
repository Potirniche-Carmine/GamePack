#!/usr/bin/env bash
set -euo pipefail
[[ $# == 2 ]] || { printf 'Usage: verify-macos-install.sh <archive.tar.gz> <temporary-directory>\n' >&2; exit 1; }
archive="$1"
verification="$2"
[[ "$verification" == /* && ! -e "$verification" ]] || { printf 'Use a new absolute verification directory.\n' >&2; exit 1; }
mkdir -p "$verification/package" "$verification/library"
tar -xzf "$archive" -C "$verification/package"
export GAMEPACK_HOME="$verification/library"
printf 'existing library data\n' > "$GAMEPACK_HOME/library-fixture.txt"
cp "$GAMEPACK_HOME/library-fixture.txt" "$verification/expected-library.txt"
for attempt in 1 2; do
  bash "$verification/package/Install.command" --no-launch
  codesign --verify --deep --strict "$GAMEPACK_HOME/app/GamePack.app"
  test -s "$GAMEPACK_HOME/app/GamePack.app/Contents/Resources/Notices/manifest.json"
  test -x "$GAMEPACK_HOME/Launch GamePack.command"
  cmp "$verification/expected-library.txt" "$GAMEPACK_HOME/library-fixture.txt"
  test ! -e "$GAMEPACK_HOME/app/GamePack.app/obsolete-resource.txt"
  if [[ "$attempt" == 1 ]]; then
    # Model a resource present in an older app but absent from the new package.
    printf 'old app resource\n' > "$GAMEPACK_HOME/app/GamePack.app/obsolete-resource.txt"
  fi
done
printf 'Packaged installation and replacement verified.\n'
