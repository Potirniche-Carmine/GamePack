import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {checkVersion, repositoryRoot} from './version.mjs';

export const repository = 'Potirniche-Carmine/GamePack';
export const targets = ['macos-arm64', 'macos-x64', 'windows-arm64', 'windows-x64'];
export const archiveName = target => `GamePack-${target}.${target.startsWith('macos-') ? 'tar.gz' : 'zip'}`;
const sha = /^[a-f0-9]{40}$/;
const endpoint = suffix => `repos/${repository}/${suffix}`;
const validText = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);

export function parseReleaseArgs(args) {
  const options = {powershell: 'pwsh'};
  const names = {'--ci-run': 'ciRun', '--sign-identity': 'identity', '--notary-profile': 'profile', '--powershell': 'powershell'};
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    assert.ok(names[flag] && !seen.has(flag), `Unknown or repeated option: ${flag}`);
    assert.ok(validText(value) && !value.startsWith('--'), `Missing or invalid value for ${flag}.`);
    seen.add(flag); options[names[flag]] = value;
  }
  assert.match(options.ciRun ?? '', /^[1-9][0-9]{0,19}$/, 'Provide --ci-run with a successful main CI run ID.');
  assert.match(options.identity ?? '', /^[a-fA-F0-9]{40}$/, 'Provide --sign-identity with the 40-character Developer ID certificate SHA-1.');
  assert.ok(validText(options.profile), 'Provide --notary-profile with an existing Keychain profile.');
  options.identity = options.identity.toUpperCase();
  return options;
}

export function verifyRun(run, {ciRun, commit}) {
  assert.ok(run && String(run.id) === ciRun && run.repository?.full_name === repository && run.head_repository?.full_name === repository,
    'The CI run does not belong to this repository.');
  assert.ok(sha.test(commit) && run.head_sha === commit && run.head_branch === 'main', 'The CI run must build the exact current main commit.');
  assert.ok(run.path === '.github/workflows/ci.yml' && ['push', 'workflow_dispatch'].includes(run.event), 'The source must be the main CI workflow, triggered by push or workflow_dispatch.');
  assert.ok(run.status === 'completed' && run.conclusion === 'success', 'The complete CI run, including native packages, must have succeeded.');
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, 'The CI run attempt is missing.');
  return run;
}

export function verifyArtifacts(artifacts, {ciRun, commit}) {
  assert.ok(Array.isArray(artifacts), 'GitHub returned invalid CI artifacts.');
  const release = artifacts.filter(artifact => typeof artifact.name === 'string' && artifact.name.startsWith('release-'));
  assert.equal(release.length, targets.length, 'The CI run must contain exactly four release artifacts.');
  return targets.map(target => {
    const matching = release.filter(artifact => artifact.name === `release-${target}`);
    assert.equal(matching.length, 1, `The CI run is missing a unique release-${target} artifact.`);
    const artifact = matching[0];
    assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0 && artifact.expired === false && artifact.size_in_bytes > 0, `Artifact ${artifact.name} is missing or expired.`);
    assert.ok(String(artifact.workflow_run?.id) === ciRun && artifact.workflow_run?.head_sha === commit && artifact.workflow_run?.head_branch === 'main', `Artifact ${artifact.name} does not belong to the selected main build.`);
    return artifact;
  });
}

export function verifyDraft(release, {tag, commit}) {
  if (!release) return null;
  assert.ok(Number.isSafeInteger(release.id) && release.id > 0 && release.tag_name === tag, 'The release identity changed.');
  assert.equal(release.draft, true, 'A published release cannot be replaced.');
  assert.equal(release.target_commitish, commit, 'The existing draft targets a different commit.');
  assert.equal(release.prerelease, false, 'The existing draft is marked as a prerelease.');
  const expected = new Set(targets.flatMap(target => [archiveName(target), `${archiveName(target)}.sha256`]));
  const names = (release.assets ?? []).map(asset => asset.name);
  assert.ok(names.every(name => expected.has(name)) && new Set(names).size === names.length, 'The existing draft contains unexpected or duplicate assets; review it before replacing anything.');
  return release;
}

