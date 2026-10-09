import {commentThreads, type CommentThread} from './review';
import type {Comment} from './types';

export type DiscussionReply = {comment: Comment; depth: number};

/** Show a complete conversation without requiring users to open each nested
 * branch. Reuse the import-safe tree so malformed parents cannot loop forever. */
function findDiscussion(comments: Comment[], commentId: string): CommentThread | undefined {
  const search: CommentThread[] = commentThreads(comments);
  while (search.length) {
    const node = search.pop()!;
    if (node.comment.comment_id === commentId) return node;
    for (const child of node.children) search.push(child);
  }
  return undefined;
}

export function discussionReplies(comments: Comment[], commentId: string): DiscussionReply[] {
  const root = findDiscussion(comments, commentId);
  if (!root) return [];
  const result: DiscussionReply[] = [];
  const pending = root.children.map(node => ({node, depth: 0})).reverse();
  while (pending.length) {
    const {node, depth} = pending.pop()!;
    result.push({comment: node.comment, depth});
    for (let index = node.children.length - 1; index >= 0; index--)
      pending.push({node: node.children[index], depth: depth + 1});
  }
  return result;
}

/** One click reveals the whole conversation. Collapsing only its root preserves
 * other conversations and the state of nested branches for direct navigation. */
export function toggleDiscussion(comments: Comment[], commentId: string, current: ReadonlySet<string>): Set<string> {
  const next = new Set(current);
  if (next.has(commentId)) { next.delete(commentId); return next; }
  const root = findDiscussion(comments, commentId);
  if (!root) return next;
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.children.length) next.add(node.comment.comment_id);
    for (const child of node.children) pending.push(child);
  }
  return next;
}
