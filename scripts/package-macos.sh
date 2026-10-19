#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/ci/check-version.mjs
[[ -d dist/GamePack.app ]] || bash scripts/build-macos.sh
arch="${GAMEPACK_PACKAGE_ARCH:-$(uname -m)}"
[[ "$arch" != x86_64 ]] || arch=x64
case "$arch" in arm64|x64) ;; *) printf 'Unsupported Mac architecture: %s\n' "$arch" >&2; exit 1 ;; esac
native_arch="$arch"
[[ "$native_arch" != x64 ]] || native_arch=x86_64
[[ "$(lipo -archs dist/GamePack.app/Contents/MacOS/GamePack)" == "$native_arch" ]] || { printf 'App CPU architecture does not match the package name.\n' >&2; exit 1; }
[[ -x dist/GamePack.app/Contents/Helpers/GamePackUpdateHelper ]] || { printf 'The trusted update helper is missing; rebuild the app.\n' >&2; exit 1; }
[[ "$(lipo -archs dist/GamePack.app/Contents/Helpers/GamePackUpdateHelper)" == "$native_arch" ]] || { printf 'Update helper CPU architecture does not match the package name.\n' >&2; exit 1; }
codesign --verify --strict dist/GamePack.app/Contents/Helpers/GamePackUpdateHelper
codesign --verify --deep --strict dist/GamePack.app
version="$(node -p "require('./package.json').version")"
app_version="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' dist/GamePack.app/Contents/Info.plist)"
[[ "$app_version" == "$version" ]] || { printf 'App version does not match package.json; rebuild the app.\n' >&2; exit 1; }
stage="$PWD/dist/package-macos-$arch"
rm -rf "$stage"
mkdir -p "$stage" dist/packages
/usr/bin/ditto dist/GamePack.app "$stage/GamePack.app"
node scripts/collect-notices.mjs "$stage/GamePack.app/Contents/Resources/Notices"
cp scripts/macos/install-app.sh "$stage/Install.command"
# Notices are part of the installed app, so verify the final signed bundle.
codesign --force --deep --sign - "$stage/GamePack.app"
codesign --verify --deep --strict "$stage/GamePack.app"
chmod +x "$stage/Install.command"
cat > "$stage/README.txt" <<'NOTICE'
GamePack — native offline video review

Requires macOS 14 or later and the matching CPU architecture.
Quit GamePack if it is running, then double-click Install.command to put the app and library together in ~/.gamepack.
Open ~/.gamepack/Launch GamePack.command to launch it later.
To choose another location: GAMEPACK_HOME=/absolute/folder ./Install.command

No Node, Rust, CocoaPods, Metro, or server is needed to run this release.
This build is ad-hoc signed, not Apple-notarized. macOS may require
approval in System Settings > Privacy & Security before opening a downloaded build.
ZIP library exchange is not included in this version.
Removing the application does not remove your video library or comments.

Source and verification: https://github.com/Potirniche-Carmine/GamePack
NOTICE
COPYFILE_DISABLE=1 tar -czf "dist/packages/GamePack-macos-$arch.tar.gz" -C "$stage" GamePack.app Install.command README.txt
(cd dist/packages && shasum -a 256 "GamePack-macos-$arch.tar.gz" > "GamePack-macos-$arch.tar.gz.sha256")
printf 'Package: dist/packages/GamePack-macos-%s.tar.gz\n' "$arch"
