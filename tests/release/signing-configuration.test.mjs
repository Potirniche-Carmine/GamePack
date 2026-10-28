import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {repositoryRoot} from '../../scripts/release/version.mjs';

test('CI signing setup refuses to change an ordinary Mac keychain', {skip: process.platform === 'win32'}, () => {
  const result = spawnSync('bash', ['scripts/ci/configure-release-signing.sh'], {cwd: repositoryRoot, encoding: 'utf8', env: {...process.env, GITHUB_ACTIONS: 'false'}});
  assert.notEqual(result.status, 0); assert.match(result.stderr, /ephemeral GitHub-hosted/);
});

test('missing encrypted secrets fail before creating any credential files', {skip: process.platform === 'win32'}, t => {
  const directory = mkdtempSync(join(tmpdir(), 'gamepack-signing-config-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const env = {...process.env, GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'macOS', RUNNER_TEMP: directory,
    MACOS_CERTIFICATE_P12: '', MACOS_CERTIFICATE_PASSWORD: '', APPLE_NOTARY_APPLE_ID: '', APPLE_NOTARY_PASSWORD: ''};
  const result = spawnSync('bash', ['scripts/ci/configure-release-signing.sh'], {cwd: repositoryRoot, encoding: 'utf8', env});
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Configure encrypted Actions secrets/);
  assert.deepEqual(readdirSync(directory), []);
});
