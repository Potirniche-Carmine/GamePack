import assert from 'node:assert/strict';
import test from 'node:test';
import {commentThreads, expandedAncestors, mergeDrawings, visibleThreads} from '../packages/app/src/review.ts';

test('a held stroke delivered in both an event and the flush acknowledgment is saved exactly once', () => {
  const first = {id: 'first', samples: [{x: 1, y: 2}]}, last = {id: 'last', samples: [{x: 3, y: 4}]};
  const existing = [first];
  assert.deepEqual(mergeDrawings(existing, [first, last, last]), [first, last]);
  assert.deepEqual(existing, [first]);
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
