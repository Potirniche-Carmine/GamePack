import type {Comment} from './types';
import {playbackWindow} from './playback';
import {conversationRoot} from './discussion';

export function noteWindow(comment: Comment, duration: number): {start: number; end: number} {
  const window = playbackWindow(comment.anchor, duration);
  if (comment.anchor.kind === 'point' || !comment.drawings.length) return window;
  let first = Infinity, last = 0;
  for (const mark of comment.drawings) {
    first = Math.min(first, Math.max(mark.visible_from_us, mark.samples[0]?.t_us ?? 0));
    last = Math.max(last, mark.visible_until_us);
  }
  return {start: window.start + first, end: Math.min(window.end, window.start + last)};
}

/** Replies open the visible root card, including a just-posted reply that has
 * not reached the current React state snapshot yet. */
export function conversationTarget(comments: readonly Comment[], item: Comment, duration: number): {comment: Comment; time: number} {
  const root = item.parent_comment_id ? conversationRoot(comments, item.parent_comment_id) ?? item : item;
  return {comment: root, time: noteWindow(root, duration).start};
}

export function notesAtTime(comments: readonly Comment[], time: number, duration: number): Comment[] {
  return comments.filter(comment => {
    if (comment.parent_comment_id) return false;
    const {start, end} = noteWindow(comment, duration);
    return time >= start && time < end;
  }).sort((a, b) => noteWindow(a, duration).start - noteWindow(b, duration).start || a.comment_id.localeCompare(b.comment_id));
}

export function adjacentNote(comments: readonly Comment[], selected: string | null, time: number, duration: number, direction: -1 | 1): Comment | undefined {
  const ordered = comments.filter(item => !item.parent_comment_id).sort((a, b) => noteWindow(a, duration).start - noteWindow(b, duration).start || a.comment_id.localeCompare(b.comment_id));
  const visited = new Set<string>();
  while (selected && !visited.has(selected)) {
    visited.add(selected);
    const parent = comments.find(item => item.comment_id === selected)?.parent_comment_id;
    if (!parent) break;
    selected = parent;
  }
  const index = ordered.findIndex(item => item.comment_id === selected);
  if (index !== -1) return ordered[index + direction];
  return direction === 1 ? ordered.find(item => noteWindow(item, duration).start >= time) : ordered.reverse().find(item => noteWindow(item, duration).start < time);
}
