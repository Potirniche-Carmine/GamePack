import assert from 'node:assert/strict';
import test from 'node:test';
import {receiveZoom, requestZoom} from '../packages/app/src/zoom.ts';

test('gesture reports never become new native zoom commands', () => {
  let state = {value: 1, token: 0};
  for (const zoom of [1.1, 1.15, 1.3, 1.25, 1.17]) {
    state = receiveZoom(state, {zoom, zoomToken: 0});
    assert.deepEqual(state, {value: zoom, token: 0});
  }
  assert.deepEqual(requestZoom(state, value => value + .25), {value: 1.42, token: 1});
});

test('a reset interrupts a gesture and rejects its queued reports, including a repeated reset', () => {
  const reset = requestZoom({value: 2, token: 3}, 1);
  assert.deepEqual(reset, {value: 1, token: 4});
  assert.equal(receiveZoom(reset, {zoom: 2.1, zoomToken: 3}), reset);
  const gesture = receiveZoom(reset, {zoom: 1.8, zoomToken: 4});
  assert.deepEqual(requestZoom(gesture, 1), {value: 1, token: 5});
  assert.equal(receiveZoom(reset, {zoom: NaN, zoomToken: 4}), reset);
});
