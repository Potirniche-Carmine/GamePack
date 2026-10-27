import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {macosDependencyKey} from '../../scripts/ci/macos-cache-key.mjs';

test('Mac dependency caches survive release bumps and invalidate for dependency or Podfile changes', t => {
  const root = mkdtempSync(join(tmpdir(), 'gamepack-cache-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'macos'));
  for (const name of ['Gemfile.lock', 'macos/Podfile', 'macos/Podfile.lock']) writeFileSync(join(root, name), name);
  const lock = {version: '1.0.3', packages: {'': {version: '1.0.3', dependencies: {react: '19.1.4'}}, 'node_modules/react': {version: '19.1.4', integrity: 'sha512-original'}}};
  const save = () => writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  save(); const before = macosDependencyKey(root);
  lock.version = lock.packages[''].version = '1.0.4'; save();
  assert.equal(macosDependencyKey(root), before);
  lock.packages['node_modules/react'].integrity = 'sha512-changed'; save();
  assert.notEqual(macosDependencyKey(root), before);
  lock.packages['node_modules/react'].integrity = 'sha512-original'; save();
  lock.packages[''].dependencies.react = '20.0.0'; save();
  assert.notEqual(macosDependencyKey(root), before);
  lock.packages[''].dependencies.react = '19.1.4'; save();
  for (const name of ['Gemfile.lock', 'macos/Podfile', 'macos/Podfile.lock']) {
    writeFileSync(join(root, name), 'changed'); assert.notEqual(macosDependencyKey(root), before);
    writeFileSync(join(root, name), name);
  }
  assert.equal(macosDependencyKey(root), before);
});
