import test from 'node:test';
import assert from 'node:assert/strict';
import {checkForUpdates, compareVersions, evaluateRelease, latestReleaseEndpoint, parseVersion, updateAssetName} from '../packages/app/src/updates.ts';

const build = {version: '1.0.0', platform: 'macos', architecture: 'arm64'};
const asset = (name = 'GamePack-macos-arm64.tar.gz') => ({name, state: 'uploaded', size: 1024});
const release = (tag = 'v1.1.0', changes = {}) => ({tag_name: tag, draft: false, prerelease: false, published_at: '2026-10-19T10:00:00Z', assets: [asset()], ...changes});
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers});

test('compares release versions numerically and ignores build metadata', () => {
  for (const [left, right, expected] of [
    ['1.0.0', '0.1.3', 1], ['v1.0.0', '1.0.0', 0], ['0.1.2', 'v0.1.3', -1],
    ['1.10.0', '1.9.99', 1], ['2.0.0', '10.0.0', -1], ['1.1.20', '1.1.3', 1],
    ['1.0.0+first', '1.0.0+second', 0], ['9007199254740993.0.0', '9007199254740992.0.0', 1],
  ]) assert.equal(compareVersions(left, right), expected, `${left} vs ${right}`);
});

test('implements SemVer prerelease precedence without opting into prerelease updates', () => {
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
  for (let index = 1; index < ordered.length; index++) {
    assert.equal(compareVersions(ordered[index - 1], ordered[index]), -1);
    assert.equal(compareVersions(ordered[index], ordered[index - 1]), 1);
  }
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha'), 0);
  assert.equal(compareVersions('1.0.0-9007199254740993', '1.0.0-9007199254740992'), 1);
  assert.equal(evaluateRelease(release('v1.0.0'), {...build, version: '1.0.0-rc.1'}).kind, 'available');
  assert.equal(evaluateRelease(release('v1.0.0'), {...build, version: '2.0.0-beta'}).kind, 'current');
  assert.equal(evaluateRelease(release('v2.0.0-rc.1'), build).kind, 'unpublished');
});

test('rejects malformed versions and unsafe tags', () => {
  for (const version of [null, 1, '', '1.0', '1.0.0.0', '01.0.0', '1.00.0', '1.0.00', '1.0.0-01', '1.0.0-beta..1', '1.0.0+', '1.0.0+meta..data', 'V1.0.0', ' 1.0.0', '1.0.0\n', '1.0.0/other', 'https://evil.example', '1.0.0?x=y', '1.0.0#fragment', `1.0.0+${'a'.repeat(256)}`]) {
    assert.equal(parseVersion(version), null, String(version));
    assert.equal(compareVersions('1.0.0', version), null, String(version));
  }
  assert.ok(parseVersion('0.0.0-0+001'));
  assert.ok(parseVersion('1.2.3-beta-01+build.001'));
  assert.throws(() => evaluateRelease(release(), {...build, version: 'broken'}), /installed version/);
  assert.throws(() => evaluateRelease(release('1.0'), build), /invalid release information/);
});

test('offers only newer published releases and never downgrades a newer install', () => {
  assert.equal(evaluateRelease(release('v1.0.1'), build).kind, 'available');
  assert.deepEqual(evaluateRelease(release('v1.0.0'), build), {kind: 'current'});
  assert.deepEqual(evaluateRelease(release('v0.1.3'), build), {kind: 'current'});
  assert.deepEqual(evaluateRelease(release('v1.0.0+build.2'), build), {kind: 'current'});
  assert.deepEqual(evaluateRelease(release('v2.0.0', {draft: true}), build), {kind: 'unpublished'});
  assert.deepEqual(evaluateRelease(release('v2.0.0', {prerelease: true}), build), {kind: 'unpublished'});
});

test('selects exact assets for all four supported targets', () => {
  for (const platform of ['macos', 'windows']) {
    for (const architecture of ['arm64', 'x64']) {
      const target = {...build, platform, architecture};
      const expected = `GamePack-${platform}-${architecture}.${platform === 'macos' ? 'tar.gz' : 'zip'}`;
      const payload = release('v1.2.0', {assets: [asset('GamePack-macos-universal.tar.gz'), asset(expected), asset(`${expected}.sha256`)]});
      assert.equal(updateAssetName(target), expected);
      assert.deepEqual(evaluateRelease(payload, target), {kind: 'available', version: '1.2.0', tag: 'v1.2.0', asset: expected});
    }
  }
  assert.throws(() => updateAssetName({...build, platform: 'linux'}), /not available for this device/);
  assert.throws(() => updateAssetName({...build, architecture: 'x86'}), /not available for this device/);
});

