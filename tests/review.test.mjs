import assert from 'node:assert/strict';
import test from 'node:test';
import {beginLiveDraft, capturedDraft, commentThreads, expandedAncestors, finalizeCapturedClip, finalizeLiveDraft, liveScene, mergeDrawings, visibleThreads} from '../packages/app/src/review.ts';

const second = 1_000_000;
const stroke = (id, times, tool = 'pen') => ({id, tool, color: '#79BFFD', width: 3500,
  visible_from_us: times[0], visible_until_us: 20 * second,
  samples: times.map((t_us, index) => ({x: index * 150000, y: 500000 - index * 100000, t_us}))});
const draft = (drawings = []) => ({id: 'draft', project_id: 'project', video_id: 'video', text: '',
  anchor: {kind: 'interval', start_us: second, end_us: 20 * second}, drawings});

test('capture begins at the first stroke and rebases every sample without changing geometry', () => {
  const original = draft([stroke('pen', [3 * second, 3.5 * second]), stroke('arrow', [4 * second, 4.5 * second], 'arrow')]);
  const snapshot = JSON.stringify(original);
  const result = finalizeCapturedClip(original, 8 * second, 30 * second);
  assert.deepEqual(result.anchor, {kind: 'interval', start_us: 4 * second, end_us: 8 * second});
  assert.deepEqual(result.drawings.map(mark => mark.samples.map(sample => sample.t_us)), [[0, second / 2], [second, 1.5 * second]]);
  assert.deepEqual(result.drawings.map(mark => [mark.visible_from_us, mark.visible_until_us]), [[0, 4 * second], [second, 4 * second]]);
  assert.equal(result.drawings[1].samples[1].x, original.drawings[1].samples[1].x);
  assert.equal(JSON.stringify(original), snapshot);
});

test('exclusive capture end includes a sample at the exact stop and preserves marks after backward seeks', () => {
  const result = finalizeCapturedClip(draft([stroke('mark', [2 * second, 7 * second])]), 4 * second, 30 * second, 9 * second);
  assert.deepEqual(result.anchor, {kind: 'interval', start_us: 3 * second, end_us: 9 * second});
  const lastAtStop = finalizeCapturedClip(draft([stroke('mark', [2 * second, 7 * second])]), 8 * second, 30 * second);
  assert.equal(lastAtStop.anchor.end_us, 8 * second + 1);
  assert.equal(lastAtStop.drawings[0].samples.at(-1).t_us, 5 * second);
  assert.ok(lastAtStop.drawings[0].samples.at(-1).t_us < lastAtStop.drawings[0].visible_until_us);
});

test('a paused moment becomes a live interval with all existing point geometry at offset zero', () => {
  const point = {...draft([stroke('ellipse', [0, 0], 'ellipse')]), anchor: {kind: 'point', at_us: 5 * second}};
  const live = beginLiveDraft(point, 30 * second, 5 * second);
  assert.deepEqual(live.anchor, {kind: 'interval', start_us: 5 * second, end_us: 5 * second + 1});
  assert.deepEqual(live.drawings[0].samples.map(sample => sample.t_us), [0, 0]);
  assert.equal(live.drawings[0].visible_until_us, 1);
  const finished = finalizeCapturedClip(live, 8 * second, 30 * second);
  assert.deepEqual(finished.anchor, {kind: 'interval', start_us: 5 * second, end_us: 8 * second});
  assert.throws(() => beginLiveDraft({...point, anchor: {kind: 'point', at_us: 30 * second}}, 30 * second), /before the end/);
});

test('drawing-free capture becomes a text-comment moment at the native stop', () => {
  assert.deepEqual(finalizeCapturedClip(draft(), 8 * second, 30 * second).anchor, {kind: 'point', at_us: 8 * second});
});

