import type {Comment} from './types';

export type TimelineCluster = {
  comments: Comment[];
  firstNumber: number;
  left: number;
  width: number;
  anchor: number;
  endAnchor: number;
};

const minimumGap = 6;
const start = (comment: Comment) => comment.anchor.kind === 'point' ? comment.anchor.at_us : comment.anchor.start_us;
const safeWidth = (width: number) => Number.isFinite(width) ? Math.max(0, width) : 0;

export function timelinePosition(time: number, duration: number, width: number): number {
  const available = safeWidth(width), inset = Math.min(12, available / 2);
  const progress = duration > 0 && Number.isFinite(duration) && Number.isFinite(time) ? Math.max(0, Math.min(1, time / duration)) : 0;
  return inset + progress * (available - inset * 2);
}

/** Merge overlapping marker bounds, including the extra width of a cluster
 * label and clamping at either edge. Groups keep chronological numbering and
 * an exact first-comment anchor; no comment is displaced or dropped. */
export function clusterTimelineComments(comments: readonly Comment[], duration: number, width: number): TimelineCluster[] {
  const ordered = [...comments].sort((a, b) => start(a) - start(b) || a.comment_id.localeCompare(b.comment_id));
  const available = safeWidth(width);
  type Range = {first: number; last: number};
  const bounds = ({first, last}: Range) => {
    const count = last - first + 1;
    const numberWidth = String(first + 1).length * 6;
    const labelWidth = count === 1 ? Math.max(24, numberWidth + 12) : Math.max(44, numberWidth + String(count - 1).length * 6 + 27);
    const markerWidth = Math.min(available, labelWidth);
    const anchor = timelinePosition(start(ordered[first]), duration, available);
    return {width: markerWidth, anchor, left: Math.max(0, Math.min(available - markerWidth, anchor - markerWidth / 2))};
  };
  const groups: Range[] = [];
  for (let index = 0; index < ordered.length; index++) {
    let next = {first: index, last: index};
    while (groups.length) {
      const previous = groups[groups.length - 1];
      const before = bounds(previous), after = bounds(next);
      if (after.left - before.left - before.width >= minimumGap) break;
      groups.pop();
      next = {first: previous.first, last: next.last};
    }
    groups.push(next);
  }
  return groups.map(group => ({comments: ordered.slice(group.first, group.last + 1), firstNumber: group.first + 1,
    ...bounds(group), endAnchor: timelinePosition(start(ordered[group.last]), duration, available)}));
}
