import type {Comment, Draft} from './types';

export type Point = {x: number; y: number};
export type Size = {width: number; height: number};
export type Rect = Point & Size;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));

/** Match AVPlayer/MediaPlayer aspect-fit, so comments stay beside the footage on resize. */
export function contentRect(view: Size, media: Size, zoom = 1): Rect {
  if (media.width <= 0 || media.height <= 0) return {x: 0, y: 0, ...view};
  const scale = Math.min(view.width / media.width, view.height / media.height) * (Number.isFinite(zoom) ? Math.max(1, Math.min(4, zoom)) : 1);
  const width = media.width * scale, height = media.height * scale;
  return {x: (view.width - width) / 2, y: (view.height - height) / 2, width, height};
}
export function normalizedPoint(point: Point, rect: Rect): Point {
  return {x: rect.width > 0 ? clamp((point.x - rect.x) / rect.width, 0, 1) : 0,
    y: rect.height > 0 ? clamp((point.y - rect.y) / rect.height, 0, 1) : 0};
}
export function notePosition(note: Pick<Draft, 'drawings' | 'position'>, index = 0): Point {
  if (note.position) return note.position;
  let right = -Infinity, top = Infinity;
  for (const drawing of note.drawings) for (const point of drawing.samples) {
    right = Math.max(right, point.x / 1000000); top = Math.min(top, point.y / 1000000);
  }
  if (Number.isFinite(right)) return {x: clamp(right + .035, .06, .76), y: clamp(top, .04, .76)};
  // Older text-only comments get separate, predictable locations instead of a side rail.
  const columns = [.23, .58, .36];
  return {x: columns[index % columns.length], y: .18 + (Math.floor(index / 3) % 3) * .22 + (index % 3) * .1};
}
export function cardOrigin(position: Point, rect: Rect, view: Size, card: Size, topInset = 16): Point {
  return clampCard({x: rect.x + position.x * rect.width, y: rect.y + position.y * rect.height}, view, card, topInset, rect);
}
/** Leave room for transport even when widescreen footage adds a top letterbox. */
export function cardAvailableHeight(view: Size, rect: Rect, topInset = 16, bottomInset = 82): number {
  return Math.max(0, view.height - Math.max(topInset, rect.y) - bottomInset);
}
export function clampCard(point: Point, view: Size, card: Size, topInset = 16, rect?: Rect): Point {
  const axis = (value: number, minimum: number, maximum: number, start?: number, size?: number) => {
    if (start === undefined || size === undefined) return clamp(value, minimum, maximum);
    const end = start + Math.max(0, size), lower = Math.max(minimum, start), upper = Math.min(maximum, end);
    // If an unusually large card cannot fit, keep its anchor representable in
    // the footage. A card may extend into letterboxing; its anchor may not.
    if (upper < lower) return clamp(lower, start, end);
    return clamp(value, lower, upper);
  };
  return {x: axis(point.x, 76, view.width - card.width - 16, rect?.x, rect?.width),
    y: axis(point.y, topInset, view.height - card.height - 82, rect?.y, rect?.height)};
}

type PositionedNote = Pick<Comment, 'comment_id' | 'drawings' | 'position'>;

/** Give older cards room without changing a placement the reviewer chose. */
export function layoutNotePositions(notes: readonly PositionedNote[], rect: Rect, view: Size, topInset = 16): Map<string, Point> {
  const positions = new Map<string, Point>();
  const occupied: Point[] = [];
  const card = {width: Math.max(1, Math.min(240, view.width - 100)), height: 120};
  const gap = 12, stepX = card.width + gap, stepY = card.height + gap;
  const clampOrigin = (point: Point) => clampCard(point, view, card, topInset, rect);
  const overlap = (a: Point, b: Point) => Math.max(0, Math.min(a.x, b.x) + stepX - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y, b.y) + stepY - Math.max(a.y, b.y));

  // Reserve all explicit placements first, including ones later in the list.
  for (const note of notes) if (note.position) {
    positions.set(note.comment_id, note.position);
    occupied.push(cardOrigin(note.position, rect, view, card, topInset));
  }
  notes.forEach((note, index) => {
    if (note.position) return;
    const preferred = cardOrigin(notePosition(note, index), rect, view, card, topInset);
    let best = preferred;
    if (occupied.some(point => overlap(preferred, point) > 0)) {
      const candidates: Point[] = [preferred];
      for (const point of occupied) candidates.push(
        {x: preferred.x, y: point.y + stepY}, {x: point.x + stepX, y: preferred.y},
        {x: point.x - stepX, y: preferred.y}, {x: preferred.x, y: point.y - stepY});
      // Nearby edges handle most pairs; a screen-sized grid also finds space
      // when several older cards arrive together or edge clamping blocks them.
      const first = clampOrigin({x: 0, y: 0}), last = clampOrigin({x: view.width, y: view.height});
      const columns = Math.ceil(Math.max(0, last.x - first.x) / stepX);
      const rows = Math.ceil(Math.max(0, last.y - first.y) / stepY);
      for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
        candidates.push({x: Math.min(last.x, first.x + x * stepX), y: Math.min(last.y, first.y + y * stepY)});
      }
      let bestOverlap = Infinity, bestDistance = Infinity;
      const seen = new Set<string>();
      for (const candidate of candidates) {
        const point = clampOrigin(candidate), key = `${point.x},${point.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const area = occupied.reduce((total, other) => total + overlap(point, other), 0);
        const distance = (point.x - preferred.x) ** 2 + (point.y - preferred.y) ** 2;
        if (area < bestOverlap || (area === bestOverlap && distance < bestDistance)) {
          best = point; bestOverlap = area; bestDistance = distance;
        }
      }
    }
    positions.set(note.comment_id, normalizedPoint(best, rect));
    occupied.push(best);
  });
  return positions;
}
