import type {Draft} from './types';

/** New conversations start with a drawing; replies may be text-only. */
export function canPostDraft(draft: Pick<Draft, 'parent_comment_id' | 'text' | 'drawings'>): boolean {
  return draft.drawings.length > 0 || (!!draft.parent_comment_id && !!draft.text.trim());
}

/** The most recently created unfinished comment. Empty tool selections are not work. */
export function resumableDraft(drafts: readonly Draft[], videoId: string, parentId?: string | null): Draft | undefined {
  for (let index = drafts.length - 1; index >= 0; index--) {
    const draft = drafts[index];
    if (draft.video_id === videoId && (parentId === undefined || (draft.parent_comment_id ?? null) === parentId)
      && (draft.text.trim() || draft.drawings.length)) return draft;
  }
  return undefined;
}

/** A root play grows only forward; replies keep their immutable parent window.
 * Include native stroke times even if the latest periodic clock event is late. */
export function extendPlayDraft(draft: Draft, time: number, drawings = draft.drawings): Draft {
  if (draft.anchor.kind !== 'play' || draft.parent_comment_id) return {...draft, drawings};
  const end = drawings.reduce((latest, drawing) => drawing.samples.reduce((end, sample) => Math.max(end, sample.t_us ?? 0), latest),
    Math.max(draft.anchor.end_us, Number.isSafeInteger(time) ? time : 0));
  return {...draft, drawings, anchor: {...draft.anchor, at_us: Number.isSafeInteger(time) && time >= 0 ? Math.min(draft.anchor.at_us, time) : draft.anchor.at_us, end_us: end}};
}

export function playDraftSeek(draft: Draft, time: number, duration: number): number {
  if (draft.anchor.kind !== 'play') return draft.anchor.at_us;
  return Math.round(Math.max(draft.parent_comment_id ? draft.anchor.at_us : 0, Math.min(draft.parent_comment_id ? draft.anchor.end_us : duration, time)));
}

/** An empty play follows the chosen start; existing strokes keep their source times. */
export function seekPlayDraft(draft: Draft, time: number, duration: number): Draft {
  if (draft.anchor.kind !== 'play' || draft.parent_comment_id) return draft;
  const target = playDraftSeek(draft, time, duration);
  return {...draft, anchor: draft.drawings.length
    ? {...draft.anchor, at_us: Math.min(draft.anchor.at_us, target), end_us: Math.max(draft.anchor.end_us, target)}
    : {kind: 'play', at_us: target, end_us: target}};
}
