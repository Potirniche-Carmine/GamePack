import assert from 'node:assert/strict';
import test from 'node:test';
import {clusterTimelineComments, resizeTimelineDock, timelineDockBounds, timelineDockWidth, timelineMotion, timelinePrediction, timelinePosition, timelineSeekTime} from '../packages/app/src/timeline.ts';

test('pausing holds the presented position until the stopped native frame arrives; resume never snaps', () => {
  const playing = {time: 2000000, duration: 30000000, paused: false, rate: 1, seekToken: 1};
  const requested = {...playing, paused: true};
  assert.equal(timelineMotion(playing, requested).kind, 'hold');
  const stopped = {...requested, time: 2073000};
  assert.deepEqual(timelineMotion(requested, stopped), {kind: 'animate', time: stopped.time, duration: 100});
  assert.deepEqual(timelineMotion(stopped, {...stopped, paused: false}), {kind: 'animate', time: 2213000, duration: 140});
  assert.equal(timelineMotion(stopped, {...stopped, seekToken: 2, time: 5000000}).kind, 'snap');
  assert.equal(timelineMotion(stopped, {...stopped, paused: false, rate: -1}).time, 1933000);
});

test('playhead prediction lands on drawing stops without crossing or easing back, in either direction', () => {
  for (const rate of [.5, 1, 2, 4, -1, -2, -4]) {
    const reviewEnd = 2000000;
    const playing = {time: reviewEnd - rate * 40000, duration: 30000000, paused: false, rate, seekToken: 1, reviewEnd};
    const before = {...playing, time: playing.time - rate * 100000};
    assert.deepEqual(timelineMotion(before, playing), {kind: 'animate', time: reviewEnd, duration: 40});
    // Initial samples and seeks use this same bound after snapping.
    assert.deepEqual(timelinePrediction(playing), {time: reviewEnd, duration: 40});
    const stopped = {...playing, time: reviewEnd, paused: true};
    assert.deepEqual(timelineMotion(playing, stopped), {kind: 'snap', time: reviewEnd});
    assert.deepEqual(timelineMotion(stopped, stopped), {kind: 'snap', time: reviewEnd});
    const resumed = {...stopped, paused: false, reviewEnd: reviewEnd + rate * 1000000};
    assert.equal(timelineMotion(stopped, resumed).time, reviewEnd + rate * 140000);
  }
});

test('watch playback prediction is bounded by clip ends without inheriting a review stop', () => {
  const sample = {time: 290000, duration: 300000, paused: false, rate: 1, seekToken: 1, reviewEnd: -1};
  assert.deepEqual(timelinePrediction(sample), {time: 300000, duration: 10});
  assert.deepEqual(timelinePrediction({...sample, time: 10000, rate: -2}), {time: 0, duration: 5});
});

test('dock sizing fits short and long clips without tracking the current playhead', () => {
  for (const review of [false, true]) {
    const short = timelineDockWidth(1400, 30000000, review);
    assert.ok(short <= 640);
    assert.ok(timelineDockWidth(1400, 600000000, review) > short);
    assert.ok(timelineDockWidth(1080, 7200000000, review) <= 840);
    assert.ok(timelineDockWidth(600, 7200000000, review) <= 552);
    assert.ok(Number.isFinite(timelineDockWidth(1400, NaN, review)));
  }
});

test('either resize edge follows the pointer while keeping the timeline centered', () => {
  for (const side of [-1, 1]) {
    const before = 640, available = 1400, delta = side * 73.5;
    const after = resizeTimelineDock(before, delta, side, available);
    const oldEdge = available / 2 + side * before / 2;
    const newEdge = available / 2 + side * after / 2;
    assert.equal(newEdge - oldEdge, delta);
    assert.equal(resizeTimelineDock(after, -delta, side, available), before);
    assert.equal(resizeTimelineDock(before, side * 10000, side, available), 1352);
    assert.equal(resizeTimelineDock(before, -side * 10000, side, available), 560);
  }
});

test('a chosen width survives mode changes and fits resized or unmeasured windows', () => {
  for (const review of [false, true]) {
    assert.equal(timelineDockWidth(1400, 30000000, review, 920), 920);
    assert.equal(timelineDockWidth(800, 30000000, review, 920), 752);
    assert.equal(timelineDockWidth(1400, 30000000, review, 920), 920);
  }
  for (const available of [0, 400, 600, 1080, NaN, Infinity]) {
    const bounds = timelineDockBounds(available);
    assert.ok(bounds.min > 0 && bounds.min <= bounds.max);
    const width = timelineDockWidth(available, NaN, true, Infinity);
    assert.ok(Number.isFinite(width) && width >= bounds.min && width <= bounds.max);
  }
});

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

test('scrubbing follows the thumb across resized tracks and clamps captured drags outside the track', () => {
  const duration = 30000000;
  for (const width of [320, 612, 860]) {
    for (const time of [0, 1000000, 15000000, duration]) {
      assert.equal(timelineSeekTime(timelinePosition(time, duration, width), duration, width), time);
    }
    assert.equal(timelineSeekTime(-100, duration, width), 0);
    assert.equal(timelineSeekTime(width + 100, duration, width), duration);
  }
  for (const [x, length, width] of [[0, 0, 1], [NaN, duration, 640], [50, Infinity, 640], [0, duration, 0]]) {
    assert.equal(timelineSeekTime(x, length, width), 0);
  }
});

test('equal-time comments remain individually represented in a deterministic cluster', () => {
  const comments = [note('b', 50), note('later', 90), note('a', 50)];
  const snapshot = JSON.stringify(comments);
  const clusters = clusterTimelineComments(comments, 100, 500);
  assert.deepEqual(ids(clusters), [['a', 'b'], ['later']]);
  assert.deepEqual(clusters.map(cluster => cluster.comments.length), [2, 1]);
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

test('dense timelines preserve every member once, including simultaneous and out-of-range anchors', () => {
  const comments = Array.from({length: 10000}, (_, index) => note(String(index).padStart(5, '0'), index % 101));
  comments.push({comment_id: 'moment', anchor: {kind: 'point', at_us: 50}});
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
