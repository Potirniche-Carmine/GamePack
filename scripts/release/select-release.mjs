import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {repository, verifyArtifacts, verifyDraft, verifyRun} from './release.mjs';
import {checkVersion, validateVersion} from './version.mjs';

export function selectRelease({ciRun, run, artifacts, releases, commit, currentMain, version, requestedTag, automatic = false}) {
  assert.match(ciRun, /^[1-9][0-9]{0,19}$/, 'A valid source CI run is required.');
  validateVersion(version);
  const tag = `v${version}`;
  if (!automatic) assert.equal(requestedTag, tag, 'The requested tag must match the checked-out app version.');
  // Verify the source before considering skip cases: a privileged workflow_run
  // must never consume fork or pull-request artifacts, even from a branch named main.
  verifyRun(run, {ciRun, commit: run.head_sha});
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.match(currentMain, /^[a-f0-9]{40}$/);
  const skip = reason => ({prepare: false, reason, tag, commit, ciRun});
  if (run.head_sha !== commit || currentMain !== commit) {
    assert.ok(automatic, 'The source CI run and checkout must match current main.');
    return skip('A newer main commit superseded this source run.');
  }
  assert.ok(Array.isArray(releases) && Array.isArray(artifacts), 'GitHub returned invalid release or artifact metadata.');
  const matching = releases.filter(release => release.tag_name === tag);
  assert.ok(matching.length <= 1, 'Multiple releases use the current version.');
  const existing = matching[0];
  if (existing?.draft === false) return skip(`${tag} is already published; published versions are immutable.`);
  const components = version.split('.').map(Number);
  const newerPublished = releases.some(release => {
    if (release.draft !== false || release.prerelease !== false || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name ?? '')) return false;
    const candidate = release.tag_name.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) if (candidate[i] !== components[i]) return candidate[i] > components[i];
    return false;
  });
  if (newerPublished) {
    assert.ok(automatic, 'A newer stable version is already published.');
    return skip('A newer stable release is already published.');
  }
  if (existing && existing.target_commitish !== commit && automatic)
    return skip('An existing draft targets another commit; preserving it for review.');
  verifyDraft(existing ?? null, {tag, commit});
  if (!artifacts.some(artifact => artifact.name?.startsWith('release-')) && automatic)
    return skip('This source run has no native release artifacts.');
  verifyArtifacts(artifacts, {ciRun, commit});
  return {prepare: true, reason: `Verified ${tag} from main CI ${ciRun}.`, tag, commit, ciRun};
}

export function main(env = process.env) {
  assert.equal(env.GITHUB_REPOSITORY, repository, 'Release automation is restricted to the source repository.');
  const ciRun = env.CI_RUN_ID ?? '';
  assert.match(ciRun, /^[1-9][0-9]{0,19}$/, 'A valid source CI run is required.');
  const api = (suffix, extra = []) => JSON.parse(execFileSync('gh', ['api', '--hostname', 'github.com', `repos/${repository}/${suffix}`, ...extra], {encoding: 'utf8'}));
  const pages = suffix => api(suffix, ['--paginate', '--slurp']);
  const current = api('git/ref/heads/main');
  assert.ok(current.ref === 'refs/heads/main' && current.object?.type === 'commit', 'Main must resolve to a commit.');
  const result = selectRelease({ciRun, run: api(`actions/runs/${ciRun}`),
    artifacts: pages(`actions/runs/${ciRun}/artifacts?per_page=100`).flatMap(page => page.artifacts ?? []),
    releases: pages('releases?per_page=100').flat(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), currentMain: current.object.sha,
    version: checkVersion(), requestedTag: env.REQUESTED_RELEASE_TAG, automatic: env.GITHUB_EVENT_NAME === 'workflow_run'});
  appendFileSync(env.GITHUB_OUTPUT, `prepare=${result.prepare}\ntag=${result.tag}\ncommit=${result.commit}\nci_run=${result.ciRun}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${result.reason}\n`);
  console.log(result.reason);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
