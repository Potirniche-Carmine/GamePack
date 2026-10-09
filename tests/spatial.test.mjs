import test from 'node:test';
import assert from 'node:assert/strict';
import {contentRect, normalizedPoint, notePosition, cardOrigin, cardAvailableHeight, clampCard, layoutNotePositions} from '../packages/app/src/spatial.ts';

test('expanded conversations fit above transport in letterboxed and fullscreen views', () => {
  for (const view of [{width: 1200, height: 700}, {width: 1200, height: 360}]) {
    for (const zoom of [1, 2, 4]) for (const topInset of [16, 76]) {
      const rect = contentRect(view, {width: 2400, height: 1000}, zoom);
      const height = cardAvailableHeight(view, rect, topInset);
      const origin = cardOrigin({x: .5, y: .9}, rect, view, {width: 350, height}, topInset);
      assert.ok(origin.y >= topInset);
      assert.ok(origin.y + height <= view.height - 82);
    }
  }
  assert.equal(cardAvailableHeight({width: 100, height: 60}, {x: 0, y: 0, width: 100, height: 60}), 0);
});

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

test('dragging into letterbox space clamps to an anchor that survives release', () => {
  const view = {width: 1000, height: 700}, card = {width: 320, height: 210};
  for (const [media, attempted] of [
    [{width: 600, height: 2000}, {x: 80, y: 250}],
    [{width: 4000, height: 600}, {x: 400, y: 16}],
  ]) {
    const rect = contentRect(view, media);
    const origin = clampCard(attempted, view, card, 16, rect);
    assert.ok(origin.x >= rect.x && origin.x <= rect.x + rect.width);
    assert.ok(origin.y >= rect.y && origin.y <= rect.y + rect.height);
    const restored = cardOrigin(normalizedPoint(origin, rect), rect, view, card);
    assert.ok(Math.abs(restored.x - origin.x) < 1e-9);
    assert.ok(Math.abs(restored.y - origin.y) < 1e-9);
  }
  const portrait = contentRect(view, {width: 600, height: 2000});
  const origin = clampCard({x: 400, y: 200}, view, card, 16, portrait);
  assert.ok(origin.x + card.width > portrait.x + portrait.width, 'Card may extend into the right letterbox');
  assert.ok(origin.x + card.width <= view.width - 16, 'Card still fits inside the viewport');
});

test('resized and zoomed cards retain source coordinates and drag bounds', () => {
  const card = {width: 240, height: 120}, media = {width: 1920, height: 1080};
  const point = {x: .4, y: .4};
  for (const view of [{width: 1000, height: 700}, {width: 1400, height: 900}]) {
    for (const zoom of [1, 2, 4]) {
      const rect = contentRect(view, media, zoom);
      const origin = cardOrigin(point, rect, view, card, 50);
      const stored = normalizedPoint(origin, rect);
      assert.ok(Math.abs(stored.x - point.x) < 1e-9);
      assert.ok(Math.abs(stored.y - point.y) < 1e-9);
      const edge = clampCard({x: -1000, y: 10000}, view, card, 50, rect);
      assert.ok(edge.x >= 76 && edge.y >= 50);
      assert.ok(edge.x + card.width <= view.width - 16);
      assert.ok(edge.y + card.height <= view.height - 82);
      const restored = cardOrigin(normalizedPoint(edge, rect), rect, view, card, 50);
      assert.ok(Math.abs(restored.x - edge.x) < 1e-9);
      assert.ok(Math.abs(restored.y - edge.y) < 1e-9);
    }
  }
});

const compact = {width: 240, height: 120};
const note = (comment_id, position, drawings = []) => ({comment_id, position, drawings});
const separate = (first, second) => first.x + compact.width + 12 <= second.x + 1e-9
  || second.x + compact.width + 12 <= first.x + 1e-9
  || first.y + compact.height + 12 <= second.y + 1e-9
  || second.y + compact.height + 12 <= first.y + 1e-9;

