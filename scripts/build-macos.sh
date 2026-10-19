#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/macos-env.sh
macos_sdk="$(xcrun --sdk macosx --show-sdk-version)"
[[ "${macos_sdk%%.*}" -ge 26 ]] || { echo 'Building GamePack requires Xcode 26 or newer (macOS 26 SDK).' >&2; exit 1; }
gamepack_has_supported_node || { echo 'Run bash scripts/bootstrap-macos.sh to install a supported Node version.' >&2; exit 1; }
command -v cargo >/dev/null 2>&1 || source "$HOME/.cargo/env"
node scripts/ci/check-version.mjs
# A checkout can change dependency locks while these directories still exist.
# CI has already installed and verified both graphs before invoking this script.
if [[ "${GAMEPACK_SKIP_DEPENDENCIES:-0}" != 1 ]]; then
  npm ci --prefer-offline --no-audit --no-fund
  bundle config set --local path vendor/bundle
  BUNDLE_FROZEN=true bundle check || BUNDLE_FROZEN=true bundle install
  bundle exec pod install --project-directory=macos
else
  [[ -d node_modules && -d macos/Pods ]] || { echo 'Install locked JavaScript and CocoaPods dependencies before skipping setup.' >&2; exit 1; }
fi
# The offline notice collector resolves the complete target dependency graph,
# including metadata for test dependencies when CI has skipped local tests.
cargo fetch --locked --target "$(rustc -vV | sed -n 's/^host: //p')"
MACOSX_DEPLOYMENT_TARGET=14.0 cargo build --release --locked -p gamepack-core
if [[ "${GAMEPACK_SKIP_TESTS:-0}" != 1 ]]; then
  npm run typecheck
  npm run test:ui
fi
mkdir -p artifacts/local
xcode_options=(CODE_SIGNING_ALLOWED=NO "ARCHS=$(uname -m)" ONLY_ACTIVE_ARCH=YES)
if [[ "${GAMEPACK_CCACHE:-0}" == 1 ]]; then
  compiler_cache="$(command -v ccache)"
  # Xcode's compiler launchers receive the real compiler as their first argument.
  xcode_options+=("C_COMPILER_LAUNCHER=$compiler_cache" "CXX_COMPILER_LAUNCHER=$compiler_cache" CLANG_ENABLE_EXPLICIT_MODULES=NO)
fi
# Metro copies assets incrementally; clear stale raster files before bundling.
rm -rf build/macos/Build/Products/Release/GamePack.app/Contents/Resources/assets
xcodebuild -workspace macos/gamepack.xcworkspace -scheme gamepack-macOS -configuration Release \
  -derivedDataPath build/macos -jobs "${GAMEPACK_BUILD_JOBS:-8}" "${xcode_options[@]}" build \
  > artifacts/local/macos-build.log 2>&1 || { tail -80 artifacts/local/macos-build.log; exit 1; }
mkdir -p dist
rm -rf dist/GamePack.app
/usr/bin/ditto build/macos/Build/Products/Release/GamePack.app dist/GamePack.app
mkdir -p dist/GamePack.app/Contents/Helpers
xcrun clang++ -std=c++17 -fobjc-arc -mmacosx-version-min=14.0 -Wno-deprecated-declarations \
  native/macos/GPUpdateSupport.mm native/macos/GPUpdateHelper.mm \
  -framework Foundation -framework AppKit -framework Security -framework CoreServices -lz \
  -o dist/GamePack.app/Contents/Helpers/GamePackUpdateHelper
codesign --force --sign - dist/GamePack.app/Contents/Helpers/GamePackUpdateHelper
codesign --force --deep --sign - dist/GamePack.app
printf '\nBuilt %s/dist/GamePack.app (JavaScript and Rust embedded; no runtime server).\n' "$PWD"
