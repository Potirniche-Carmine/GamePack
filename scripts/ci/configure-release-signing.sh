#!/usr/bin/env bash
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted && "${RUNNER_OS:-}" == macOS ]] || {
  printf 'Signing setup is restricted to ephemeral GitHub-hosted macOS runners.\n' >&2
  exit 1
}
umask 077
node --input-type=module - <<'JAVASCRIPT'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const required = ['MACOS_CERTIFICATE_P12', 'MACOS_CERTIFICATE_PASSWORD', 'APPLE_NOTARY_APPLE_ID', 'APPLE_NOTARY_PASSWORD'];
const missing = required.filter(name => !process.env[name]);
assert.equal(missing.length, 0, `Configure encrypted Actions secrets before enabling releases: ${missing.join(', ')}`);
assert.match(process.env.MACOS_SIGN_IDENTITY ?? '', /^[A-Fa-f0-9]{40}$/, 'MACOS_SIGN_IDENTITY must identify the distribution certificate.');
assert.match(process.env.APPLE_TEAM_ID ?? '', /^[A-Z0-9]{10}$/, 'APPLE_TEAM_ID is invalid.');
assert.ok(process.env.RUNNER_TEMP?.startsWith('/'), 'The runner must provide a temporary directory.');
const encoded = process.env.MACOS_CERTIFICATE_P12.replace(/\s/g, '');
const certificate = Buffer.from(encoded, 'base64');
assert.ok(certificate.length > 0 && certificate.toString('base64') === encoded, 'The signing certificate must be base64-encoded PKCS#12.');
fs.writeFileSync(`${process.env.RUNNER_TEMP}/gamepack-signing.p12`, certificate, {mode: 0o600, flag: 'wx'});
JAVASCRIPT
keychain="$RUNNER_TEMP/gamepack-release.keychain-db"
keychain_password="$(openssl rand -hex 32)"
echo "::add-mask::$keychain_password"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$RUNNER_TEMP/gamepack-signing.p12" -k "$keychain" -f pkcs12 -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain"
security default-keychain -d user -s "$keychain"
probe="$RUNNER_TEMP/gamepack-signing-probe"
printf 'int main(void) { return 0; }\n' | xcrun clang -x c - -o "$probe"
codesign --force --sign "$MACOS_SIGN_IDENTITY" --options runtime --timestamp "$probe"
codesign --verify --strict "$probe"
xcrun notarytool store-credentials GamePack-CI --keychain "$keychain" \
  --apple-id "$APPLE_NOTARY_APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_NOTARY_PASSWORD"
{
  echo "GAMEPACK_MACOS_SIGN_IDENTITY=$MACOS_SIGN_IDENTITY"
  echo 'GAMEPACK_NOTARY_PROFILE=GamePack-CI'
} >> "$GITHUB_ENV"
