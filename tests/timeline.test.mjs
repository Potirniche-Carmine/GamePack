import assert from 'node:assert/strict';
import test from 'node:test';
import {clusterTimelineComments, timelinePosition} from '../packages/app/src/timeline.ts';

const note = (id, time) => ({comment_id: id, anchor: {kind: 'point', at_us: time}});
const ids = clusters => clusters.map(cluster => cluster.comments.map(comment => comment.comment_id));
const checkBounds = (clusters, width) => {
  for (let index = 0; index < clusters.length; index++) {
    const cluster = clusters[index];
    assert.ok(cluster.left >= 0);
    assert.ok(cluster.left + cluster.width <= width + 0.00001);
    if (index) assert.ok(cluster.left >= clusters[index - 1].left + clusters[index - 1].width + 6);
  }
};

test('equal-time comments remain individually represented in a deterministic cluster', () => {
  const comments = [note('b', 50), note('later', 90), note('a', 50)];
  const snapshot = JSON.stringify(comments);
  const clusters = clusterTimelineComments(comments, 100, 500);
  assert.deepEqual(ids(clusters), [['a', 'b'], ['later']]);
  assert.deepEqual(clusters.map(cluster => cluster.firstNumber), [1, 3]);
  assert.equal(clusters[0].anchor, timelinePosition(50, 100, 500));
  assert.equal(JSON.stringify(comments), snapshot);
  assert.deepEqual(clusterTimelineComments([...comments].reverse(), 100, 500), clusters);
  checkBounds(clusters, 500);
});

test('clustering follows rendered pixel proximity and responds to resizing', () => {
  const comments = [note('a', 40), note('b', 47), note('c', 90)];
  assert.deepEqual(ids(clusterTimelineComments(comments, 100, 1000)), [['a'], ['b'], ['c']]);
  assert.deepEqual(ids(clusterTimelineComments(comments, 100, 300)), [['a', 'b'], ['c']]);
});

test('expanded labels merge neighbors and remain within both timeline edges', () => {
  const comments = [note('start-a', 0), note('start-b', 0), note('near-start', 10),
    note('middle', 50), note('near-end', 90), note('end-a', 100), note('end-b', 100)];
  const clusters = clusterTimelineComments(comments, 100, 320);
  assert.deepEqual(ids(clusters), [['start-a', 'start-b', 'near-start'], ['middle'], ['near-end', 'end-a', 'end-b']]);
  assert.equal(clusters[0].anchor, 12);
  assert.equal(clusters.at(-1).endAnchor, 308);
  checkBounds(clusters, 320);
});

test('dense timelines preserve every member once, including intervals and out-of-range anchors', () => {
  const comments = Array.from({length: 10000}, (_, index) => note(String(index).padStart(5, '0'), index % 101));
  comments.push({comment_id: 'interval', anchor: {kind: 'interval', start_us: 50, end_us: 70}});
  comments.push(note('before', -5), note('after', 120));
  for (const width of [18, 300, 1500]) {
    const clusters = clusterTimelineComments(comments, 100, width);
    const members = clusters.flatMap(cluster => cluster.comments);
    assert.equal(members.length, comments.length);
    assert.equal(new Set(members.map(comment => comment.comment_id)).size, comments.length);
    checkBounds(clusters, width);
    for (const cluster of clusters) {
      const first = cluster.comments[0];
      assert.equal(cluster.anchor, timelinePosition(first.anchor.kind === 'point' ? first.anchor.at_us : first.anchor.start_us, 100, width));
    }
  }
});

test('unknown duration and initial layout preserve comments without invalid positions', () => {
  const comments = [note('a', 10), note('b', 20)];
  for (const [duration, width] of [[0, 400], [100, 0], [NaN, NaN], [Infinity, -1]]) {
    const clusters = clusterTimelineComments(comments, duration, width);
    assert.deepEqual(ids(clusters), [['a', 'b']]);
    for (const cluster of clusters) for (const value of [cluster.anchor, cluster.left, cluster.width]) assert.ok(Number.isFinite(value));
  }
  assert.deepEqual(clusterTimelineComments([], 100, 300), []);
});
