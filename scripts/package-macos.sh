#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -d dist/GamePack.app ]] || bash scripts/build-macos.sh
arch="${GAMEPACK_PACKAGE_ARCH:-$(uname -m)}"
[[ "$arch" != x86_64 ]] || arch=x64
case "$arch" in arm64|x64) ;; *) printf 'Unsupported Mac architecture: %s\n' "$arch" >&2; exit 1 ;; esac
native_arch="$arch"
[[ "$native_arch" != x64 ]] || native_arch=x86_64
[[ "$(lipo -archs dist/GamePack.app/Contents/MacOS/GamePack)" == "$native_arch" ]] || { printf 'App CPU architecture does not match the package name.\n' >&2; exit 1; }
codesign --verify --deep --strict dist/GamePack.app
stage="$PWD/dist/package-macos-$arch"
mkdir -p "$stage" dist/packages
/usr/bin/ditto dist/GamePack.app "$stage/GamePack.app"
node scripts/collect-notices.mjs "$stage/Notices"
cat > "$stage/Install.command" <<'INSTALL'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
gamepack_root="${GAMEPACK_HOME:-$HOME/.gamepack}"
mkdir -p "$gamepack_root/app"
/usr/bin/ditto GamePack.app "$gamepack_root/app/GamePack.app"
/usr/bin/ditto Notices "$gamepack_root/app/Notices"
cat > "$gamepack_root/Launch GamePack.command" <<'LAUNCH'
#!/usr/bin/env bash
export GAMEPACK_HOME="$(cd "$(dirname "$0")" && pwd)"
open -a "$GAMEPACK_HOME/app/GamePack.app" --env "GAMEPACK_HOME=$GAMEPACK_HOME"
LAUNCH
chmod +x "$gamepack_root/Launch GamePack.command"
printf 'Installed GamePack in %s\n' "$gamepack_root"
open -a "$gamepack_root/app/GamePack.app" --env "GAMEPACK_HOME=$gamepack_root"
INSTALL
chmod +x "$stage/Install.command"
cat > "$stage/README.txt" <<'NOTICE'
GamePack — native offline video review

Requires macOS 14 or later and the matching CPU architecture.
Double-click Install.command to put the app and library together in ~/.gamepack.
Open ~/.gamepack/Launch GamePack.command to launch it later.
To choose another location: GAMEPACK_HOME=/absolute/folder ./Install.command

No Node, Rust, CocoaPods, Metro, or server is needed to run this release.
This open-source MVP is ad-hoc signed, not Apple-notarized. macOS may require
approval in System Settings > Privacy & Security before opening a downloaded build.
ZIP interchange is not implemented. The Import ZIP/Export ZIP controls are disabled.
Removing the application does not remove your video library or comments.

Source and verification: https://github.com/Potirniche-Carmine/GamePack
NOTICE
COPYFILE_DISABLE=1 tar -czf "dist/packages/GamePack-macos-$arch.tar.gz" -C "$stage" GamePack.app Install.command README.txt Notices
(cd dist/packages && shasum -a 256 "GamePack-macos-$arch.tar.gz" > "GamePack-macos-$arch.tar.gz.sha256")
printf 'Package: dist/packages/GamePack-macos-%s.tar.gz\n' "$arch"
