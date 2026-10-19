import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {repositoryRoot} from '../../scripts/release/version.mjs';

const supported = process.platform !== 'win32';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gamepack-install-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const library = join(root, 'Library with spaces');
  const source = join(root, 'Download', 'GamePack.app');
  const destination = join(library, 'app', 'GamePack.app');
  const write = (path, contents, executable = false) => {
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, contents);
    if (executable) chmodSync(path, 0o755);
  };
  write(join(source, 'Contents', 'Info.plist'), 'new version');
  write(join(source, 'Contents', 'MacOS', 'GamePack'), 'new binary', true);
  write(join(destination, 'Contents', 'Info.plist'), 'old version');
  write(join(destination, 'removed-in-new-version.txt'), 'old resource');
  write(join(library, 'library.sqlite'), 'existing projects, media, comments and drafts');
  write(join(library, 'settings.json'), '{"theme":"dark"}');
  const bin = join(root, 'bin');
  // Mock only the OS commands: the real installer performs every filesystem
  // operation against the fixture, including failed-swap rollback.
  write(join(bin, 'codesign'), '#!/bin/bash\ncase "$*" in *".install."*) [[ "${TEST_VERIFY_FAIL:-0}" != 1 ]] ;; *) exit 0 ;; esac\n', true);
  write(join(bin, 'pgrep'), '#!/bin/bash\n[[ "${TEST_APP_RUNNING:-0}" == 1 ]]\n', true);
  write(join(bin, 'ditto'), '#!/bin/bash\n/bin/cp -R "$1" "$2"\n', true);
  write(join(bin, 'open'), '#!/bin/bash\necho opened > "$TEST_OPENED"\n', true);
  write(join(bin, 'mv'), '#!/bin/bash\nif [[ "${TEST_SWAP_FAIL:-0}" == 1 && "$1" == *".install."*"/GamePack.app" ]]; then exit 1; fi\n/bin/mv "$@"\n', true);
  const install = (env = {}, options = ['--no-launch']) => spawnSync('bash', [join(repositoryRoot, 'scripts/macos/install-app.sh'), source, ...options], {
    encoding: 'utf8', env: {...process.env, GAMEPACK_HOME: library, PATH: `${bin}:${process.env.PATH}`, TEST_OPENED: join(root, 'opened'), ...env},
  });
  const assertLibrary = () => {
    assert.equal(readFileSync(join(library, 'library.sqlite'), 'utf8'), 'existing projects, media, comments and drafts');
    assert.equal(readFileSync(join(library, 'settings.json'), 'utf8'), '{"theme":"dark"}');
    assert.deepEqual(readdirSync(join(library, 'app')), ['GamePack.app']);
  };
  return {root, source, destination, library, install, assertLibrary};
}

test('an upgrade replaces the old bundle, preserves the library, and supports paths with spaces', {skip: !supported}, t => {
  const f = fixture(t);
  const result = f.install();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(f.destination, 'Contents', 'Info.plist'), 'utf8'), 'new version');
  assert.equal(existsSync(join(f.destination, 'removed-in-new-version.txt')), false);
  assert.equal(existsSync(join(f.root, 'opened')), false);
  const launcher = readFileSync(join(f.library, 'Launch GamePack.command'), 'utf8');
  assert.ok(launcher.includes('--env "GAMEPACK_HOME=$GAMEPACK_HOME"'));
  f.assertLibrary();
  // Installing the same version is also safe and launches only when requested.
  assert.equal(f.install({}, []).status, 0);
  assert.equal(existsSync(join(f.root, 'opened')), true);
  f.assertLibrary();
});

for (const [name, env] of [
  ['a failed staged signature', {TEST_VERIFY_FAIL: '1'}],
  ['a failed replacement move', {TEST_SWAP_FAIL: '1'}],
  ['a running application', {TEST_APP_RUNNING: '1'}],
]) {
  test(`${name} leaves the installed app and library intact`, {skip: !supported}, t => {
    const f = fixture(t);
    assert.notEqual(f.install(env).status, 0);
    assert.equal(readFileSync(join(f.destination, 'Contents', 'Info.plist'), 'utf8'), 'old version');
    assert.equal(existsSync(join(f.destination, 'removed-in-new-version.txt')), true);
    f.assertLibrary();
  });
}

test('relative library roots are rejected before installation', {skip: !supported}, t => {
  const f = fixture(t);
  const result = f.install({GAMEPACK_HOME: 'relative/path'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /absolute directory/);
  f.assertLibrary();
});
