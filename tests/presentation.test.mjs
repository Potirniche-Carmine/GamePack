import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationTarget, noteWindow, notesAtTime, adjacentNote} from '../packages/app/src/presentation.ts';
import {commentThreads, replyBranches, toggleReplies, visibleThreads} from '../packages/app/src/review.ts';

const second = 1_000_000;
const comment = (id, start = 0, end = 12) => ({comment_id: id, parent_comment_id: null, anchor: {kind: 'interval', start_us: start * second, end_us: end * second}, drawings: []});
const mark = (from, until, x = 750000) => ({visible_from_us: from * second, visible_until_us: until * second, samples: [{x, y: 100000, t_us: from * second}]});

test('video comments begin with the first drawing sample and last until the final mark ends', () => {
  const note = {...comment('coach', 2, 20), drawings: [mark(3, 6), mark(5, 12)]};
  const original = JSON.stringify(note);
  assert.deepEqual(noteWindow(note, 30 * second), {start: 5 * second, end: 14 * second});
  for (const [time, count] of [[4.99, 0], [5, 1], [7, 1], [13.99, 1], [14, 0], [6, 1], [1, 0]]) {
    assert.equal(notesAtTime([note], time * second, 30 * second).length, count);
  }
  assert.equal(JSON.stringify(note), original);
});

test('text-only ranges, simultaneous notes and EOF moments remain reachable', () => {
  const range = comment('range', 3, 8);
  const point = {...comment('point'), anchor: {kind: 'point', at_us: 3 * second}};
  assert.deepEqual(notesAtTime([range, point], 4 * second, 10 * second).map(item => item.comment_id), ['point', 'range']);
  assert.deepEqual(notesAtTime([range, point], 5 * second, 10 * second).map(item => item.comment_id), ['range']);
  const eof = {...point, anchor: {kind: 'point', at_us: 10 * second}};
  assert.equal(notesAtTime([eof], 10 * second, 10 * second).length, 1);
});

test('note navigation uses the playhead when unselected and visits equal-time notes in both directions', () => {
  const notes = [comment('b', 2), comment('c', 8), comment('a', 2)];
  assert.equal(adjacentNote(notes, null, 0, 30 * second, 1).comment_id, 'a');
  assert.equal(adjacentNote(notes, 'a', 2 * second, 30 * second, 1).comment_id, 'b');
  assert.equal(adjacentNote(notes, 'b', 2 * second, 30 * second, -1).comment_id, 'a');
  assert.equal(adjacentNote(notes, null, 7 * second, 30 * second, -1).comment_id, 'b');
  assert.equal(adjacentNote(notes, 'c', 8 * second, 30 * second, 1), undefined);
  assert.equal(adjacentNote(notes, 'a', 2 * second, 30 * second, -1), undefined);
});

test('individual and global disclosure show and remove real reply rows, including nested replies', () => {
  const records = [comment('root'), {...comment('reply'), parent_comment_id: 'root'}, {...comment('nested'), parent_comment_id: 'reply'}, comment('other')];
  const roots = commentThreads(records), collapsed = new Set();
  const ids = state => visibleThreads(roots, state).map(item => item.node.comment.comment_id);
  const opened = toggleReplies(collapsed, 'root');
  assert.deepEqual(ids(opened), ['root', 'reply', 'other']);
  assert.deepEqual(ids(toggleReplies(opened, 'root')), ['root', 'other']);
  assert.deepEqual(ids(replyBranches(roots)), ['root', 'reply', 'nested', 'other']);
  assert.equal(collapsed.size, 0);
});

test('replies remain in discussion and never become playback overlays or navigation stops', () => {
  const root = comment('coach', 2, 8), next = comment('next', 9, 12);
  const reply = {...comment('player', 3, 7), parent_comment_id: 'coach'};
  const nested = {...comment('follow-up', 4, 6), parent_comment_id: 'player', drawings: [mark(0, 1)]};
  const records = [nested, reply, next, root];
  assert.deepEqual(notesAtTime(records, 4 * second, 30 * second).map(item => item.comment_id), ['coach']);
  assert.equal(adjacentNote(records, 'coach', 2 * second, 30 * second, 1).comment_id, 'next');
  assert.equal(adjacentNote(records, 'follow-up', 4 * second, 30 * second, 1).comment_id, 'next');
  assert.equal(adjacentNote(records, 'next', 9 * second, 30 * second, -1).comment_id, 'coach');
});

test('reply creation and publication target the root first visible drawing, including stale state', () => {
  const root = {...comment('coach', 0, 10), drawings: [mark(3, 8)]};
  const child = {...comment('reply', 0, 10), parent_comment_id: 'coach'};
  const nested = {...comment('new-reply', 9, 10), parent_comment_id: 'reply'};
  for (const [records, item] of [[[root], child], [[root, child], child], [[root, child], nested]]) {
    const target = conversationTarget(records, item, 15 * second);
    assert.equal(target.comment.comment_id, 'coach');
    assert.equal(target.time, 3 * second);
    assert.equal(notesAtTime(records, target.time, 15 * second)[0].comment_id, 'coach');
  }
  assert.deepEqual(conversationTarget([root], root, 15 * second), {comment: root, time: 3 * second});
  const orphan = {...comment('orphan', 5, 6), parent_comment_id: 'missing'};
  assert.deepEqual(conversationTarget([], orphan, 15 * second), {comment: orphan, time: 5 * second});
});
