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

/** Overlay side panels leave the picture centered in the entire workspace. */
export function reviewViewport(view: Size, media: Size, reviewing: boolean, fullscreen: boolean): Rect {
  const left = 16, right = 16;
  const top = fullscreen ? 16 : 76, bottom = reviewing ? 190 : 118;
  const fitted = contentRect({width: Math.max(1, view.width - left - right), height: Math.max(1, view.height - top - bottom)}, media);
  return {...fitted, x: fitted.x + left, y: fitted.y + top};
}

/** A stable right-side rail, independent of drawing geometry, selection and zoom. */
export function conversationPlacement(view: Size, fullscreen: boolean) {
  const top = fullscreen ? 16 : 76;
  const width = Math.min(304, Math.max(1, view.width - 92));
  return {left: Math.max(76, view.width - width - 16), top, width, maxHeight: Math.max(0, view.height - top - 204)};
}

export function drawingEndPosition(samples: readonly Point[]): Point | undefined {
  const point = samples[samples.length - 1];
  return point ? {x: point.x / 1000000, y: point.y / 1000000} : undefined;
}
