import type {Draft} from './types';

/** The most recently created unfinished comment. Empty tool selections are not work. */
export function resumableDraft(drafts: readonly Draft[], videoId: string, parentId?: string | null): Draft | undefined {
  for (let index = drafts.length - 1; index >= 0; index--) {
    const draft = drafts[index];
    if (draft.video_id === videoId && (parentId === undefined || (draft.parent_comment_id ?? null) === parentId)
      && (draft.text.trim() || draft.drawings.length)) return draft;
  }
  return undefined;
}
