import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import test from 'node:test';
import {archiveName, parseReleaseArgs, prepareRelease, repository, targets, verifyArtifacts, verifyDraft, verifyRun} from '../../scripts/release/release.mjs';
import {checkVersion, repositoryRoot} from '../../scripts/release/version.mjs';

const commit = 'a'.repeat(40), identity = 'B'.repeat(40), ciRun = '12345';
const options = {ciRun, identity, profile: 'GamePack-DeveloperID', powershell: '/local tools/pwsh'};
const sha256 = data => createHash('sha256').update(data).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const runData = () => ({id: Number(ciRun), repository: {full_name: repository}, head_repository: {full_name: repository},
  head_sha: commit, head_branch: 'main', path: '.github/workflows/ci.yml', event: 'push', status: 'completed', conclusion: 'success', run_attempt: 1});
const artifactData = () => targets.map((target, index) => ({id: 100 + index, name: `release-${target}`, size_in_bytes: 100, expired: false,
  workflow_run: {id: Number(ciRun), head_sha: commit, head_branch: 'main'}}));
const versionFiles = ['package.json', 'package-lock.json', 'Cargo.lock', 'crates/gamepack-core/Cargo.toml',
  'macos/gamepack-macOS/Info.plist', 'apps/windows/GamePack.Package/Package.appxmanifest', 'apps/windows/GamePack/GamePackVersion.h'];

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'gamepack-release-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const file of versionFiles) {
    mkdirSync(dirname(join(root, file)), {recursive: true});
    writeFileSync(join(root, file), readFileSync(join(repositoryRoot, file)));
  }
  const version = checkVersion(root), tag = `v${version}`;
  const state = {root, version, tag, main: commit, local: commit, dirty: '', ci: runData(), artifacts: artifactData(), releases: [], refs: [],
    calls: [], writes: [], uploads: [], packages: [], validations: [], notes: `# GamePack ${version}\n\nReview improvements.\n`, before: () => {}};
  state.draft = () => ({id: 99, tag_name: tag, target_commitish: commit, draft: true, prerelease: false, assets: [], body: '<!-- gamepack-draft-source: ci -->', html_url: 'https://github.com/example/draft'});
  const pair = (directory, target, content) => {
    mkdirSync(directory, {recursive: true});
    const file = join(directory, archiveName(target));
    writeFileSync(file, content);
    writeFileSync(`${file}.sha256`, `${sha256(content)}  ${basename(file)}\n`);
  };
  state.command = async (program, args, settings) => {
    const call = {program, args, settings}; state.calls.push(call); await state.before(call);
    if (program === 'git') {
      if (args[0] === 'status') return state.dirty;
      if (args[0] === 'rev-parse') return `${state.local}\n`;
      if (args[0] === 'show') { assert.equal(args[1], `${commit}:docs/releases/${version}.md`); return state.notes; }
    }
    if (program === 'gh' && args[0] === 'api') {
      assert.deepEqual(args.slice(0, 3), ['api', '--hostname', 'github.com']);
      assert.ok(args[3].startsWith(`repos/${repository}/`));
      const endpoint = args[3].slice(`repos/${repository}/`.length);
      const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
      const request = args.includes('--input') ? JSON.parse(readFileSync(args[args.indexOf('--input') + 1], 'utf8')) : null;
      if (method !== 'GET') state.writes.push({endpoint, method, request});
      if (endpoint === 'git/ref/heads/main') return JSON.stringify({ref: 'refs/heads/main', object: {type: 'commit', sha: state.main}});
      if (endpoint === `actions/runs/${ciRun}`) return JSON.stringify(state.ci);
      if (endpoint.startsWith(`actions/runs/${ciRun}/artifacts?`)) return JSON.stringify([{artifacts: state.artifacts}]);
      if (endpoint.startsWith('git/matching-refs/tags/')) return JSON.stringify(state.refs);
      if (endpoint.startsWith('commits/')) return JSON.stringify({sha: state.tagCommit ?? commit});
      if (endpoint === 'releases?per_page=100') return JSON.stringify([state.releases]);
      if (endpoint === 'releases' && method === 'POST') {
        assert.equal(request.draft, true); assert.equal(request.prerelease, false);
        state.releases.push({...state.draft(), ...request}); return JSON.stringify(state.releases.at(-1));
      }
      if (endpoint === 'releases/99') {
        assert.equal(state.releases.length, 1);
        if (method === 'PATCH') { assert.equal(request.draft, undefined); Object.assign(state.releases[0], request); }
        else assert.equal(method, 'GET');
        return JSON.stringify(state.releases[0]);
      }
    }
    if (program === 'gh' && args[0] === 'run') {
      assert.deepEqual(args.slice(0, 3), ['run', 'download', ciRun]);
      assert.equal(args[args.indexOf('--repo') + 1], `github.com/${repository}`);
      const target = args[args.indexOf('--name') + 1].slice('release-'.length), directory = args[args.indexOf('--dir') + 1];
      pair(directory, target, `original CI ${target}`);
      await state.afterDownload?.(directory, target); return '';
    }
    if (program === options.powershell) {
      if (args.includes('-File')) {
        assert.equal(args[args.indexOf('-File') + 1], join(root, 'scripts/release/validate-windows-artifact.ps1'));
        assert.equal(args[args.indexOf('-Version') + 1], version);
        const architecture = args[args.indexOf('-Architecture') + 1];
        state.validations.push(`windows-${architecture}`); await state.validate?.(`windows-${architecture}`);
      }
      return '7.6.7';
    }
    if (program === 'xcrun') { assert.equal(args[0], 'clang++'); assert.ok(args.includes('native/macos/GPUpdateSupport.mm')); return ''; }
    if (basename(program) === 'GPUpdateHarness') {
      if (args[0] === 'validate') { assert.equal(args[2], version); state.validations.push(`macos-${args[3]}`); await state.validate?.(`macos-${args[3]}`); }
      else assert.ok(['verify', 'extract'].includes(args[0]));
      return '';
    }
    if (program === 'bash') {
      assert.deepEqual(args, ['scripts/package-macos.sh']);
      assert.deepEqual(new Set(state.validations), new Set(targets), 'Every CI identity must be validated before signing either Mac package.');
      const env = settings.env, architecture = env.GAMEPACK_PACKAGE_ARCH, directory = join(root, 'dist/packages');
      assert.equal(env.GAMEPACK_MACOS_SIGN_IDENTITY, identity); assert.equal(env.GAMEPACK_NOTARY_PROFILE, options.profile);
      state.packages.push(architecture);
      const content = `notarized macos-${architecture}`;
      pair(directory, `macos-${architecture}`, content);
      const report = {version, architecture, source: env.GAMEPACK_MACOS_APP_SOURCE, archive: join(directory, archiveName(`macos-${architecture}`)), sha256: sha256(content),
        signing: {identity, name: 'Developer ID Application: Fixture (TEAM123456)', team: 'TEAM123456', developerID: true, hardenedRuntime: true, secureTimestamp: true},
        notarization: {id: architecture === 'arm64' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222', status: 'Accepted', stapled: true, assessment: 'accepted', receipt: '/local/receipt.json'}};
      await state.report?.(report); writeFileSync(env.GAMEPACK_MACOS_PACKAGE_REPORT, JSON.stringify(report)); return '';
    }
    if (program === 'gh' && args[0] === 'release') {
      assert.deepEqual(args.slice(0, 3), ['release', 'upload', tag]);
      assert.equal(args[args.indexOf('--repo') + 1], `github.com/${repository}`);
      const file = args[3], contents = readFileSync(file), name = basename(file);
      state.uploads.push({name, contents});
      const asset = {name, size: contents.length, state: 'uploaded', digest: `sha256:${sha256(contents)}`};
      await state.asset?.(asset);
      const release = state.releases[0]; release.assets = [...release.assets.filter(existing => existing.name !== name), asset]; return '';
    }
    throw new Error(`Unexpected command: ${program} ${JSON.stringify(args)}`);
  };
  state.prepare = () => prepareRelease(options, {root, platform: 'darwin', run: state.command, log: () => {}});
  return state;
}

const context = {ciRun, commit, tag: 'v1.0.1'};
const noRemoteChanges = state => { assert.deepEqual(state.writes, []); assert.deepEqual(state.uploads, []); };

test('arguments accept the existing Keychain profile and certificate hash without accepting publication options', () => {
  assert.deepEqual(parseReleaseArgs(['--ci-run', ciRun, '--sign-identity', identity.toLowerCase(), '--notary-profile', 'GamePack-DeveloperID']), {...options, powershell: 'pwsh'});
  assert.equal(parseReleaseArgs(['--ci-run', ciRun, '--sign-identity', identity, '--notary-profile', 'Local Profile', '--powershell', '/local tools/pwsh']).profile, 'Local Profile');
  for (const extra of [['--publish', 'true'], ['--ci-run', '99'], ['--powershell'], ['--notary-profile', 'bad\nprofile']]) {
    assert.throws(() => parseReleaseArgs(['--ci-run', ciRun, '--sign-identity', identity, '--notary-profile', 'Profile', ...extra]));
  }
  for (const args of [[], ['--ci-run', '0', '--sign-identity', identity, '--notary-profile', 'Profile'], ['--ci-run', ciRun, '--sign-identity', 'Developer ID', '--notary-profile', 'Profile']]) assert.throws(() => parseReleaseArgs(args));
});

test('source run requires the exact main commit, trusted repository, CI workflow and completed success', () => {
  assert.equal(verifyRun(runData(), context).head_sha, commit);
  for (const patch of [{repository: {full_name: 'fork/GamePack'}}, {head_repository: {full_name: 'fork/GamePack'}}, {id: 999}, {head_sha: 'c'.repeat(40)}, {head_branch: 'feature'}, {path: '.github/workflows/release.yml'}, {event: 'pull_request'}, {status: 'in_progress'}, {conclusion: 'failure'}, {run_attempt: 0}]) assert.throws(() => verifyRun({...runData(), ...patch}, context));
  assert.equal(verifyRun({...runData(), event: 'workflow_dispatch'}, context).event, 'workflow_dispatch');
});

test('artifact guards reject missing, duplicate, expired, wrong build and unexpected release artifacts', () => {
  assert.equal(verifyArtifacts(artifactData(), context).length, 4);
  for (const mutate of [items => items.pop(), items => items.push(copy(items[0])), items => { items[0].expired = true; }, items => { items[0].workflow_run.head_sha = 'c'.repeat(40); }, items => { items[0].name = 'release-other'; }, items => { items[0].size_in_bytes = 0; }]) {
    const items = artifactData(); mutate(items); assert.throws(() => verifyArtifacts(items, context));
  }
});

test('draft guards never accept published, mismatched, prerelease or unrelated assets', () => {
  const draft = {id: 99, tag_name: context.tag, target_commitish: commit, draft: true, prerelease: false, assets: []};
  assert.equal(verifyDraft(null, context), null); assert.equal(verifyDraft(draft, context), draft);
  for (const patch of [{draft: false}, {target_commitish: 'main'}, {target_commitish: 'c'.repeat(40)}, {prerelease: true}, {tag_name: 'v0.1.3'}, {assets: [{name: 'other.zip'}]}, {assets: [{name: archiveName(targets[0])}, {name: archiveName(targets[0])}]}]) assert.throws(() => verifyDraft({...draft, ...patch}, context));
});

test('complete preparation signs both Mac artifacts, preserves Windows bytes, and creates only an unpublished draft with provenance', async t => {
  const state = fixture(t), result = await state.prepare();
  assert.deepEqual(state.packages, ['arm64', 'x64']); assert.equal(state.uploads.length, 8);
  for (const upload of state.uploads.filter(item => item.name.endsWith('.zip'))) assert.equal(upload.contents.toString(), `original CI ${upload.name.slice('GamePack-'.length, -'.zip'.length)}`);
  assert.deepEqual(state.writes.map(item => [item.endpoint, item.method]), [['releases', 'POST'], ['releases/99', 'PATCH']]);
  assert.equal(state.writes[0].request.draft, true);
  assert.match(state.writes[0].request.body, /incomplete/);
  assert.equal(state.releases[0].draft, true); assert.equal(state.releases[0].target_commitish, commit);
  assert.match(state.releases[0].body, /<!-- gamepack-draft-source: signed-local -->/);
  assert.match(state.releases[0].body, /Source CI SHA-256/); assert.match(state.releases[0].body, /Signed SHA-256/);
  assert.match(state.releases[0].body, new RegExp(state.notes.trim()));
  assert.ok(!state.releases[0].body.includes(options.profile));
  assert.deepEqual(JSON.parse(readFileSync(join(result.staging, 'provenance.json'), 'utf8')), result.provenance);
  assert.notEqual(result.provenance.macos[0].sourceSha256, result.provenance.macos[0].sha256);
  assert.equal(result.provenance.signer.identity, identity);
  assert.equal(result.provenance.artifacts.length, 4); assert.equal(result.provenance.ciAttempt, 1);
  assert.deepEqual(state.refs, []);
});

test('an existing same-commit CI draft is refreshed and its old CI source marker is removed', async t => {
  const state = fixture(t); state.releases = [state.draft()];
  await state.prepare();
  assert.deepEqual(state.writes.map(item => item.method), ['PATCH', 'PATCH']);
  assert.equal(state.releases.length, 1); assert.ok(!state.releases[0].body.includes('gamepack-draft-source: ci'));
  assert.match(state.releases[0].body, /gamepack-draft-source: signed-local/);
});

for (const [name, mutate, error] of [
  ['published release', s => { s.releases = [{...s.draft(), draft: false}]; }, /published release/],
  ['mismatched draft', s => { s.releases = [{...s.draft(), target_commitish: 'c'.repeat(40)}]; }, /different commit/],
  ['dirty checkout', s => { s.dirty = ' M package.json'; }, /Commit tracked changes/],
  ['outdated checkout', s => { s.local = 'c'.repeat(40); }, /exact current main/],
  ['failed CI', s => { s.ci.conclusion = 'failure'; }, /must have succeeded/],
  ['expired artifact', s => { s.artifacts[0].expired = true; }, /expired/],
  ['mismatched public tag', s => { s.refs = [{ref: `refs/tags/${s.tag}`, object: {type: 'commit', sha: 'c'.repeat(40)}}]; s.tagCommit = 'c'.repeat(40); }, /different commit/],
]) test(`${name} fails before downloads, signing, or remote writes`, async t => {
  const state = fixture(t); mutate(state); await assert.rejects(state.prepare(), error); noRemoteChanges(state);
  assert.deepEqual(state.packages, []); assert.ok(!state.calls.some(call => call.args[0] === 'download' || call.args[0] === 'run'));
});

for (const [name, mutate, error] of [
  ['bad checksum', s => { s.afterDownload = (directory, target) => writeFileSync(join(directory, `${archiveName(target)}.sha256`), `${'0'.repeat(64)}  ${archiveName(target)}\n`); }, /Checksum mismatch/],
  ['unexpected downloaded file', s => { s.afterDownload = directory => writeFileSync(join(directory, 'extra.txt'), 'bad'); }, /Unexpected files/],
  ['wrong Windows architecture or version', s => { s.validate = target => { if (target === 'windows-x64') throw new Error('Package identity mismatch'); }; }, /identity mismatch/],
  ['wrong Mac architecture or version', s => { s.validate = target => { if (target === 'macos-x64') throw new Error('Package identity mismatch'); }; }, /identity mismatch/],
]) test(`${name} fails before signing or remote writes`, async t => {
  const state = fixture(t); mutate(state); await assert.rejects(state.prepare(), error); noRemoteChanges(state); assert.deepEqual(state.packages, []);
});

for (const [name, mutate, error] of [
  ['missing notarization', s => { s.report = report => { report.notarization.status = 'Invalid'; }; }, /notarized/],
  ['missing staple', s => { s.report = report => { report.notarization.stapled = false; }; }, /notarized/],
  ['missing hardened runtime', s => { s.report = report => { report.signing.hardenedRuntime = false; }; }, /Developer ID/],
  ['wrong signed architecture', s => { s.report = report => { report.architecture = 'other'; }; }, /report does not match/],
  ['wrong signed version', s => { s.report = report => { report.version = '0.1.3'; }; }, /report does not match/],
  ['wrong signing identity', s => { s.report = report => { report.signing.identity = 'C'.repeat(40); }; }, /Developer ID/],
  ['mismatched signed hash', s => { s.report = report => { report.sha256 = '0'.repeat(64); }; }, /report does not match/],
  ['changed main', s => { s.report = () => { s.main = 'c'.repeat(40); }; }, /Main changed/],
  ['retried CI', s => { s.report = () => { s.ci.run_attempt = 2; }; }, /CI run was retried/],
  ['replaced artifacts', s => { s.report = () => { s.artifacts[0].id = 999; }; }, /CI artifacts changed/],
  ['draft published during signing', s => { s.releases = [s.draft()]; s.report = () => { s.releases[0].draft = false; }; }, /published release/],
  ['draft appeared during signing', s => { s.report = () => { if (!s.releases.length) s.releases.push(s.draft()); }; }, /draft changed/],
]) test(`${name} prevents draft creation and every asset upload`, async t => {
  const state = fixture(t); mutate(state); await assert.rejects(state.prepare(), error); noRemoteChanges(state);
});

test('server-side asset digest mismatch leaves the draft visibly incomplete', async t => {
  const state = fixture(t); state.asset = asset => { if (asset.name === archiveName(targets[0])) asset.digest = `sha256:${'0'.repeat(64)}`; };
  await assert.rejects(state.prepare(), /uploaded asset .* could not be verified/);
  assert.equal(state.writes.length, 1); assert.equal(state.releases[0].draft, true); assert.match(state.releases[0].body, /incomplete/);
});

test('a release published between uploads stops further mutations', async t => {
  const state = fixture(t); state.asset = () => { state.releases[0].draft = false; };
  await assert.rejects(state.prepare(), /published release/); assert.equal(state.uploads.length, 1); assert.equal(state.writes.length, 1);
});

test('non-Mac hosts fail before external commands', async t => {
  const state = fixture(t);
  await assert.rejects(prepareRelease(options, {root: state.root, platform: 'linux', run: state.command}), /macOS/);
  assert.deepEqual(state.calls, []);
});
