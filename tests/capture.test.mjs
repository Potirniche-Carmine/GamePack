import assert from 'node:assert/strict';
import test from 'node:test';
import {createCaptureRequests} from '../packages/app/src/capture.ts';

test('drawing begins at the native stopped frame, independently of periodic playback samples', () => {
  const captures = createCaptureRequests();
  const token = captures.begin({videoId: 'clip', seekToken: 4, mode: 'point'});
  assert.equal(captures.pending, true);
  const event = {captureToken: token, seekToken: 4, time_us: 2_083_333};
  assert.deepEqual(captures.take(event, 'clip', 4), {token, videoId: 'clip', seekToken: 4, mode: 'point', time: 2_083_333});
  assert.equal(captures.pending, false);
  assert.equal(captures.take(event, 'clip', 4), null);
});

test('rapid tool changes and capture mode changes only accept the latest request', () => {
  const captures = createCaptureRequests();
  const previous = captures.begin({videoId: 'clip', seekToken: 1, mode: 'point'});
  const latest = captures.begin({videoId: 'clip', seekToken: 1, mode: 'play'});
  assert.equal(captures.take({captureToken: previous, seekToken: 1, time_us: 100}, 'clip', 1), null);
  assert.equal(captures.pending, true);
  assert.equal(captures.take({captureToken: latest, seekToken: 1, time_us: 200}, 'clip', 1).mode, 'play');
});

test('navigation, seeking and cancelled tool selections cannot create a late draft', () => {
  const captures = createCaptureRequests();
  const token = captures.begin({videoId: 'clip', seekToken: 2, mode: 'point'});
  const event = {captureToken: token, seekToken: 2, time_us: 500};
  assert.equal(captures.take(event, 'another-clip', 2), null);
  assert.equal(captures.take(event, 'clip', 3), null);
  assert.equal(captures.take({...event, seekToken: 3}, 'clip', 2), null);
  for (const time_us of [NaN, Infinity, -1, 1.5]) assert.equal(captures.take({...event, time_us}, 'clip', 2), null);
  captures.cancel();
  assert.equal(captures.pending, false);
  assert.equal(captures.take(event, 'clip', 2), null);
  assert.ok(captures.begin({videoId: 'clip', seekToken: 2, mode: 'point'}) > token);
});
