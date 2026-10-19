import type {Anchor, Comment} from './types';
import {conversationRoot} from './discussion';

export const PLAYBACK_SPEEDS = [.25, .5, .75, 1, 2, 4] as const;

export const compareComments = (a: Comment, b: Comment) => a.anchor.at_us - b.anchor.at_us
  || (a.created_at_reported || 0) - (b.created_at_reported || 0) || a.comment_id.localeCompare(b.comment_id);

// A single annotation ink across tools, comments and themes.
export const ANNOTATION_COLOR = '#79BFFD';
// Native seek clocks may settle within 2 ms of the requested source frame.
export const FRAME_TOLERANCE_US = 2_000;
export const sameFrame = (a: number, b: number) => Math.abs(a - b) <= FRAME_TOLERANCE_US;

export const anchorContains = (anchor: Anchor, time: number) => anchor.kind === 'play'
  ? time >= anchor.at_us - FRAME_TOLERANCE_US && time <= anchor.end_us + FRAME_TOLERANCE_US
  : sameFrame(anchor.at_us, time);

/** Preload timed ink for the native media clock, plus the upcoming point stop.
 * Native filters each drawing's window and samples without JS-frame latency. */
export function annotationScene(comments: readonly Comment[], timeUs: number, paused: boolean, selectedId?: string | null, nextStopUs?: number) {
  const active = comments.filter(comment => comment.anchor.kind === 'play'
    || ((paused || nextStopUs !== undefined) && sameFrame(comment.anchor.at_us, paused ? timeUs : nextStopUs!))).sort(compareComments);
  if (!active.length) return null;
  const anchors = active.map(comment => comment.anchor);
  return {id: `scene:${active.map(comment => comment.comment_id).join(':')}`, anchor: active[0].anchor, anchors,
    drawings: active.flatMap(comment => comment.drawings.map(drawing => ({...drawing, anchor: comment.anchor,
      id: `${comment.comment_id}:${drawing.id}`, opacity: !selectedId || (conversationRoot(comments, comment.comment_id)?.comment_id ?? comment.comment_id) === selectedId ? 1 : .3,
    })))};
}

/** Geometry edits and selection keep the same presentation; seeks and steps must settle again. */
export function annotationSceneKey(sceneJson: string, seekToken: number, stepToken: number): string {
  if (!sceneJson) return '';
  return `${JSON.parse(sceneJson).id}:${seekToken}:${stepToken}`;
}
