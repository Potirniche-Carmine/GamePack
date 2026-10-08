#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v cargo >/dev/null 2>&1 || source "$HOME/.cargo/env"
[[ -d node_modules ]] || npm ci
[[ -d macos/Pods ]] || pod install --project-directory=macos
cargo build --release --locked -p gamepack-core
npm run typecheck
mkdir -p artifacts/local
xcodebuild -workspace macos/gamepack.xcworkspace -scheme gamepack-macOS -configuration Release \
  -derivedDataPath build/macos -jobs "${GAMEPACK_BUILD_JOBS:-8}" CODE_SIGNING_ALLOWED=NO build \
  > artifacts/local/macos-build.log 2>&1 || { tail -80 artifacts/local/macos-build.log; exit 1; }
mkdir -p dist
/usr/bin/ditto build/macos/Build/Products/Release/GamePack.app dist/GamePack.app
codesign --force --deep --sign - dist/GamePack.app
printf '\nBuilt %s/dist/GamePack.app (JavaScript and Rust embedded; no runtime server).\n' "$PWD"
