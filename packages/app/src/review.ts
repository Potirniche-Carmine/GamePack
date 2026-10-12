import type {Comment, Drawing} from './types';

export function mergeDrawings(existing: Drawing[], incoming: Drawing[]): Drawing[] {
  const ids = new Set(existing.map(item => item.id));
  return [...existing, ...incoming.filter(item => { if (ids.has(item.id)) return false; ids.add(item.id); return true; })];
}

export type CommentThread = {comment: Comment; children: CommentThread[]};
export function replyBranches(roots: CommentThread[]): Set<string> {
  const ids = new Set<string>(), stack = [...roots];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.children.length) ids.add(node.comment.comment_id);
    for (const child of node.children) stack.push(child);
  }
  return ids;
}

export function toggleReplies(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
/** Missing parents and cycles become roots so every immutable comment remains
 * reachable. Building and flattening are iterative to tolerate deep replies. */
export function commentThreads(comments: Comment[]): CommentThread[] {
  const nodes = new Map(comments.map(comment => [comment.comment_id, {comment, children: [] as CommentThread[]}]));
  const parent = new Map<string, string>();
  for (const item of comments) {
    const candidate = item.parent_comment_id;
    if (candidate && candidate !== item.comment_id && nodes.has(candidate)) parent.set(item.comment_id, candidate);
  }
  const done = new Set<string>();
  for (const id of nodes.keys()) {
    const path: string[] = []; const seen = new Set<string>(); let current: string | undefined = id;
    while (current && !done.has(current)) {
      if (seen.has(current)) { parent.delete(current); break; }
      seen.add(current); path.push(current); current = parent.get(current);
    }
    path.forEach(value => done.add(value));
  }
  const roots: CommentThread[] = [];
  for (const [id, node] of nodes) {
    const parentId = parent.get(id);
    if (parentId) nodes.get(parentId)!.children.push(node); else roots.push(node);
  }
  return roots;
}

export function visibleThreads(roots: CommentThread[], expanded: ReadonlySet<string>): {node: CommentThread; depth: number}[] {
  const result: {node: CommentThread; depth: number}[] = [];
  const stack = roots.map(node => ({node, depth: 0})).reverse();
  while (stack.length) {
    const current = stack.pop()!; result.push(current);
    if (expanded.has(current.node.comment.comment_id))
      for (let i = current.node.children.length - 1; i >= 0; i--) stack.push({node: current.node.children[i], depth: current.depth + 1});
  }
  return result;
}

export function expandedAncestors(comments: Comment[], commentId: string, current: ReadonlySet<string>): Set<string> {
  const result = new Set(current);
  const byId = new Map(comments.map(item => [item.comment_id, item]));
  const seen = new Set<string>(); let item = byId.get(commentId);
  while (item?.parent_comment_id && !seen.has(item.comment_id)) {
    seen.add(item.comment_id); result.add(item.parent_comment_id); item = byId.get(item.parent_comment_id);
  }
  return result;
}
