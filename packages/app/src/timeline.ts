import {compareComments, sameFrame} from './playback';
import type {Comment} from './types';

export type TimelineCluster = {
  comments: Comment[];
  left: number;
  width: number;
  anchor: number;
  endAnchor: number;
};

const minimumGap = 6;
const start = (comment: Comment) => comment.anchor.at_us;
const safeWidth = (width: number) => Number.isFinite(width) ? Math.max(0, width) : 0;

/** A proximity group is not a count of conversations on one frame. Keep every
 * source anchor visible, and point the group leader at the selected moment. */
export function timelineClusterPresentation(cluster: TimelineCluster, duration: number, width: number, selectedId: string | null) {
  const selected = cluster.comments.find(comment => comment.comment_id === selectedId);
  const simultaneous = cluster.comments.every(comment => sameFrame(start(comment), start(cluster.comments[0])));
  const positions = [...new Set(cluster.comments.map(comment => timelinePosition(start(comment), duration, width)))];
  return {positions, anchor: selected ? timelinePosition(start(selected), duration, width) : cluster.anchor,
    count: simultaneous && cluster.comments.length > 1 ? cluster.comments.length : null};
}

export function timelineDockBounds(available: number) {
  const max = Math.max(1, safeWidth(available) - 48);
  return {min: Math.min(560, max), max};
}

/** A manual width survives mode and window changes, bounded by the current workspace. */
export function timelineDockWidth(available: number, duration: number, reviewing: boolean, preferred?: number | null): number {
  const minutes = Number.isFinite(duration) ? Math.max(.5, duration / 60000000) : .5;
  const automatic = Math.min(reviewing ? 840 : 720, (reviewing ? 640 : 600) + Math.max(0, Math.log2(minutes * 2)) * 40);
  const width = preferred != null && Number.isFinite(preferred) ? preferred : automatic;
  const {min, max} = timelineDockBounds(available);
  return Math.max(min, Math.min(max, width));
}

/** The grabbed edge tracks the pointer 1:1; the opposite edge mirrors it. */
export function resizeTimelineDock(width: number, deltaX: number, side: -1 | 1, available: number): number {
  return timelineDockWidth(available, 0, true, width + (Number.isFinite(deltaX) ? deltaX : 0) * side * 2);
}

export type TimelineSample = {time: number; duration: number; paused: boolean; rate: number; seekToken: number; reviewEnd?: number};

export const TIMELINE_RUN_MS = 30000;
export const TIMELINE_SAMPLE_TIMEOUT_MS = 250;
export type TimelineRun = {sample: TimelineSample; startedAt: number};

/** Native timing runs on the display clock. Ordinary media samples confirm that
 * run instead of restarting it (and losing an animation frame) at every tick. */
export function timelineCanContinue(run: TimelineRun | null, current: TimelineSample, now: number) {
  if (!run || current.paused || !current.rate) return false;
  const {sample, startedAt} = run;
  if (sample.seekToken !== current.seekToken || sample.duration !== current.duration || sample.rate !== current.rate
    || (sample.reviewEnd ?? -1) !== (current.reviewEnd ?? -1)) return false;
  const elapsed = now - startedAt;
  // Bound the native frame table even for hours-long videos. Renew before its
  // end, or sooner if the media clock has drifted more than one sample interval.
  if (elapsed < 0 || elapsed >= 20000) return false;
  const predicted = sample.time + elapsed * sample.rate * 1000;
  return Math.abs(predicted - current.time) <= Math.abs(current.rate) * 120000;
}

/** Never present a predicted frame beyond the stop already armed in the player. */
export function timelinePrediction({time, duration, rate, reviewEnd = -1}: TimelineSample, horizonMs = 140) {
  const limit = reviewEnd >= 0 ? reviewEnd : rate < 0 ? 0 : duration;
  const target = rate < 0 ? Math.max(limit, time + rate * horizonMs * 1000) : Math.min(limit, time + rate * horizonMs * 1000);
  return {time: target, duration: rate ? Math.min(horizonMs, Math.abs(target - time) / Math.abs(rate) / 1000) : 0};
}
export function timelineMotion(previous: TimelineSample | null, current: TimelineSample) {
  const {time, duration, paused, rate, seekToken, reviewEnd = -1} = current;
  const discontinuity = !previous || previous.seekToken !== seekToken || previous.duration !== duration
    || Math.abs(time - previous.time) > 500000 * Math.max(1, Math.abs(rate));
  if (discontinuity || (paused && reviewEnd >= 0 && Math.abs(time - reviewEnd) <= 2000)) return {kind: 'snap' as const, time};
  // The pause request still carries the previous periodic sample. Freeze the
  // presentation until native reports the stopped frame, instead of rewinding.
  if (paused && time === previous.time) return {kind: previous.paused ? 'snap' as const : 'hold' as const, time};
  // The acknowledged pause is final. Easing toward it makes the playhead keep
  // moving (or reel backward) after the video has already stopped.
  if (paused) return {kind: 'snap' as const, time};
  return {kind: 'animate' as const, ...timelinePrediction(current)};
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
 * label and clamping at either edge. Groups keep chronological order and
 * an exact first-comment anchor; no comment is displaced or dropped. */
export function clusterTimelineComments(comments: readonly Comment[], duration: number, width: number): TimelineCluster[] {
  const ordered = [...comments].sort(compareComments);
  const available = safeWidth(width);
  type Range = {first: number; last: number};
  const bounds = ({first, last}: Range) => {
    const count = last - first + 1;
    const labelWidth = count === 1 ? 28 : Math.max(32, String(count).length * 7 + 18);
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
  return groups.map(group => ({comments: ordered.slice(group.first, group.last + 1),
    ...bounds(group), endAnchor: timelinePosition(start(ordered[group.last]), duration, available)}));
}
