#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -d dist/GamePack.app ]] || bash scripts/build-macos.sh
gamepack_root="${GAMEPACK_HOME:-$HOME/.gamepack}"
[[ "$gamepack_root" == /* ]] || { printf 'GAMEPACK_HOME must be an absolute directory.\n' >&2; exit 1; }
mkdir -p "$gamepack_root/app"
/usr/bin/ditto dist/GamePack.app "$gamepack_root/app/GamePack.app"
cat > "$gamepack_root/Launch GamePack.command" <<'LAUNCH'
#!/usr/bin/env bash
set -euo pipefail
export GAMEPACK_HOME="$(cd "$(dirname "$0")" && pwd)"
open -a "$GAMEPACK_HOME/app/GamePack.app" --env "GAMEPACK_HOME=$GAMEPACK_HOME"
LAUNCH
chmod +x "$gamepack_root/Launch GamePack.command"
printf 'Installed in %s\n' "$gamepack_root"
open -a "$gamepack_root/app/GamePack.app" --env "GAMEPACK_HOME=$gamepack_root"
