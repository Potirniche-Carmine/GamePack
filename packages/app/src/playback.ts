import type {Comment} from './types';
import {conversationRoot} from './discussion';

export const compareComments = (a: Comment, b: Comment) => a.anchor.at_us - b.anchor.at_us
  || (a.created_at_reported || 0) - (b.created_at_reported || 0) || a.comment_id.localeCompare(b.comment_id);

// A single annotation ink across tools, comments and themes.
export const ANNOTATION_COLOR = '#79BFFD';
// Native seek clocks may settle within 2 ms of the requested source frame.
export const FRAME_TOLERANCE_US = 2_000;
export const sameFrame = (a: number, b: number) => Math.abs(a - b) <= FRAME_TOLERANCE_US;

/** Preload the next stop so native playback can reveal its ink 80 ms before pausing. */
export function annotationScene(comments: readonly Comment[], timeUs: number, paused: boolean, selectedId?: string | null, nextStopUs?: number) {
  if (!paused && nextStopUs === undefined) return null;
  const active = comments.filter(comment => sameFrame(comment.anchor.at_us, paused ? timeUs : nextStopUs!)).sort(compareComments);
  if (!active.length) return null;
  return {id: `frame:${active[0].anchor.at_us}`, anchor: active[0].anchor, ...(!paused ? {preview_lead_us: 80_000} : {}),
    drawings: active.flatMap(comment => comment.drawings.map(drawing => ({...drawing,
      id: `${comment.comment_id}:${drawing.id}`, opacity: !selectedId || (conversationRoot(comments, comment.comment_id)?.comment_id ?? comment.comment_id) === selectedId ? 1 : .3,
    })))};
}