export function verifySigningReport(report, {version, architecture, identity, source, archive, sha256}) {
  assert.ok(report && report.version === version && report.architecture === architecture && report.source === source && report.archive === archive && report.sha256 === sha256,
    'The signed package report does not match the prepared archive.');
  const signing = report.signing, notarization = report.notarization;
  assert.ok(signing?.identity === identity && /^Developer ID Application: .+ \([A-Z0-9]{10}\)$/.test(signing.name ?? '') && /^[A-Z0-9]{10}$/.test(signing.team ?? '') && signing.name.endsWith(`(${signing.team})`) && signing.developerID === true && signing.hardenedRuntime === true && signing.secureTimestamp === true,
    'The Mac artifact does not have the requested Developer ID signature and signing policy.');
  assert.ok(/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(notarization?.id ?? '') && notarization.status === 'Accepted' && notarization.stapled === true && notarization.assessment === 'accepted',
    'The Mac artifact must be notarized, stapled, and accepted by Gatekeeper.');
  return report;
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}
function regular(file, maximum = 512 * 1024 * 1024) {
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && stat.size > 0 && stat.size <= maximum, `Missing or invalid release file: ${file}`);
  return stat.size;
}
async function verifyPair(directory, target) {
  const name = archiveName(target), file = join(directory, name);
  const size = regular(file); regular(`${file}.sha256`, 4096);
  const sha256 = await hashFile(file);
  assert.equal(readFileSync(`${file}.sha256`, 'utf8'), `${sha256}  ${name}\n`, `Checksum mismatch for ${name}.`);
  return {name, sha256, size};
}

function execute(program, args, {cwd, env, stream = false} = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(program, args, {cwd, env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; if (stream) process.stdout.write(value); });
    child.stderr.on('data', value => { stderr += value; if (stream) process.stderr.write(value); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolveRun(stdout) : reject(new Error(`${program} failed (${code}): ${stderr.trim().slice(-8000) || 'see command output'}`)));
  });
}

export function releaseNotes(notes, provenance) {
  const lines = [notes.trimEnd(), '', `Built from commit ${provenance.commit} in [CI run ${provenance.ciRun}](https://github.com/${repository}/actions/runs/${provenance.ciRun}) (attempt ${provenance.ciAttempt}).`, '',
    `The source Mac builds came from CI. Both release archives were signed locally with ${provenance.signer.name} (Team ID \`${provenance.signer.team}\`, certificate SHA-1 \`${provenance.signer.identity}\`), notarized by Apple, stapled, and accepted by Gatekeeper.`, '',
    '| Mac package | Source CI SHA-256 | Signed SHA-256 | Apple submission |', '| --- | --- | --- | --- |'];
  for (const item of provenance.macos) lines.push(`| ${item.architecture} | \`${item.sourceSha256}\` | \`${item.sha256}\` | \`${item.notarizationId}\` |`);
  lines.push('', 'Windows packages and checksums are unchanged from the source CI artifacts.', '', '<!-- gamepack-draft-source: signed-local -->', `<!-- gamepack-release-provenance ${JSON.stringify(provenance)} -->`, '');
  return lines.join('\n');
}