test('drawing on a frozen frame posts a visible moment and can resume into a longer review', () => {
  const frozen = draft([stroke('first', [4 * second, 4 * second]), stroke('second', [4 * second, 4 * second])]);
  const posted = finalizeCapturedClip(frozen, 5 * second, 30 * second, 5 * second);
  assert.deepEqual(posted.anchor, {kind: 'point', at_us: 5 * second});
  assert.deepEqual(posted.drawings.map(mark => mark.samples.map(sample => sample.t_us)), [[0, 0], [0, 0]]);
  const resumed = beginLiveDraft(posted, 30 * second, 5 * second);
  const continued = {...resumed, drawings: [...resumed.drawings, stroke('later', [3 * second, 3 * second])]};
  const result = finalizeCapturedClip(continued, 8 * second, 30 * second, 8 * second);
  assert.deepEqual(result.anchor, {kind: 'interval', start_us: 5 * second, end_us: 8 * second + 1});
  assert.equal(result.drawings.length, 3);
  assert.equal(result.drawings[2].samples[0].t_us, 3 * second);
});

test('native pause clock settling does not create a disappearing submillisecond comment', () => {
  const frozen = draft([stroke('first', [4 * second, 4 * second + 89])]);
  const posted = finalizeCapturedClip(frozen, 5 * second + 177, 30 * second, 5 * second + 177);
  assert.deepEqual(posted.anchor, {kind: 'point', at_us: 5 * second});
  assert.deepEqual(posted.drawings[0].samples.map(sample => sample.t_us), [0, 0]);
  const resumed = finalizeCapturedClip(frozen, 5 * second + 10000, 30 * second);
  assert.equal(resumed.anchor.kind, 'interval');
});

test('a persisted live snapshot restores the first-stroke origin and complete visibility range', () => {
  const live = draft([stroke('first', [3 * second, 3.5 * second])]);
  const restored = JSON.parse(JSON.stringify(finalizeCapturedClip(live, 9 * second, 30 * second)));
  assert.deepEqual(restored.anchor, {kind: 'interval', start_us: 4 * second, end_us: 9 * second});
  assert.equal(restored.drawings[0].visible_until_us, 5 * second);
  assert.deepEqual(restored.drawings[0].samples.map(sample => sample.t_us), [0, second / 2]);
  const continued = beginLiveDraft(restored, 30 * second, 9 * second);
  const saved = finalizeCapturedClip(continued, 10 * second, 30 * second);
  assert.equal(saved.anchor.start_us, 4 * second);
  assert.equal(saved.anchor.end_us, 10 * second);
});

test('closing a live draft normalizes the outgoing in-memory draft before a later autosave can overwrite recovery', () => {
  const outgoing = {...draft([stroke('first', [3 * second, 3.5 * second])]), anchor: {kind: 'interval', start_us: second, end_us: 9 * second}};
  // The native close acknowledgment replaces the provisional render draft;
  // future timers now save this same normalized value even after live mode ends.
  const closed = capturedDraft(outgoing, undefined, 9 * second, 30 * second, 9 * second, true);
  const reopened = JSON.parse(JSON.stringify(closed));
  assert.deepEqual(reopened.anchor, {kind: 'interval', start_us: 4 * second, end_us: 9 * second});
  assert.equal(reopened.drawings[0].visible_until_us, 5 * second);
  assert.deepEqual(reopened.drawings[0].samples.map(sample => sample.t_us), [0, second / 2]);
  assert.equal(outgoing.anchor.start_us, second);
});

test('navigation keeps a held first stroke delivered only in the capture acknowledgment', () => {
  const pending = stroke('held', [3 * second, 7 * second]);
  const outgoing = {...draft(), anchor: {kind: 'interval', start_us: second, end_us: second + 1}};
  const closed = capturedDraft(outgoing, pending, 8 * second, 30 * second, 8 * second, true);
  assert.deepEqual(closed.anchor, {kind: 'interval', start_us: 4 * second, end_us: 8 * second + 1});
  assert.deepEqual(closed.drawings[0].samples.map(sample => sample.t_us), [0, 4 * second]);
  assert.equal(closed.drawings[0].visible_until_us, 4 * second + 1);
  assert.equal(outgoing.drawings.length, 0);
});

