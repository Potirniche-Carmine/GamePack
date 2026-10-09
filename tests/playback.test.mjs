import assert from 'node:assert/strict';
import test from 'node:test';
import {activeCommentIds, annotationScene, reviewScene, commentColorMap, playbackWindow} from '../packages/app/src/playback.ts';

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
  const scene = annotationScene([interval, moment], 10 * second);
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
  const scene = annotationScene([last], 10 * second);
  assert.equal(scene.drawings[0].visible_until_us, 10 * second + 1);
  assert.equal(scene.anchor.end_us, 10 * second + 1);
});

test('combined and selected playback preserve every original stroke color in both themes', () => {
  const comment = record('stable-comment', {kind: 'interval', start_us: second, end_us: 4 * second});
  comment.drawings.push({...comment.drawings[0], id: 'blue', color: '#79BFFD'});
  for (const dark of [true, false]) {
    const colors = commentColorMap([comment], dark);
    assert.deepEqual(annotationScene([comment], 10 * second).drawings.map(d => d.color), ['#FFFFFF', '#79BFFD']);
    assert.deepEqual(reviewScene(comment).drawings.map(d => d.color), ['#FFFFFF', '#79BFFD']);
    assert.ok(colors.has(comment.comment_id));
  }
});

test('pin colors follow the author across comments and imported ordering', () => {
  const comments = ['first', 'second'].map(id => ({...record(id, {kind: 'point', at_us: second}), author_id: 'same-author'}));
  for (const dark of [true, false]) {
    const colors = commentColorMap(comments, dark);
    assert.equal(colors.get('first'), colors.get('second'));
    assert.equal(commentColorMap([comments[1]], dark).get('second'), colors.get('second'));
  }
});

test('neighboring reviews receive distinct colors and adding later reviews preserves existing colors', () => {
  const comments = Array.from({length: 4}, (_, index) => ({...record(`review-${index}`, {kind: 'point', at_us: second}), created_at_reported: index + 1}));
  const colors = commentColorMap(comments, true);
  assert.equal(new Set(colors.values()).size, 4);
  assert.deepEqual([...commentColorMap(comments.slice(0, 3), true)], [...colors].slice(0, 3));
  assert.deepEqual(commentColorMap([...comments].reverse(), true), colors);
  assert.equal(reviewScene(comments[2]).drawings[0].color, annotationScene(comments, 10 * second).drawings[2].color);
});

test('reviewer hash collisions use available pin colors while keeping an author consistent', () => {
  const comments = ['a', 'f', 'k'].map((author_id, index) => ({...record(`note-${index}`, {kind: 'point', at_us: second}), author_id, created_at_reported: index + 1}));
  const repeated = {...comments[1], comment_id: 'same-reviewer', created_at_reported: 4};
  for (const dark of [true, false]) {
    const colors = commentColorMap([...comments, repeated], dark);
    assert.equal(new Set(comments.map(comment => colors.get(comment.comment_id))).size, 3);
    assert.equal(colors.get(repeated.comment_id), colors.get(comments[1].comment_id));
    assert.deepEqual(commentColorMap([...comments, repeated].reverse(), dark), colors);
  }
});

test('overlapping drawing order is stable across input order', () => {
  const first = record('a', {kind: 'point', at_us: second});
  const secondComment = record('b', {kind: 'point', at_us: second});
  assert.deepEqual(annotationScene([first, secondComment], 10 * second), annotationScene([secondComment, first], 10 * second));
});
