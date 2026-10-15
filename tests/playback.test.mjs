import assert from 'node:assert/strict';
import test from 'node:test';
import {annotationScene, annotationSceneKey, sameFrame} from '../packages/app/src/playback.ts';
const record = (id, at_us = 1000000) => ({comment_id: id, anchor: {kind: 'point', at_us}, drawings: [
  {id: 'stroke', tool: 'pen', width: 3500, samples: [{x: 100000, y: 200000}, {x: 700000, y: 800000}]},
]});

test('playback never renders annotations; paused frames show completed geometry only at their time', () => {
  const comment = record('first');
  assert.equal(annotationScene([comment], 1000000, false), null);
  assert.equal(annotationScene([comment], 1100000, true), null);
  assert.equal(annotationScene([comment], 900000, true), null);
  assert.deepEqual(annotationScene([comment], 1000000, true).drawings[0].samples, comment.drawings[0].samples);
  assert.equal(annotationScene([comment], 1000000, true).anchor.at_us, 1000000);
});

test('seeking reconstructs every simultaneous drawing, preserving originals and stable layer order', () => {
  const first = record('a'), second = record('b'), otherFrame = record('c', 2000000);
  const records = [first, second, otherFrame], original = JSON.stringify(records);
  const scene = annotationScene(records, 1000000, true);
  assert.equal(scene.drawings.length, 2);
  assert.notEqual(scene.drawings[0].id, scene.drawings[1].id);
  assert.deepEqual(scene, annotationScene([...records].reverse(), 1000000, true));
  assert.equal(annotationScene(records, 2000000, true).drawings.length, 1);
  assert.deepEqual(scene, annotationScene(records, 1000000, true));
  assert.equal(JSON.stringify(records), original);
});

test('selection emphasizes the matching geometry without introducing stored colors', () => {
  const records = [record('a'), record('b')];
  const scene = annotationScene(records, 1000000, true, 'b');
  assert.deepEqual(scene.drawings.map(mark => mark.opacity), [.3, 1]);
  for (const mark of scene.drawings) {
    assert.equal('color' in mark, false);
    assert.equal('visible_until_us' in mark, false);
    assert.equal('t_us' in mark.samples[0], false);
  }
});

test('native clock settling is tolerated without a playback visibility window', () => {
  assert.equal(sameFrame(1000000, 1000177), true);
  assert.equal(sameFrame(1000000, 1016667), false);
  const eof = record('last', 10000000);
  assert.equal(annotationScene([eof], 10000000, true).drawings.length, 1);
  assert.equal(annotationScene([eof], 10000000, false), null);
});

test('review preloads the complete upcoming scene without an early drawing preview', () => {
  const records = [record('first'), record('second', 2000000)];
  const scene = annotationScene(records, 500000, false, null, 1000000);
  assert.equal(scene.anchor.at_us, 1000000);
  assert.equal(scene.preview_lead_us, undefined);
  assert.deepEqual(scene, annotationScene(records, 1000000, true));
  assert.equal(scene.drawings.length, 1);
  assert.equal(scene.drawings[0].id, 'first:stroke');
  assert.equal(scene.id, annotationScene(records, 1000000, true).id);
  assert.equal(annotationScene(records, 2000000, true).preview_lead_us, undefined);
  assert.equal(annotationScene(records, 500000, false), null);
  assert.equal(annotationScene(records, 500000, false, null, 3000000), null);
});

test('presentation readiness survives selection and draft edits but never a seek or frame step', () => {
  const records = [record('first'), record('second')];
  const initial = annotationSceneKey(JSON.stringify(annotationScene(records, 1000000, true)), 2, 0);
  const selected = annotationSceneKey(JSON.stringify(annotationScene(records, 1000000, true, 'second')), 2, 0);
  assert.equal(initial, selected);
  const draft = {id: 'draft', drawings: []};
  assert.equal(annotationSceneKey(JSON.stringify(draft), 2, 0), annotationSceneKey(JSON.stringify({...draft, drawings: records[0].drawings}), 2, 0));
  assert.notEqual(initial, annotationSceneKey(JSON.stringify(annotationScene(records, 1000000, true)), 3, 0));
  assert.notEqual(initial, annotationSceneKey(JSON.stringify(annotationScene(records, 1000000, true)), 2, 1));
  assert.equal(annotationSceneKey('', 2, 0), '');
});