test('a navigation acknowledgment merges once and retains a paused moment anchor', () => {
  const pending = stroke('held', [0, 0], 'ellipse');
  const point = {...draft([pending]), anchor: {kind: 'point', at_us: 5 * second}};
  const closed = capturedDraft(point, pending, 5 * second, 30 * second, 5 * second, false);
  assert.equal(closed.drawings.length, 1);
  assert.deepEqual(closed.anchor, point.anchor);
  assert.deepEqual(closed.drawings[0].samples, point.drawings[0].samples);
});

test('autosave bounds completed strokes while the rendering scene can continue to the video end', () => {
  const saved = finalizeLiveDraft({...draft([stroke('mark', [2 * second, 3 * second])]), anchor: {kind: 'interval', start_us: second, end_us: second + 1}}, 4 * second, 30 * second);
  assert.equal(saved.anchor.end_us, 4 * second + 1);
  assert.equal(saved.drawings[0].visible_until_us, 3 * second + 1);
  const scene = liveScene(saved, 30 * second);
  assert.equal(scene.id, saved.id);
  assert.equal(scene.drawings[0].visible_until_us, 29 * second);
  assert.equal(saved.drawings[0].visible_until_us, 3 * second + 1);
});

test('large timed strokes keep all samples without argument-spread limits', () => {
  const samples = Array.from({length: 200000}, (_, t_us) => ({x: t_us, y: 100000, t_us}));
  const original = draft([{...stroke('long', [0]), samples}]);
  const saved = finalizeCapturedClip(original, 2 * second, 30 * second);
  assert.equal(saved.drawings[0].samples.length, 200000);
  assert.equal(saved.drawings[0].samples.at(-1).t_us, 199999);
  assert.equal(saved.drawings[0].samples.at(-1).x, 199999);
});

test('queued drawing events and the final native ACK merge once by immutable drawing id', () => {
  const first = stroke('first', [0]); const last = stroke('last', [second]);
  assert.deepEqual(mergeDrawings([first], [first, last, last]).map(mark => mark.id), ['first', 'last']);
});

const comment = (id, parent = null) => ({comment_id: id, parent_comment_id: parent});
test('nested replies expand their own descendants and posting reveals the complete ancestor chain', () => {
  const records = [comment('root'), comment('reply', 'root'), comment('deep', 'reply'), comment('other')];
  const roots = commentThreads(records);
  assert.deepEqual(visibleThreads(roots, new Set()).map(item => item.node.comment.comment_id), ['root', 'other']);
  assert.deepEqual(visibleThreads(roots, new Set(['root'])).map(item => [item.node.comment.comment_id, item.depth]), [['root', 0], ['reply', 1], ['other', 0]]);
  const expanded = expandedAncestors(records, 'deep', new Set());
  assert.deepEqual([...expanded], ['reply', 'root']);
  assert.deepEqual(visibleThreads(roots, expanded).map(item => item.depth), [0, 1, 2, 0]);
});

test('deep replies, missing parents, and cycles keep every comment reachable without recursion', () => {
  const records = Array.from({length: 12000}, (_, i) => comment(String(i), i ? String(i - 1) : null));
  const expanded = expandedAncestors(records, '11999', new Set());
  assert.equal(visibleThreads(commentThreads(records), expanded).length, 12000);
  const malformed = [comment('a', 'b'), comment('b', 'a'), comment('orphan', 'missing'), comment('self', 'self')];
  const visible = visibleThreads(commentThreads(malformed), new Set(malformed.map(item => item.comment_id)));
  assert.equal(visible.length, malformed.length);
  assert.equal(new Set(visible.map(item => item.node.comment.comment_id)).size, malformed.length);
});