test('legacy text and drawing cards receive nearby nonoverlapping placements', () => {
  const view = {width: 1280, height: 800}, rect = contentRect(view, view);
  const drawings = [{samples: [{x: 200000, y: 180000}, {x: 200000, y: 280000}]}];
  const notes = [note('text'), note('drawing', undefined, drawings), note('another-drawing', null, drawings)];
  const positions = layoutNotePositions(notes, rect, view);
  assert.deepEqual(positions, layoutNotePositions(notes, rect, view));
  const origins = notes.map(item => cardOrigin(positions.get(item.comment_id), rect, view, compact));
  const preferred = notePosition(notes[0], 0);
  assert.ok(Math.abs(positions.get('text').x - preferred.x) < 1e-9);
  assert.ok(Math.abs(positions.get('text').y - preferred.y) < 1e-9);
  for (let i = 0; i < origins.length; i++) for (let j = i + 1; j < origins.length; j++) {
    assert.ok(separate(origins[i], origins[j]), `Cards ${i} and ${j} should be separate`);
  }
  assert.ok(Math.abs(origins[1].y - origins[0].y) <= compact.height + 12 + 1e-9, 'Drawing card stays nearby');
});

test('explicit placements are reserved before legacy cards and never rearranged', () => {
  const view = {width: 1280, height: 800}, rect = contentRect(view, view);
  const saved = {x: .23, y: .18};
  const notes = [note('legacy'), note('saved', saved), note('also-saved', saved)];
  const positions = layoutNotePositions(notes, rect, view);
  assert.deepEqual(positions.get('saved'), saved);
  assert.deepEqual(positions.get('also-saved'), saved);
  const oldOrigin = cardOrigin(positions.get('legacy'), rect, view, compact);
  const savedOrigin = cardOrigin(saved, rect, view, compact);
  assert.ok(separate(oldOrigin, savedOrigin));
});

test('crowded portrait placement stays deterministic and representable', () => {
  const view = {width: 900, height: 800}, rect = contentRect(view, {width: 600, height: 2000});
  const drawings = [{samples: [{x: 200000, y: 180000}]}];
  const notes = Array.from({length: 8}, (_, index) => note(`note-${index}`, undefined, drawings));
  const positions = layoutNotePositions(notes, rect, view, 60);
  assert.deepEqual(positions, layoutNotePositions(notes, rect, view, 60));
  for (const position of positions.values()) {
    assert.ok(position.x >= 0 && position.x <= 1 && position.y >= 0 && position.y <= 1);
    const origin = cardOrigin(position, rect, view, compact, 60);
    assert.ok(origin.x >= rect.x && origin.x <= rect.x + rect.width);
    assert.ok(origin.y >= 60 && origin.y + compact.height <= view.height - 82);
  }
});
test('repositioning survives resize and clamped cards remain clear of video controls', () => {
  const view = {width: 1000, height: 700}, rect = contentRect(view, view), card = {width: 320, height: 210};
  assert.deepEqual(cardOrigin({x: .3, y: .3}, rect, view, card), {x: 300, y: 210});
  assert.deepEqual(clampCard({x: 2000, y: 1000}, view, card), {x: 664, y: 408});
  assert.deepEqual(normalizedPoint({x: -20, y: 900}, rect), {x: 0, y: 1});
  assert.deepEqual(cardOrigin({x: .3, y: .3}, {x: 0, y: 0, width: 1600, height: 900}, {width: 1600, height: 900}, card), {x: 480, y: 270});
});
test('new cards sit beside drawings while persisted placement wins and legacy notes spread out', () => {
  const drawings = [{samples: [{x: 200000, y: 300000}, {x: 400000, y: 500000}]}];
  assert.deepEqual(notePosition({drawings}), {x: .43500000000000005, y: .3});
  assert.deepEqual(notePosition({drawings, position: {x: .8, y: .6}}), {x: .8, y: .6});
  assert.notDeepEqual(notePosition({drawings: []}, 0), notePosition({drawings: []}, 1));
  assert.doesNotThrow(() => notePosition({drawings: [{samples: Array.from({length: 200000}, () => ({x: 900000, y: 800000}))}]}));
});
