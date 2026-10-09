import assert from 'node:assert/strict';
import test from 'node:test';
import {conversationRoot, discussionReplies, toggleDiscussion} from '../packages/app/src/discussion.ts';
import {commentThreads, expandedAncestors, visibleThreads} from '../packages/app/src/review.ts';

const comment = (id, parent = null) => ({comment_id: id, parent_comment_id: parent});

test('opening a conversation includes replies to replies in conversation order', () => {
  const comments = [comment('root'), comment('first', 'root'), comment('second', 'root'),
    comment('nested', 'first'), comment('deep', 'nested'), comment('other'), comment('unrelated', 'other')];
  const before = JSON.stringify(comments);
  assert.deepEqual(discussionReplies(comments, 'root').map(({comment, depth}) => [comment.comment_id, depth]),
    [['first', 0], ['nested', 1], ['deep', 2], ['second', 0]]);
  assert.equal(JSON.stringify(comments), before);
  assert.deepEqual(discussionReplies(comments, 'nested').map(({comment}) => comment.comment_id), ['deep']);
});

test('leaf comments, missing comments and missing parents remain safe', () => {
  const comments = [comment('orphan', 'missing'), comment('child', 'orphan'), comment('self', 'self')];
  assert.deepEqual(discussionReplies(comments, 'orphan').map(({comment}) => comment.comment_id), ['child']);
  assert.deepEqual(discussionReplies(comments, 'missing'), []);
  assert.deepEqual(discussionReplies(comments, 'child'), []);
  assert.deepEqual(discussionReplies(comments, 'self'), []);
});

test('a cyclic imported conversation never loops or repeats a reply', () => {
  const comments = [comment('a', 'b'), comment('b', 'c'), comment('c', 'a'), comment('d', 'b')];
  for (const {comment_id} of comments) {
    const replies = discussionReplies(comments, comment_id).map(({comment}) => comment.comment_id);
    assert.equal(new Set(replies).size, replies.length);
    assert.ok(!replies.includes(comment_id));
    assert.ok(replies.length < comments.length);
  }
});

test('deep imported conversations expose every descendant without recursive traversal', () => {
  const comments = Array.from({length: 15000}, (_, index) => comment(`${index}`, index ? `${index - 1}` : null));
  const replies = discussionReplies(comments, '0');
  assert.equal(replies.length, comments.length - 1);
  assert.equal(replies.at(-1).comment.comment_id, '14999');
  assert.equal(replies.at(-1).depth, 14998);
});

test('selecting then opening a comment reveals its full subtree and a second click collapses it', () => {
  const comments = [comment('root'), comment('first', 'root'), comment('second', 'root'),
    comment('nested', 'first'), comment('deep', 'nested'), comment('other'), comment('unrelated', 'other')];
  const roots = commentThreads(comments);
  const original = new Set(['other']);
  const selected = expandedAncestors(comments, 'root', original);
  const expanded = toggleDiscussion(comments, 'root', selected);
  assert.deepEqual([...expanded].sort(), ['first', 'nested', 'other', 'root']);
  assert.deepEqual(visibleThreads(roots, expanded).map(({node}) => node.comment.comment_id),
    ['root', 'first', 'nested', 'deep', 'second', 'other', 'unrelated']);
  const selectedAgain = expandedAncestors(comments, 'root', expanded);
  const collapsed = toggleDiscussion(comments, 'root', selectedAgain);
  assert.deepEqual(visibleThreads(roots, collapsed).map(({node}) => node.comment.comment_id), ['root', 'other', 'unrelated']);
  assert.deepEqual([...original], ['other']);
  assert.deepEqual(toggleDiscussion(comments, 'unknown', original), original);
});

test('inline reply roots remain reachable across independent anchors and broken imports', () => {
  const root = {...comment('root'), anchor: {kind: 'point', at_us: 0}};
  const child = {...comment('child', 'root'), anchor: {kind: 'point', at_us: 9000000}};
  assert.equal(conversationRoot([root, child], 'child'), root);
  assert.equal(conversationRoot([child], 'child'), child);
  assert.equal(conversationRoot([root], 'unknown'), undefined);
  assert.ok(conversationRoot([comment('a', 'b'), comment('b', 'a')], 'a'));
});
