import {compareComments} from './playback';
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
const start = (comment: Comment) => comment.anchor.at_us;
const safeWidth = (width: number) => Number.isFinite(width) ? Math.max(0, width) : 0;

/** Short clips get a compact dock; long videos gain room without filling the window. */
export function timelineDockWidth(available: number, duration: number, reviewing: boolean): number {
  const minutes = Number.isFinite(duration) ? Math.max(.5, duration / 60000000) : .5;
  const width = (reviewing ? 560 : 520) + Math.max(0, Math.log2(minutes * 2)) * 40;
  return Math.max(1, Math.min(available - 48, reviewing ? 760 : 640, width));
}

export type TimelineSample = {time: number; duration: number; paused: boolean; rate: number; seekToken: number};
export function timelineMotion(previous: TimelineSample | null, current: TimelineSample) {
  const {time, duration, paused, rate, seekToken} = current;
  const discontinuity = !previous || previous.seekToken !== seekToken || previous.duration !== duration
    || Math.abs(time - previous.time) > 500000 * Math.max(1, Math.abs(rate));
  if (discontinuity) return {kind: 'snap' as const, time};
  // The pause request still carries the previous periodic sample. Freeze the
  // presentation until native reports the stopped frame, instead of rewinding.
  if (paused && time === previous.time) return {kind: 'hold' as const, time};
  return {kind: 'animate' as const, time: paused ? time : time + rate * 140000, duration: paused ? 100 : 140};
}

/** Pointer positions use the same inset as markers and the playback thumb. */
export function timelineSeekTime(x: number, duration: number, width: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(duration) || duration <= 0) return 0;
  const available = safeWidth(width), inset = Math.min(12, available / 2);
  return Math.round(Math.max(0, Math.min(1, (x - inset) / Math.max(1, available - 2 * inset))) * duration);
}

export function timelinePosition(time: number, duration: number, width: number): number {
  const available = safeWidth(width), inset = Math.min(12, available / 2);
  const progress = duration > 0 && Number.isFinite(duration) && Number.isFinite(time) ? Math.max(0, Math.min(1, time / duration)) : 0;
  return inset + progress * (available - inset * 2);
}

/** Merge overlapping marker bounds, including the extra width of a cluster
 * label and clamping at either edge. Groups keep chronological numbering and
 * an exact first-comment anchor; no comment is displaced or dropped. */
export function clusterTimelineComments(comments: readonly Comment[], duration: number, width: number): TimelineCluster[] {
  const ordered = [...comments].sort(compareComments);
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
