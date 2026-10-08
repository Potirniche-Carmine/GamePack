#!/usr/bin/env bash
# Sourced by the source-build scripts; release installs do not need this environment.
gamepack_has_supported_node() {
  command -v node >/dev/null 2>&1 && node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&(b>19||(b===19&&c>=4)))?0:1)' >/dev/null 2>&1
}
if ! command -v brew >/dev/null 2>&1; then
  for gamepack_brew in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$gamepack_brew" ]]; then
      export PATH="$(dirname "$gamepack_brew"):$PATH"
      break
    fi
  done
fi
if ! gamepack_has_supported_node; then
  for gamepack_node_dir in /opt/homebrew/opt/node@22/bin /usr/local/opt/node@22/bin; do
    if [[ -x "$gamepack_node_dir/node" ]]; then
      export PATH="$gamepack_node_dir:$PATH"
      break
    fi
  done
fi
