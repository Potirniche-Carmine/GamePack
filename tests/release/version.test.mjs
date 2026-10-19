import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {checkVersion, prepareVersion, repositoryRoot, validateVersion} from '../../scripts/release/version.mjs';

const files = [
  'package.json', 'package-lock.json', 'Cargo.lock', 'crates/gamepack-core/Cargo.toml',
  'macos/gamepack-macOS/Info.plist', 'apps/windows/GamePack.Package/Package.appxmanifest',
  'apps/windows/GamePack/GamePackVersion.h',
];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gamepack-versions-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), {recursive: true});
    writeFileSync(join(root, file), readFileSync(join(repositoryRoot, file)));
  }
  return root;
}
const snapshot = root => files.map(file => readFileSync(join(root, file), 'utf8'));

test('version preparation updates all native identities and preserves dependency versions', t => {
  const root = fixture(t);
  const originalLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const originalCargo = readFileSync(join(root, 'Cargo.lock'), 'utf8');
  for (const version of ['1.0.1', '1.2.0', '2.0.0']) {
    assert.equal(prepareVersion(version, root), version);
    assert.equal(checkVersion(root), version);
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    for (const [path, pkg] of Object.entries(originalLock.packages)) {
      if (path) assert.deepEqual(lock.packages[path], pkg);
    }
    const withoutCoreVersion = value => value.replace(/(name = "gamepack-core"\nversion = ")[^"]+/, '$1VERSION');
    assert.equal(withoutCoreVersion(readFileSync(join(root, 'Cargo.lock'), 'utf8')), withoutCoreVersion(originalCargo));
  }
});

test('mismatched versions fail validation and can be repaired together', t => {
  const root = fixture(t);
  const header = join(root, 'apps/windows/GamePack/GamePackVersion.h');
  writeFileSync(header, '#pragma once\n#define GAMEPACK_VERSION "0.1.3"\n');
  assert.throws(() => checkVersion(root), /GamePackVersion.h version/);
  assert.equal(prepareVersion('1.0.0', root), '1.0.0');
});

test('invalid versions never mutate files', t => {
  const root = fixture(t);
  const before = snapshot(root);
  for (const version of ['v1.2.3', '1.2', '01.2.3', '1.2.3-beta.1', '1.2.3+build', '../2.0.0', '65536.0.0']) {
    assert.throws(() => prepareVersion(version, root));
    assert.deepEqual(snapshot(root), before);
  }
  assert.equal(validateVersion('65535.65535.65535'), '65535.65535.65535');
});

test('a missing native version leaves every file unchanged', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'apps/windows/GamePack/GamePackVersion.h'), '#pragma once\n');
  const before = snapshot(root);
  assert.throws(() => prepareVersion('2.0.0', root), /Cannot find the version/);
  assert.deepEqual(snapshot(root), before);
});
