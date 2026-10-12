import assert from 'node:assert/strict';
import test from 'node:test';
import {clusterTimelineComments, timelineDockWidth, timelineMotion, timelinePosition, timelineSeekTime} from '../packages/app/src/timeline.ts';

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

test('dock sizing fits short and long clips without tracking the current playhead', () => {
  for (const review of [false, true]) {
    const short = timelineDockWidth(1400, 30000000, review);
    assert.ok(short <= 560);
    assert.ok(timelineDockWidth(1400, 600000000, review) > short);
    assert.ok(timelineDockWidth(1080, 7200000000, review) <= 760);
    assert.ok(timelineDockWidth(600, 7200000000, review) <= 552);
    assert.ok(Number.isFinite(timelineDockWidth(1400, NaN, review)));
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
