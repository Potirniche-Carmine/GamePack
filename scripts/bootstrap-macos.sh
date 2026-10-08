#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/macos-env.sh
if [[ "$(uname -s)" != Darwin ]]; then echo 'This installer requires macOS.' >&2; exit 1; fi
if ! xcodebuild -version >/dev/null 2>&1; then
  echo 'Install Xcode from the Mac App Store, open it once, then run this script again.' >&2
  open 'macappstore://apps.apple.com/app/xcode/id497799835'
  exit 1
fi
if ! command -v brew >/dev/null 2>&1; then
  echo 'Installing Homebrew for build dependencies…'
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"; else eval "$(/usr/local/bin/brew shellenv)"; fi
fi
if ! gamepack_has_supported_node; then
  brew install node@22
  export PATH="$(brew --prefix node@22)/bin:$PATH"
fi
gamepack_has_supported_node || { echo 'Node 20.19.4 or newer is required.' >&2; exit 1; }
command -v pod >/dev/null 2>&1 || brew install cocoapods
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  source "$HOME/.cargo/env"
fi
npm ci
pod install --project-directory=macos
printf '\nDependencies ready. Run bash scripts/install-macos.sh to build and install.\n'
