import type {CaptureReady} from './types';

type CaptureRequest = {videoId: string; seekToken: number; mode: 'point' | 'play'; token: number};

/** Only the latest intent may create a draft, at the native stopped frame. */
export function createCaptureRequests() {
  let sequence = 0;
  let pending: CaptureRequest | null = null;
  return {
    begin(request: Omit<CaptureRequest, 'token'>) {
      pending = {...request, token: ++sequence};
      return pending.token;
    },
    cancel() { pending = null; },
    get pending() { return pending !== null; },
    take(event: CaptureReady, videoId: string | null, seekToken: number) {
      if (!pending || event.captureToken !== pending.token || videoId !== pending.videoId
        || event.seekToken !== pending.seekToken || seekToken !== pending.seekToken
        || !Number.isSafeInteger(event.time_us) || event.time_us < 0) return null;
      const request = pending;
      pending = null;
      return {...request, time: event.time_us};
    },
  };
}
