import assert from 'node:assert/strict';
import test from 'node:test';
import {activeCommentIds, annotationScene, coloredReview, playbackWindow, reviewColor} from '../packages/app/src/playback.ts';

const second = 1_000_000;
function record(id, anchor) {
  const point = anchor.kind === 'point';
  return {id, comment_id: id, text: 'A review', anchor, drawings: [{id: 'same-stroke-id', tool: 'pen', color: '#FFFFFF', width: 3500,
    visible_from_us: point ? 0 : second / 4, visible_until_us: point ? 0 : second,
    samples: [{x: 100000, y: 200000, t_us: point ? 0 : second / 4}, {x: 700000, y: 800000, t_us: point ? 0 : second / 2}]}]};
}

test('ordinary playback combines reviews in video time without modifying their records', () => {
  const interval = record('interval', {kind: 'interval', start_us: 3 * second, end_us: 5 * second});
  const moment = record('moment', {kind: 'point', at_us: second});
  const original = JSON.stringify([interval, moment]);
  const scene = annotationScene([interval, moment], 10 * second, true);
  assert.equal(scene.anchor.start_us, 0);
  assert.deepEqual(scene.drawings.map(d => [d.visible_from_us, d.visible_until_us, d.samples.map(s => s.t_us)]), [
    [second, 3 * second, [second, second]],
    [3.25 * second, 4 * second, [3.25 * second, 3.5 * second]],
  ]);
  assert.equal(scene.drawings[1].samples[1].x, 700000);
  assert.equal(JSON.stringify([interval, moment]), original);
  assert.notEqual(scene.drawings[0].id, scene.drawings[1].id);
});

test('active comment highlighting follows inclusive starts and exclusive ends after any seek', () => {
  const comments = [record('moment', {kind: 'point', at_us: second}), record('interval', {kind: 'interval', start_us: 2 * second, end_us: 4 * second})];
  for (const [time, expected] of [[0, []], [second, ['moment']], [2 * second, ['moment', 'interval']],
    [3 * second, ['interval']], [4 * second, []], [2.5 * second, ['moment', 'interval']], [0.5 * second, []]]) {
    assert.deepEqual([...activeCommentIds(comments, time, 10 * second)], expected);
  }
});

test('a moment near the end stops at EOF and an exact-EOF point remains viewable while paused', () => {
  assert.deepEqual(playbackWindow({kind: 'point', at_us: 9.5 * second}, 10 * second), {start: 9.5 * second, end: 10 * second});
  const last = record('last', {kind: 'point', at_us: 10 * second});
  assert.equal(activeCommentIds([last], 10 * second, 10 * second).has('last'), true);
  const scene = annotationScene([last], 10 * second, false);
  assert.equal(scene.drawings[0].visible_until_us, 10 * second + 1);
  assert.equal(scene.anchor.end_us, 10 * second + 1);
});

test('comment color matches its drawings for combined and isolated review in each theme', () => {
  const comment = record('stable-comment', {kind: 'interval', start_us: second, end_us: 4 * second});
  for (const dark of [true, false]) {
    const color = reviewColor(comment.comment_id, dark);
    assert.equal(annotationScene([comment], 10 * second, dark).drawings[0].color, color);
    assert.equal(coloredReview(comment, dark).drawings[0].color, color);
    assert.equal(reviewColor(comment.comment_id, dark), color);
  }
  assert.notEqual(reviewColor(comment.comment_id, true), reviewColor(comment.comment_id, false));
  assert.equal(comment.drawings[0].color, '#FFFFFF');
});

test('overlapping drawing order is stable across input order', () => {
  const first = record('a', {kind: 'point', at_us: second});
  const secondComment = record('b', {kind: 'point', at_us: second});
  assert.deepEqual(annotationScene([first, secondComment], 10 * second, true), annotationScene([secondComment, first], 10 * second, true));
});
