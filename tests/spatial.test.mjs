import test from 'node:test';
import assert from 'node:assert/strict';
import {contentRect, normalizedPoint, reviewViewport, conversationPlacement, drawingEndPosition} from '../packages/app/src/spatial.ts';

test('card mapping follows letterboxed footage and native centered zoom', () => {
  const view = {width: 1000, height: 700}, media = {width: 1920, height: 1080};
  const rect = contentRect(view, media);
  assert.ok(Math.abs(rect.x) < 1e-9); assert.ok(Math.abs(rect.y - 68.75) < 1e-9);
  assert.deepEqual(normalizedPoint({x: 500, y: 350}, rect), {x: .5, y: .5});
  const zoomed = contentRect(view, media, 2);
  assert.ok(Math.abs(zoomed.x + 500) < 1e-9); assert.ok(Math.abs(zoomed.width - 2000) < 1e-9);
  assert.deepEqual(normalizedPoint({x: 500, y: 350}, zoomed), {x: .5, y: .5});
  assert.deepEqual(contentRect(view, media, NaN), rect);
  assert.deepEqual(contentRect(view, media, 20), contentRect(view, media, 4));
});


test('the picture stays horizontally centered with floating comments across aspect ratios', () => {
  for (const view of [{width: 1080, height: 700}, {width: 1920, height: 1080}]) {
    for (const media of [{width: 1920, height: 1080}, {width: 1080, height: 1920}, {width: 2400, height: 1000}]) {
      for (const review of [false, true]) for (const fullscreen of [false, true]) {
        const rect = reviewViewport(view, media, review, fullscreen);
        assert.ok(rect.x >= 16);
        assert.ok(Math.abs(rect.x + rect.width / 2 - view.width / 2) < .001);
        assert.ok(rect.y >= (fullscreen ? 16 : 76));
        assert.ok(rect.x + rect.width <= view.width - 16 + .001);
        assert.ok(rect.y + rect.height <= view.height - (review ? 190 : 118) + .001);
        assert.ok(Math.abs(rect.width / rect.height - media.width / media.height) < .001);
        if (review) for (const y of [0, 500000, 1000000]) {
          const card = conversationPlacement(view, fullscreen);
          assert.ok(card.left + card.width <= view.width - 16);
          assert.ok(card.top >= (fullscreen ? 16 : 76));
          assert.ok(card.top + card.maxHeight <= view.height - 204);
        }
      }
    }
  }
});

test('comments remain at the right edge in windowed and fullscreen layouts', () => {
  for (const view of [{width: 1080, height: 700}, {width: 1920, height: 1080}]) {
    for (const fullscreen of [false, true]) {
      const placement = conversationPlacement(view, fullscreen);
      assert.equal(placement.left + placement.width, view.width - 16);
      assert.equal(placement.top, fullscreen ? 16 : 76);
      assert.equal(placement.top + placement.maxHeight, view.height - 204);
    }
  }
});

test('persisted comment positions use normalized coordinates at the stroke endpoint', () => {
  assert.deepEqual(drawingEndPosition([{x: 1000, y: 2000}, {x: 900000, y: 750000}]), {x: .9, y: .75});
  assert.deepEqual(drawingEndPosition([{x: 1000000, y: 0}]), {x: 1, y: 0});
  assert.equal(drawingEndPosition([]), undefined);
});
