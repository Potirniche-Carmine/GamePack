#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/ci/check-version.mjs
app_source="${GAMEPACK_MACOS_APP_SOURCE:-$PWD/dist/GamePack.app}"
[[ "$app_source" = /* ]] || { printf 'GAMEPACK_MACOS_APP_SOURCE must be an absolute app path.\n' >&2; exit 1; }
if [[ ! -d "$app_source" ]]; then
  [[ -z "${GAMEPACK_MACOS_APP_SOURCE:-}" ]] || { printf 'The provided app source does not exist.\n' >&2; exit 1; }
  bash scripts/build-macos.sh
fi
app_source="$(cd "$app_source" && pwd -P)"
arch="${GAMEPACK_PACKAGE_ARCH:-$(uname -m)}"
[[ "$arch" != x86_64 ]] || arch=x64
case "$arch" in arm64|x64) ;; *) printf 'Unsupported Mac architecture: %s\n' "$arch" >&2; exit 1 ;; esac
native_arch="$arch"
[[ "$native_arch" != x64 ]] || native_arch=x86_64
[[ "$(lipo -archs "$app_source/Contents/MacOS/GamePack")" == "$native_arch" ]] || { printf 'App CPU architecture does not match the package name.\n' >&2; exit 1; }
[[ -x "$app_source/Contents/Helpers/GamePackUpdateHelper" ]] || { printf 'The trusted update helper is missing; rebuild the app.\n' >&2; exit 1; }
[[ "$(lipo -archs "$app_source/Contents/Helpers/GamePackUpdateHelper")" == "$native_arch" ]] || { printf 'Update helper CPU architecture does not match the package name.\n' >&2; exit 1; }
codesign --verify --strict "$app_source/Contents/Helpers/GamePackUpdateHelper"
codesign --verify --deep --strict "$app_source"
version="$(node -p "require('./package.json').version")"
app_version="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app_source/Contents/Info.plist")"
[[ "$app_version" == "$version" ]] || { printf 'App version does not match package.json; rebuild the app.\n' >&2; exit 1; }
stage="$PWD/dist/package-macos-$arch"
case "$app_source/" in "$stage/"*) printf 'Choose an app source outside the packaging staging folder.\n' >&2; exit 1 ;; esac
rm -rf "$stage"
mkdir -p "$stage" dist/packages
/usr/bin/ditto "$app_source" "$stage/GamePack.app"
if [[ -n "${GAMEPACK_MACOS_APP_SOURCE:-}" ]]; then
  # A verified CI app already contains its target's exact dependency notices.
  # Preserve them when signing x64 artifacts on an ARM64 release workstation.
  node --input-type=module - "$stage/GamePack.app/Contents/Resources/Notices/manifest.json" "$arch" <<'JAVASCRIPT'
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const target = process.argv[3] === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
if (manifest.generator !== 'gamepack-collect-notices-v1' || manifest.cargoTarget !== target || !Array.isArray(manifest.packages) || !manifest.packages.length)
  throw new Error('The provided app must contain the matching CI dependency notices.');
JAVASCRIPT
else
  node scripts/collect-notices.mjs "$stage/GamePack.app/Contents/Resources/Notices"
fi
# Notices are part of the installed app, so verify the final signed bundle.
node scripts/macos/sign-app.mjs "$stage/GamePack.app" --json > "$stage/signing.json"
if [[ -n "${GAMEPACK_NOTARY_PROFILE:-}" ]]; then
  node scripts/macos/notarize-app.mjs "$stage/GamePack.app" --json > "$stage/notarization.json"
else
  printf '{"status":"Not requested","stapled":false,"assessment":"not checked"}\n' > "$stage/notarization.json"
fi
# Keep the app-only archive for the automatic updater in existing releases.
COPYFILE_DISABLE=1 tar -czf "dist/packages/GamePack-macos-$arch.tar.gz" -C "$stage" GamePack.app
mkdir -p "$stage/disk-image"
/usr/bin/ditto "$stage/GamePack.app" "$stage/disk-image/GamePack.app"
ln -s /Applications "$stage/disk-image/Applications"
hdiutil create -quiet -ov -format UDZO -fs HFS+ -volname GamePack \
  -srcfolder "$stage/disk-image" "dist/packages/GamePack-macos-$arch.dmg"
for extension in tar.gz dmg; do
  (cd dist/packages && shasum -a 256 "GamePack-macos-$arch.$extension" > "GamePack-macos-$arch.$extension.sha256")
done
node --input-type=module - "$version" "$arch" "$app_source" "$PWD/dist/packages/GamePack-macos-$arch.tar.gz" "$stage" "${GAMEPACK_MACOS_PACKAGE_REPORT:-}" <<'JAVASCRIPT'
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [version, architecture, source, archive, stage, output] = process.argv.slice(2);
const report = {version, architecture, source, archive,
  sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
  diskImage: {path: archive.replace(/\.tar\.gz$/, '.dmg'),
    sha256: createHash('sha256').update(fs.readFileSync(archive.replace(/\.tar\.gz$/, '.dmg'))).digest('hex')},
  signing: JSON.parse(fs.readFileSync(path.join(stage, 'signing.json'), 'utf8')),
  notarization: JSON.parse(fs.readFileSync(path.join(stage, 'notarization.json'), 'utf8'))};
if (output) {
  if (!path.isAbsolute(output)) throw new Error('GAMEPACK_MACOS_PACKAGE_REPORT must be an absolute file path.');
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
}
console.log(report.signing.developerID ? `Signed with ${report.signing.name}. Notarization: ${report.notarization.status}.` : 'Development package (ad-hoc signature).');
JAVASCRIPT
printf 'Installer: dist/packages/GamePack-macos-%s.dmg\n' "$arch"
printf 'Automatic update: dist/packages/GamePack-macos-%s.tar.gz\n' "$arch"
