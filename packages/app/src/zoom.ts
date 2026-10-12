export type ZoomState = {value: number; token: number};

/** Only an explicit control command advances the native request token. */
export function requestZoom(previous: ZoomState, value: number | ((previous: number) => number)): ZoomState {
  const requested = typeof value === 'function' ? value(previous.value) : value;
  return {value: Number.isFinite(requested) ? Math.max(1, Math.min(4, requested)) : 1, token: previous.token + 1};
}

/** Native gesture reports update labels without feeding old scales back into the gesture. */
export function receiveZoom(previous: ZoomState, event: {zoom: number; zoomToken: number}): ZoomState {
  if (event.zoomToken !== previous.token || !Number.isFinite(event.zoom)) return previous;
  return {...previous, value: Math.max(1, Math.min(4, event.zoom))};
}
