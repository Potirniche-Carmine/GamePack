import type {Anchor, Comment, Drawing} from './types';

export const MOMENT_PLAYBACK_US = 2_000_000;

const darkPalette = ['#B3A0F7', '#81C7F5', '#80D0C2', '#EBA7CC', '#E8BB82'];
const lightPalette = ['#6953BD', '#1F78BC', '#187E79', '#B14C80', '#AA6625'];

export function commentColorMap(comments: readonly Comment[], dark: boolean): Map<string, string> {
  const palette = dark ? darkPalette : lightPalette;
  const ordered = [...comments].sort((a, b) => (a.created_at_reported ?? 0) - (b.created_at_reported ?? 0) || a.comment_id.localeCompare(b.comment_id));
  return new Map(ordered.map((comment, index) => [comment.comment_id, palette[index % palette.length]]));
}

export function playbackWindow(anchor: Anchor, durationUs: number): {start: number; end: number} {
  if (anchor.kind === 'interval') return {start: anchor.start_us, end: Math.min(durationUs, anchor.end_us)};
  return {start: anchor.at_us, end: Math.max(anchor.at_us + 1, Math.min(durationUs, anchor.at_us + MOMENT_PLAYBACK_US))};
}

export function activeCommentIds(comments: readonly Comment[], timeUs: number, durationUs: number): Set<string> {
  const active = new Set<string>();
  for (const comment of comments) {
    const {start, end} = playbackWindow(comment.anchor, durationUs);
    if (timeUs >= start && timeUs < end) active.add(comment.comment_id);
  }
  return active;
}

/** Rendering copies use a common video-time origin; saved records remain untouched. */
export function annotationScene(comments: readonly Comment[], durationUs: number, dark: boolean): {
  id: string; anchor: Anchor; drawings: Drawing[];
} {
  const drawings: Drawing[] = [];
  const colors = commentColorMap(comments, dark);
  const ordered = [...comments].sort((a, b) => {
    const startA = a.anchor.kind === 'point' ? a.anchor.at_us : a.anchor.start_us;
    const startB = b.anchor.kind === 'point' ? b.anchor.at_us : b.anchor.start_us;
    return startA - startB || a.comment_id.localeCompare(b.comment_id);
  });
  for (const comment of ordered) {
    const {start, end} = playbackWindow(comment.anchor, durationUs);
    if (end <= start) continue;
    const color = colors.get(comment.comment_id)!;
    for (const drawing of comment.drawings) {
      const point = comment.anchor.kind === 'point';
      const visibleFrom = point ? start : start + drawing.visible_from_us;
      const visibleUntil = point ? end : Math.min(end, start + drawing.visible_until_us);
      if (visibleUntil <= visibleFrom) continue;
      const samples = drawing.samples.map(sample => ({...sample, t_us: point ? start : start + sample.t_us}));
      drawings.push({...drawing, id: `${comment.comment_id}:${drawing.id}`, color,
        visible_from_us: visibleFrom, visible_until_us: visibleUntil, samples});
    }
  }
  return {id: 'all-comments', anchor: {kind: 'interval', start_us: 0, end_us: Math.max(1, durationUs + 1)}, drawings};
}

export function coloredReview(comment: Comment, dark: boolean, colors?: ReadonlyMap<string, string>): {id: string; anchor: Anchor; drawings: Drawing[]} {
  const color = colors?.get(comment.comment_id) ?? commentColorMap([comment], dark).get(comment.comment_id)!;
  return {id: comment.comment_id, anchor: comment.anchor, drawings: comment.drawings.map(drawing => ({...drawing, color}))};
}
