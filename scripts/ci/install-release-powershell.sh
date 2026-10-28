#!/usr/bin/env bash
set -euo pipefail
if command -v pwsh >/dev/null; then
  pwsh -NoLogo -NoProfile -NonInteractive -Command 'if ($PSVersionTable.PSVersion.Major -lt 7) { exit 1 }'
  exit 0
fi
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { printf 'The release runtime requires an Apple silicon Mac.\n' >&2; exit 1; }
runtime="$(mktemp -d "$RUNNER_TEMP/gamepack-pwsh.XXXXXX")"
archive=powershell-7.6.9-osx-arm64.tar.gz
gh release download v7.6.9 --repo PowerShell/PowerShell --dir "$runtime" --pattern "$archive"
printf '%s  %s\n' a1c7e98ac403da4be5ba75c1c5855af272de7787a91d478c4267466fe58fc1af "$runtime/$archive" | shasum -a 256 --check -
tar -xzf "$runtime/$archive" -C "$runtime"
chmod u+x "$runtime/pwsh"
"$runtime/pwsh" -NoLogo -NoProfile -NonInteractive -Command '$PSVersionTable.PSVersion.ToString()'
echo "$runtime" >> "$GITHUB_PATH"