test('missing, duplicate, empty, or unfinished matching assets offer the release page instead', () => {
  for (const assets of [[], [asset('GamePack-macos-x64.tar.gz')], [asset(), asset()], [{...asset(), size: 0}], [{...asset(), state: 'new'}], [{...asset(), size: '1024'}], [null, {}]]) {
    assert.equal(evaluateRelease(release('v1.1.0', {assets}), build).asset, null);
  }
  // API-provided links are never used to navigate; native code constructs them.
  const result = evaluateRelease(release('v1.1.0', {html_url: 'https://evil.example', assets: [{...asset(), browser_download_url: 'file:///etc/passwd'}]}), build);
  assert.deepEqual(result, {kind: 'available', version: '1.1.0', tag: 'v1.1.0', asset: asset().name});
});

test('does not call incomplete or malformed payloads up to date', () => {
  for (const payload of [null, [], {}, release('v2.0.0', {draft: 'false'}), release('v2.0.0', {prerelease: null}), release('v2.0.0', {published_at: null}), release('v2.0.0', {published_at: 'not a date'}), release('v2.0.0', {assets: null})]) {
    assert.throws(() => evaluateRelease(payload, build), /invalid release information/);
  }
});

test('requests the public latest release endpoint without credentials', async () => {
  let calls = 0;
  const result = await checkForUpdates(build, {fetch: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/Potirniche-Carmine/GamePack/releases/latest');
    assert.equal(url, latestReleaseEndpoint);
    assert.equal(options.headers.Accept, 'application/vnd.github+json');
    assert.equal(options.headers['User-Agent'], 'GamePack');
    assert.equal(options.headers['Cache-Control'], 'no-cache');
    assert.equal(options.headers.Authorization, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return response(release());
  }});
  assert.equal(calls, 1);
  assert.equal(result.kind, 'available');
});

test('checks native version and platform before making any network request', async () => {
  const fetch = async () => { assert.fail('invalid native metadata must not make a request'); };
  await assert.rejects(checkForUpdates({...build, version: ''}, {fetch}), /installed version/);
  await assert.rejects(checkForUpdates({...build, architecture: 'unknown'}, {fetch}), /not available for this device/);
});

test('distinguishes no releases, rate limits, server errors, malformed JSON, and offline failures', async () => {
  assert.deepEqual(await checkForUpdates(build, {fetch: async () => response({}, 404)}), {kind: 'unpublished'});
  for (const [status, headers] of [[429, {}], [403, {'x-ratelimit-remaining': '0'}], [403, {'retry-after': '60'}]]) {
    await assert.rejects(checkForUpdates(build, {fetch: async () => response({}, status, headers)}), /request limit/);
  }
  for (const status of [401, 403, 500, 503]) {
    await assert.rejects(checkForUpdates(build, {fetch: async () => response({}, status)}), /GitHub could not check/);
  }
  await assert.rejects(checkForUpdates(build, {fetch: async () => new Response('not json')}), /invalid release information/);
  await assert.rejects(checkForUpdates(build, {fetch: async () => { throw new TypeError('Network request failed'); }}), /Check your connection/);
});

const pendingFetch = async (_url, {signal}) => new Promise((_resolve, reject) => {
  if (signal.aborted) reject(new Error('aborted'));
  else signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
});
test('times out stalled requests and cancels when Settings closes', async () => {
  await assert.rejects(checkForUpdates(build, {fetch: pendingFetch, timeoutMs: 5}), /timed out/);
  const controller = new AbortController();
  const request = checkForUpdates(build, {fetch: pendingFetch, signal: controller.signal});
  controller.abort();
  await assert.rejects(request, /cancelled/);
  await assert.rejects(checkForUpdates(build, {fetch: pendingFetch, signal: controller.signal}), /cancelled/);
});