export async function prepareRelease(options, dependencies = {}) {
  const root = dependencies.root ?? repositoryRoot, run = dependencies.run ?? execute, log = dependencies.log ?? console.log;
  assert.equal(dependencies.platform ?? process.platform, 'darwin', 'Signed release preparation must run locally on macOS.');
  const command = (program, args, more = {}) => run(program, args, {cwd: root, ...more});
  const api = async (suffix, extra = []) => JSON.parse(await command('gh', ['api', '--hostname', 'github.com', endpoint(suffix), ...extra]));
  const pages = async suffix => {
    const result = await api(suffix, ['--paginate', '--slurp']);
    assert.ok(Array.isArray(result), 'GitHub returned invalid paginated data.'); return result;
  };
  const version = checkVersion(root), tag = `v${version}`;
  const currentCommit = async () => {
    const result = await api('git/ref/heads/main');
    assert.ok(result.ref === 'refs/heads/main' && result.object?.type === 'commit' && sha.test(result.object.sha), 'GitHub returned an invalid main commit.');
    return result.object.sha;
  };
  const localCommit = async () => {
    assert.equal((await command('git', ['status', '--porcelain', '--untracked-files=no'])).trim(), '', 'Commit tracked changes before preparing a release.');
    return (await command('git', ['rev-parse', 'HEAD'])).trim();
  };
  const commit = await currentCommit();
  assert.equal(await localCommit(), commit, 'Check out the exact current main commit before preparing a release.');
  const context = {...options, commit, tag};
  const ci = verifyRun(await api(`actions/runs/${options.ciRun}`), context);
  const artifacts = verifyArtifacts((await pages(`actions/runs/${options.ciRun}/artifacts?per_page=100`)).flatMap(page => page.artifacts ?? []), context);
  const readDraft = async () => {
    const releases = (await pages('releases?per_page=100')).flat();
    const matching = releases.filter(release => release.tag_name === tag);
    assert.ok(matching.length <= 1, 'Multiple releases use this version. Review them before proceeding.');
    return verifyDraft(matching[0] ?? null, context);
  };
  const tagIdentity = async () => {
    const refs = await api(`git/matching-refs/tags/${tag}`);
    assert.ok(Array.isArray(refs), 'GitHub returned invalid tag information.');
    const matching = refs.filter(ref => ref.ref === `refs/tags/${tag}`);
    assert.ok(matching.length <= 1, 'GitHub returned duplicate tags.');
    if (matching.length) assert.equal((await api(`commits/${tag}`)).sha, commit, 'The existing version tag points to a different commit.');
    return matching.length ? JSON.stringify(matching[0].object) : null;
  };
  let draft = await readDraft();
  const initialDraftId = draft?.id ?? null, initialTag = await tagIdentity();
  const notes = await command('git', ['show', `${commit}:docs/releases/${version}.md`]);
  assert.ok(notes.trim(), 'Release notes are empty.');
  await command(options.powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']);
  const parent = join(root, 'artifacts/local'); mkdirSync(parent, {recursive: true});
  const staging = mkdtempSync(join(parent, `signed-release-${version}-${options.ciRun}-`));
  log(`Preparing ${tag} from CI ${options.ciRun}. Local files: ${staging}`);
  const downloads = join(staging, 'ci'), upload = join(staging, 'release'); mkdirSync(upload, {recursive: true});
  const sources = new Map();
  for (const artifact of artifacts) {
    const target = artifact.name.slice('release-'.length), directory = join(downloads, target);
    await command('gh', ['run', 'download', options.ciRun, '--repo', `github.com/${repository}`, '--name', artifact.name, '--dir', directory]);
    assert.deepEqual(readdirSync(directory).sort(), [archiveName(target), `${archiveName(target)}.sha256`].sort(), `Unexpected files in ${artifact.name}.`);
    sources.set(target, {...await verifyPair(directory, target), artifactId: artifact.id, directory});
  }
  log('All four CI archives and checksums verified. Validating package identities…');
  for (const architecture of ['arm64', 'x64']) {
    const target = `windows-${architecture}`, source = sources.get(target);
    await command(options.powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(root, 'scripts/release/validate-windows-artifact.ps1'),
      '-Archive', join(source.directory, source.name), '-Destination', join(staging, `validate-${target}`), '-Architecture', architecture, '-Version', version]);
    for (const name of [source.name, `${source.name}.sha256`]) copyFileSync(join(source.directory, name), join(upload, name));
  }
  const harness = join(staging, 'GPUpdateHarness');
  await command('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-mmacosx-version-min=14.0', '-Wno-deprecated-declarations',
    'native/macos/GPUpdateSupport.mm', 'tests/macos-update-harness.mm', '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'Security', '-framework', 'CoreServices', '-lz', '-o', harness]);
  const apps = new Map();
  for (const architecture of ['arm64', 'x64']) {
    const source = sources.get(`macos-${architecture}`), directory = join(staging, `validate-macos-${architecture}`), app = join(directory, 'GamePack.app');
    await command(harness, ['verify', join(source.directory, source.name), source.sha256]);
    await command(harness, ['extract', join(source.directory, source.name), directory]);
    await command(harness, ['validate', app, version, architecture]);
    apps.set(architecture, app);
  }
  const reports = [];
  for (const architecture of ['arm64', 'x64']) {
    log(`Signing and notarizing macOS ${architecture}…`);
    const reportPath = join(staging, `macos-${architecture}-provenance.json`);
    await command('bash', ['scripts/package-macos.sh'], {stream: true, env: {
      GAMEPACK_MACOS_APP_SOURCE: apps.get(architecture), GAMEPACK_PACKAGE_ARCH: architecture,
      GAMEPACK_MACOS_SIGN_IDENTITY: options.identity, GAMEPACK_NOTARY_PROFILE: options.profile, GAMEPACK_MACOS_PACKAGE_REPORT: reportPath,
    }});
    const target = `macos-${architecture}`, directory = join(root, 'dist/packages'), signed = await verifyPair(directory, target), archive = join(directory, signed.name);
    regular(reportPath, 1024 * 1024);
    const report = verifySigningReport(JSON.parse(readFileSync(reportPath, 'utf8')), {version, architecture, identity: options.identity, source: apps.get(architecture), archive, sha256: signed.sha256});
    if (reports.length) assert.deepEqual(report.signing, reports[0].signing, 'Both Mac packages must use the same Developer ID identity.');
    reports.push(report);
    for (const name of [signed.name, `${signed.name}.sha256`]) copyFileSync(join(directory, name), join(upload, name));
  }
  const expectedAssets = new Map();
  for (const target of targets) {
    const checked = await verifyPair(upload, target), source = sources.get(target);
    if (target.startsWith('windows-')) assert.equal(checked.sha256, source.sha256, 'A Windows archive changed during signing.');
    for (const name of [checked.name, `${checked.name}.sha256`]) expectedAssets.set(name, {size: regular(join(upload, name)), sha256: await hashFile(join(upload, name))});
  }
  const provenance = {schema: 1, repository, commit, ciRun: options.ciRun, ciAttempt: ci.run_attempt, version,
    artifacts: artifacts.map(artifact => ({id: artifact.id, name: artifact.name})), signer: reports[0].signing,
    macos: reports.map(report => ({architecture: report.architecture, sourceSha256: sources.get(`macos-${report.architecture}`).sha256, sha256: report.sha256, notarizationId: report.notarization.id})),
    windows: ['arm64', 'x64'].map(architecture => ({architecture, sha256: sources.get(`windows-${architecture}`).sha256})),
  };
  writeFileSync(join(staging, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, {flag: 'wx'});
  const recheckSource = async () => {
    assert.equal(await currentCommit(), commit, 'Main changed during preparation. No completed draft will be written; prepare the new main CI run.');
    assert.equal(await localCommit(), commit, 'The local checkout changed during preparation.');
    const latest = verifyRun(await api(`actions/runs/${options.ciRun}`), context);
    assert.equal(latest.run_attempt, ci.run_attempt, 'The CI run was retried during preparation. Prepare its new artifacts.');
    const latestArtifacts = verifyArtifacts((await pages(`actions/runs/${options.ciRun}/artifacts?per_page=100`)).flatMap(page => page.artifacts ?? []), context);
    assert.deepEqual(latestArtifacts.map(artifact => artifact.id), artifacts.map(artifact => artifact.id), 'The CI artifacts changed during preparation.');
    assert.equal(await tagIdentity(), initialTag, 'The version tag changed during preparation.');
  };
  await recheckSource();
  draft = await readDraft();
  assert.equal(draft?.id ?? null, initialDraftId, 'The draft changed during preparation. Review it before retrying.');
  const jsonRequest = (name, value) => { const file = join(staging, name); writeFileSync(file, JSON.stringify(value), {flag: 'wx'}); return file; };
  const pendingBody = `${notes.trimEnd()}\n\n<!-- gamepack-draft-source: signed-local -->\n\nSigned release preparation is incomplete. Do not publish this draft until the command finishes successfully.\n`;
  if (!draft) {
    draft = verifyDraft(await api('releases', ['--method', 'POST', '--input', jsonRequest('create-draft.json', {
      tag_name: tag, target_commitish: commit, name: `GamePack ${tag}`, body: pendingBody, draft: true, prerelease: false,
    })]), context);
  } else {
    draft = verifyDraft(await api(`releases/${draft.id}`, ['--method', 'PATCH', '--input', jsonRequest('mark-incomplete.json', {body: pendingBody})]), context);
  }
  const draftId = draft.id;
  const currentDraft = async () => verifyDraft(await api(`releases/${draftId}`), context);
  log(`Uploading verified assets to draft ${tag}…`);
  for (const name of expectedAssets.keys()) {
    await currentDraft();
    await command('gh', ['release', 'upload', tag, join(upload, name), '--clobber', '--repo', `github.com/${repository}`]);
  }
  await recheckSource();
  draft = await currentDraft();
  assert.equal(draft.assets.length, 8, 'The draft does not contain exactly eight assets.');
  for (const asset of draft.assets) {
    const expected = expectedAssets.get(asset.name);
    assert.ok(expected && asset.state === 'uploaded' && asset.size === expected.size && asset.digest === `sha256:${expected.sha256}`, `The uploaded asset ${asset.name} could not be verified.`);
  }
  const body = releaseNotes(notes, provenance);
  draft = verifyDraft(await api(`releases/${draftId}`, ['--method', 'PATCH', '--input', jsonRequest('complete-draft.json', {name: `GamePack ${tag}`, body})]), context);
  assert.equal(draft.body, body, 'The final draft notes could not be verified.');
  assert.equal(await tagIdentity(), initialTag, 'The version tag changed unexpectedly. Review the draft before publishing.');
  log(`Draft ${tag} is ready for review: ${draft.html_url}. Nothing was published. Local provenance: ${join(staging, 'provenance.json')}`);
  return {tag, commit, staging, url: draft.html_url, provenance};
}
