import assert from 'node:assert/strict';
import test from 'node:test';
import {selectRelease} from '../../scripts/release/select-release.mjs';
import {repository, targets} from '../../scripts/release/release.mjs';

const commit = 'a'.repeat(40), other = 'b'.repeat(40), ciRun = '123';
function fixture() {
  return {ciRun, commit, currentMain: commit, version: '1.0.4', automatic: true, releases: [],
    run: {id: 123, repository: {full_name: repository}, head_repository: {full_name: repository}, head_sha: commit,
      head_branch: 'main', path: '.github/workflows/ci.yml', event: 'push', status: 'completed', conclusion: 'success', run_attempt: 1},
    artifacts: targets.map((target, index) => ({id: index + 1, name: `release-${target}`, expired: false, size_in_bytes: 100,
      workflow_run: {id: 123, head_sha: commit, head_branch: 'main'}}))};
}

test('a successful current-main run with every native artifact selects its version for release', () => {
  const result = selectRelease(fixture());
  assert.equal(result.prepare, true); assert.equal(result.tag, 'v1.0.4'); assert.equal(result.commit, commit);
});

for (const patch of [{event: 'pull_request'}, {conclusion: 'failure'}, {status: 'in_progress'}, {head_branch: 'feature'},
  {head_repository: {full_name: 'fork/GamePack'}}, {repository: {full_name: 'fork/GamePack'}}, {path: '.github/workflows/other.yml'}])
  test(`untrusted or incomplete CI metadata is rejected: ${JSON.stringify(patch)}`, () => {
    const value = fixture(); Object.assign(value.run, patch); assert.throws(() => selectRelease(value));
  });

test('delayed completions never publish an older main commit', () => {
  assert.equal(selectRelease({...fixture(), currentMain: other}).prepare, false);
  assert.equal(selectRelease({...fixture(), commit: other, currentMain: other}).prepare, false);
  assert.throws(() => selectRelease({...fixture(), automatic: false, requestedTag: 'v1.0.4', currentMain: other}), /current main/);
});

test('documentation-only successful runs skip release preparation', () => {
  assert.equal(selectRelease({...fixture(), artifacts: []}).prepare, false);
  assert.throws(() => selectRelease({...fixture(), artifacts: [], automatic: false, requestedTag: 'v1.0.4'}), /exactly four/);
});

test('partial or expired artifact sets fail instead of publishing an incomplete release', () => {
  const value = fixture(); value.artifacts.pop(); assert.throws(() => selectRelease(value), /exactly four/);
  const expired = fixture(); expired.artifacts[0].expired = true; assert.throws(() => selectRelease(expired), /expired/);
});

test('already published or superseded versions are skipped without replacing assets', () => {
  for (const tag of ['v1.0.4', 'v1.0.5', 'v2.0.0']) {
    const value = fixture(); value.releases = [{tag_name: tag, draft: false, prerelease: false}];
    assert.equal(selectRelease(value).prepare, false);
  }
  const value = fixture(); value.releases = [{tag_name: 'v1.0.3', draft: false, prerelease: false}];
  assert.equal(selectRelease(value).prepare, true);
});

test('same-version drafts from other commits are preserved, and matching signed drafts can resume', () => {
  const value = fixture(); value.releases = [{id: 10, tag_name: 'v1.0.4', target_commitish: other, draft: true, prerelease: false, assets: []}];
  assert.equal(selectRelease(value).prepare, false);
  assert.throws(() => selectRelease({...value, automatic: false, requestedTag: 'v1.0.4'}), /different commit/);
  value.releases[0].target_commitish = commit; assert.equal(selectRelease(value).prepare, true);
});

test('manual dispatches require the exact current app version', () => {
  assert.throws(() => selectRelease({...fixture(), automatic: false, requestedTag: 'v9.0.0'}), /match/);
  assert.equal(selectRelease({...fixture(), automatic: false, requestedTag: 'v1.0.4'}).prepare, true);
});
