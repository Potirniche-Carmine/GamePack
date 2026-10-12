import type {Comment} from './types';
import {sameFrame, compareComments} from './playback';
import {conversationRoot} from './discussion';

/** Replies open the visible root card, including a just-posted reply that has
 * not reached the current React state snapshot yet. */
export function conversationTarget(comments: readonly Comment[], item: Comment, _duration: number): {comment: Comment; time: number} {
  const root = item.parent_comment_id ? conversationRoot(comments, item.parent_comment_id) ?? item : item;
  return {comment: root, time: root.anchor.at_us};
}

export function notesAtTime(comments: readonly Comment[], time: number): Comment[] {
  return comments.filter(comment => !comment.parent_comment_id && sameFrame(comment.anchor.at_us, time))
    .sort(compareComments);
}

/** A conversation has one marker, even when its comment and replies contain
 * several drawings. Prefer the root's geometry, falling back to a visible reply. */
export function conversationPins(comments: readonly Comment[], notes: readonly Comment[], zoom: number) {
  return notes.flatMap(note => {
    const drawings = [note, ...comments.filter(comment => comment.comment_id !== note.comment_id
      && conversationRoot(comments, comment.comment_id)?.comment_id === note.comment_id).sort(compareComments)]
      .flatMap(comment => comment.drawings);
    for (const drawing of drawings) {
      const point = drawing.samples.find(sample => {
        const x = sample.x / 1000000 * zoom - (zoom - 1) / 2;
        const y = sample.y / 1000000 * zoom - (zoom - 1) / 2;
        return x >= 0 && x <= 1 && y >= 0 && y <= 1;
      });
      if (point) return [{note, point}];
    }
    return [];
  });
}

export function adjacentNote(comments: readonly Comment[], selected: string | null, time: number, _duration: number, direction: -1 | 1): Comment | undefined {
  const ordered = comments.filter(item => !item.parent_comment_id).sort(compareComments);
  const visited = new Set<string>();
  while (selected && !visited.has(selected)) {
    visited.add(selected);
    const parent = comments.find(item => item.comment_id === selected)?.parent_comment_id;
    if (!parent) break;
    selected = parent;
  }
  const index = ordered.findIndex(item => item.comment_id === selected);
  if (index !== -1) return ordered[index + direction];
  return direction === 1 ? ordered.find(item => item.anchor.at_us >= time) : ordered.reverse().find(item => item.anchor.at_us < time);
}

export type ReviewStop = {time: number; commentIds: string[]};

/** One pause per commented frame. Play skips the current stop; seeking rearms it. */
export function nextReviewStop(comments: readonly Comment[], from: number, duration: number, direction: -1 | 1 = 1, skipCurrent = false): ReviewStop | null {
  if (duration <= 0) return null;
  let result: ReviewStop | null = null;
  for (const comment of comments) {
    if (comment.parent_comment_id) continue;
    const time = comment.anchor.at_us;
    if (time < 0 || time > duration || (direction > 0 ? time < from : time > from) || (skipCurrent && sameFrame(time, from))) continue;
    if (!result || (direction > 0 ? time < result.time : time > result.time)) result = {time, commentIds: [comment.comment_id]};
    else if (time === result.time) result.commentIds.push(comment.comment_id);
  }
  return result;
}
