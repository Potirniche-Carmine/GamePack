#!/usr/bin/env bash
set -euo pipefail
source_app="$(cd "$(dirname "$0")" && pwd)/GamePack.app"
launch=1
for argument in "$@"; do
  case "$argument" in
    --no-launch) launch=0 ;;
    --*) printf 'Unknown option: %s\n' "$argument" >&2; exit 1 ;;
    *) source_app="$argument" ;;
  esac
done
gamepack_root="${GAMEPACK_HOME:-$HOME/.gamepack}"
[[ "$gamepack_root" == /* ]] || { printf 'GAMEPACK_HOME must be an absolute directory.\n' >&2; exit 1; }
[[ -f "$source_app/Contents/Info.plist" && -x "$source_app/Contents/MacOS/GamePack" ]] || { printf 'The GamePack app bundle is incomplete.\n' >&2; exit 1; }
if pgrep -x GamePack >/dev/null; then
  printf 'Quit GamePack, then run the installer again.\n' >&2
  exit 1
fi
codesign --verify --deep --strict "$source_app"
mkdir -p "$gamepack_root/app"
installation="$(mktemp -d "$gamepack_root/app/.install.XXXXXX")"
destination="$gamepack_root/app/GamePack.app"
committed=0
cleanup() {
  result=$?
  trap - EXIT
  if [[ "$committed" != 1 && -d "$installation/previous.app" ]]; then
    rm -rf "$destination"
    if ! mv "$installation/previous.app" "$destination"; then
      printf 'Could not restore the previous app. It is saved in %s/previous.app\n' "$installation" >&2
      exit 1
    fi
  fi
  rm -rf "$installation"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Stage and verify the complete replacement before touching the installed app.
# Replacing the bundle also removes files that disappeared in a newer version.
ditto "$source_app" "$installation/GamePack.app"
codesign --verify --deep --strict "$installation/GamePack.app"
cat > "$installation/Launch GamePack.command" <<'LAUNCH'
#!/usr/bin/env bash
set -euo pipefail
export GAMEPACK_HOME="$(cd "$(dirname "$0")" && pwd)"
open -a "$GAMEPACK_HOME/app/GamePack.app" --env "GAMEPACK_HOME=$GAMEPACK_HOME"
LAUNCH
chmod +x "$installation/Launch GamePack.command"
if [[ -e "$destination" ]]; then mv "$destination" "$installation/previous.app"; fi
mv "$installation/GamePack.app" "$destination"
mv "$installation/Launch GamePack.command" "$gamepack_root/Launch GamePack.command"
committed=1
printf 'Installed GamePack in %s\n' "$gamepack_root"
if [[ "$launch" == 1 ]]; then open -a "$destination" --env "GAMEPACK_HOME=$gamepack_root"; fi
