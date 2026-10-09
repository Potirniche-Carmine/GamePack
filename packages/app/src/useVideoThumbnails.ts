import {useEffect, useState} from 'react';
import {videoThumbnails} from './native';
import type {Video} from './types';

type Source = Pick<Video, 'path' | 'media_id'>;
const requests = new Map<string, Promise<string[]>>();
const empty: string[] = [];

/** The immutable media identity allows duplicate project entries to share one filmstrip. */
export function useVideoThumbnails(video?: Source | null): string[] {
  const key = video?.media_id ?? '';
  const path = video?.path ?? '';
  const [result, setResult] = useState<{key: string; frames: string[]}>({key: '', frames: empty});
  useEffect(() => {
    if (!key || !path) return;
    let current = true;
    let request = requests.get(key);
    if (!request) {
      request = videoThumbnails(path, key);
      requests.set(key, request);
      void request.then(frames => { if (!frames.length && requests.get(key) === request) requests.delete(key); });
      // Bound the in-memory index; generated files stay in the native disk cache.
      if (requests.size > 48) requests.delete(requests.keys().next().value!);
    }
    void request.then(frames => { if (current) setResult({key, frames}); });
    return () => { current = false; };
  }, [key, path]);
  // A new video never displays the previous video's frames while its decoder runs.
  return result.key === key ? result.frames : empty;
}
