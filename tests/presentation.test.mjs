import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationNumbers, conversationTarget, notesAtTime, adjacentNote, nextReviewStop} from '../packages/app/src/presentation.ts';
const second = 1_000_000;
const comment = (id, at = 0, parent = null) => ({comment_id: id, parent_comment_id: parent, anchor: {kind: 'point', at_us: at * second}, drawings: []});

test('simultaneous notes show on one frame, including at EOF, without a two-second window', () => {
  const notes = [comment('a', 3), comment('b', 3), comment('c', 10)];
  assert.deepEqual(notesAtTime(notes, 3 * second).map(note => note.comment_id), ['a', 'b']);
  assert.equal(notesAtTime(notes, 4 * second).length, 0);
  assert.equal(notesAtTime(notes, 3 * second + 16667).length, 0);
  assert.equal(notesAtTime(notes, 10 * second).length, 1);
});

test('navigation visits equal-time notes and skips replies in both directions', () => {
  const notes = [comment('b', 2), comment('c', 8), comment('a', 2), comment('reply', 2, 'a')];
  assert.equal(adjacentNote(notes, null, 0, 30 * second, 1).comment_id, 'a');
  assert.equal(adjacentNote(notes, 'a', 2 * second, 30 * second, 1).comment_id, 'b');
  assert.equal(adjacentNote(notes, 'b', 2 * second, 30 * second, -1).comment_id, 'a');
  assert.equal(adjacentNote(notes, 'reply', 2 * second, 30 * second, 1).comment_id, 'b');
  assert.equal(adjacentNote(notes, null, 7 * second, 30 * second, -1).comment_id, 'b');
  assert.equal(adjacentNote(notes, 'c', 8 * second, 30 * second, 1), undefined);
});

test('nested and just-posted replies open the root conversation at its frame', () => {
  const root = comment('root', 3), child = comment('reply', 3, 'root'), nested = comment('nested', 3, 'reply');
  for (const [records, item] of [[[root], child], [[root, child], nested]]) {
    assert.deepEqual(conversationTarget(records, item, 15 * second), {comment: root, time: 3 * second});
    assert.deepEqual(notesAtTime(records, 3 * second).map(note => note.comment_id), ['root']);
  }
});

test('review stops group comments, resume skips that frame, seeking back rearms it', () => {
  const records = [comment('a', 1), comment('b', 1), comment('reply', 1, 'a'), comment('next', 6)];
  const stop = {time: second, commentIds: ['a', 'b']};
  assert.deepEqual(nextReviewStop(records, 0, 10 * second), stop);
  assert.deepEqual(nextReviewStop(records, second, 10 * second, 1, true), {time: 6 * second, commentIds: ['next']});
  assert.deepEqual(nextReviewStop(records, 0, 10 * second), stop);
  assert.deepEqual(nextReviewStop(records, 7 * second, 10 * second, -1), {time: 6 * second, commentIds: ['next']});
  assert.equal(nextReviewStop(records, second + 177, 10 * second, -1, true), null);
  assert.equal(nextReviewStop(records, 6 * second, 10 * second, 1, true), null);
});

test('zero-time and final-frame comments are valid review stops', () => {
  const records = [comment('first'), comment('last', 10)];
  assert.deepEqual(nextReviewStop(records, 0, 10 * second), {time: 0, commentIds: ['first']});
  assert.deepEqual(nextReviewStop(records, 0, 10 * second, 1, true), {time: 10 * second, commentIds: ['last']});
  assert.equal(nextReviewStop(records, 0, 0), null);
});

test('Play leaves every comment on the visible frame and still stops at the next frame', () => {
  const records = [comment('opening'), comment('also-opening'), comment('next', 1), comment('last', 10)];
  for (const from of [0, 177, 2000]) {
    assert.deepEqual(nextReviewStop(records, from, 10 * second, 1, true), {time: second, commentIds: ['next']});
  }
  // An opening annotation is still reached when playing backward from later.
  assert.deepEqual(nextReviewStop(records, second, 10 * second, -1, true), {time: 0, commentIds: ['opening', 'also-opening']});
  assert.equal(nextReviewStop(records.slice(0, 2), 0, 10 * second, 1, true), null);
  // Scrubbing onto another annotated frame should have the same resume behavior.
  assert.deepEqual(nextReviewStop(records, second - 177, 10 * second, 1, true), {time: 10 * second, commentIds: ['last']});
  assert.deepEqual(nextReviewStop(records, second - 16667, 10 * second, 1, true), {time: second, commentIds: ['next']});
});


test('only same-frame root conversations receive stable local numbers', () => {
  const records = [comment('later', 5), comment('b', 3), comment('reply', 3, 'a'), comment('a', 3), comment('alone', 1)];
  const before = structuredClone(records);
  assert.deepEqual([...conversationNumbers(notesAtTime(records, 3 * second))], [['a', 1], ['b', 2]]);
  assert.deepEqual([...conversationNumbers(notesAtTime([...records].reverse(), 3 * second))], [['a', 1], ['b', 2]]);
  assert.deepEqual([...conversationNumbers([comment('alone'), comment('reply', 0, 'alone')])], []);
  assert.deepEqual([...conversationNumbers([])], []);
  assert.deepEqual(records, before);
});

test('notes within native clock tolerance still receive distinct numbers', () => {
  const records = [comment('a', 1), comment('b', 1.0015), comment('c', 1.003)];
  assert.deepEqual([...conversationNumbers(notesAtTime(records, 1001500))], [['a', 1], ['b', 2], ['c', 3]]);
});
