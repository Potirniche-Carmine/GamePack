import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const textVersions = [
  ['crates/gamepack-core/Cargo.toml', /^version = "([^"]+)"/m, version => version],
  ['Cargo.lock', /name = "gamepack-core"\r?\nversion = "([^"]+)"/, version => version],
  ['macos/gamepack-macOS/Info.plist', /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/, version => version],
  ['apps/windows/GamePack.Package/Package.appxmanifest', /<Identity\b[^>]*\bVersion="([^"]+)"/s, version => `${version}.0`],
  ['apps/windows/GamePack/GamePackVersion.h', /^#define GAMEPACK_VERSION "([^"]+)"/m, version => version],
];

export function validateVersion(version) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Use a stable version such as 1.2.3, without a v prefix or leading zeroes.');
  assert.ok(version.split('.').every(part => Number(part) <= 65535), 'Windows version components must be at most 65535.');
  return version;
}

export function checkVersion(root = repositoryRoot) {
  const read = path => readFileSync(resolve(root, path), 'utf8');
  const version = validateVersion(JSON.parse(read('package.json')).version);
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, version, 'npm lockfile version');
  assert.equal(lock.packages[''].version, version, 'npm root package version');
  for (const [path, expression, expected] of textVersions) {
    assert.equal(read(path).match(expression)?.[1], expected(version), `${path} version`);
  }
  return version;
}

export function prepareVersion(version, root = repositoryRoot) {
  validateVersion(version);
  // Read and validate every file before making changes. A malformed source file
  // must not leave half of the app on a different release version.
  const pending = new Map();
  const read = path => readFileSync(resolve(root, path), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  pkg.version = version;
  pending.set('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  const lock = JSON.parse(read('package-lock.json'));
  assert.ok(lock.packages?.[''], 'npm lockfile is missing its root package.');
  lock.version = version;
  lock.packages[''].version = version;
  pending.set('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
  for (const [path, expression, expected] of textVersions) {
    const source = read(path);
    const match = source.match(expression);
    assert.ok(match, `Cannot find the version in ${path}.`);
    pending.set(path, source.replace(expression, value => value.replace(match[1], expected(version))));
  }
  for (const [path, contents] of pending) writeFileSync(resolve(root, path), contents);
  return checkVersion(root);
}
