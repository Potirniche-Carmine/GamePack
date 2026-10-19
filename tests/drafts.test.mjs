import test from 'node:test';
import assert from 'node:assert/strict';
import {canPostDraft, extendPlayDraft, playDraftSeek, seekPlayDraft, resumableDraft} from '../packages/app/src/drafts.ts';
const draft = (id, fields = {}) => ({id, video_id: 'video', text: 'Unfinished note', drawings: [], ...fields});
test('video navigation resumes meaningful work without restoring empty tool selections or another video', () => {
  const saved = draft('saved');
  const drafts = [saved, draft('other', {video_id: 'other'}), draft('empty', {text: ' '})];
  assert.equal(resumableDraft(drafts, 'video'), saved);
  assert.equal(resumableDraft(drafts, 'missing'), undefined);
});
test('drawing and reply actions resume only their own pending conversation', () => {
  const root = draft('root');
  const reply = draft('reply', {parent_comment_id: 'parent'});
  const ink = draft('ink', {text: '', drawings: [{id: 'stroke'}]});
  assert.equal(resumableDraft([root, reply], 'video', null), root);
  assert.equal(resumableDraft([root, reply, ink], 'video', 'parent'), reply);
  assert.equal(resumableDraft([root, reply, ink], 'video'), ink);
  assert.equal(resumableDraft([root, reply], 'video', 'other'), undefined);
});


test('root comments require a drawing, while replies can contain only text', () => {
  assert.equal(canPostDraft(draft('text-only')), false);
  assert.equal(canPostDraft(draft('empty', {text: ''})), false);
  assert.equal(canPostDraft(draft('ink', {text: '', drawings: [{id: 'stroke'}]})), true);
  assert.equal(canPostDraft(draft('reply', {parent_comment_id: 'root'})), true);
  assert.equal(canPostDraft(draft('empty-reply', {text: ' ', parent_comment_id: 'root'})), false);
});

test('play end includes final native samples, survives backward seeks, undo and resume', () => {
  const play = draft('play', {anchor: {kind: 'play', at_us: 100, end_us: 200}});
  const drawings = [{id: 'held', samples: [{x: 1, y: 2, t_us: 250}, {x: 3, y: 4, t_us: 400}]}];
  const flushed = extendPlayDraft(play, 300, drawings);
  assert.equal(flushed.anchor.end_us, 400);
  assert.equal(extendPlayDraft(flushed, 150, []).anchor.end_us, 400);
  assert.deepEqual(play.anchor, {kind: 'play', at_us: 100, end_us: 200});
  assert.equal(playDraftSeek(flushed, 0, 1000), 0);
  assert.equal(playDraftSeek(flushed, 1100, 1000), 1000);
  assert.equal(playDraftSeek({...flushed, parent_comment_id: 'root'}, 900, 1000), 400);
  assert.equal(extendPlayDraft({...flushed, parent_comment_id: 'root'}, 500).anchor.end_us, 400);
  assert.equal(resumableDraft([flushed], 'video', null), flushed);
});

test('a new timed annotation can move its start anywhere on the timeline', () => {
  const play = draft('empty', {anchor: {kind: 'play', at_us: 500, end_us: 800}});
  assert.deepEqual(seekPlayDraft(play, 100, 1000).anchor, {kind: 'play', at_us: 100, end_us: 100});
  assert.deepEqual(seekPlayDraft(play, 1200, 1000).anchor, {kind: 'play', at_us: 1000, end_us: 1000});
  assert.deepEqual(play.anchor, {kind: 'play', at_us: 500, end_us: 800});
});

test('scrubbing and stepping before a timed drawing preserve its samples and expand the window', () => {
  const drawings = [{id: 'stroke', samples: [{x: 1, y: 2, t_us: 500}, {x: 3, y: 4, t_us: 700}]}];
  const play = draft('ink', {anchor: {kind: 'play', at_us: 500, end_us: 800}, drawings});
  const earlier = seekPlayDraft(play, 100, 1000);
  assert.deepEqual(earlier.anchor, {kind: 'play', at_us: 100, end_us: 800});
  assert.deepEqual(earlier.drawings, drawings);
  assert.deepEqual(seekPlayDraft(earlier, 950, 1000).anchor, {kind: 'play', at_us: 100, end_us: 950});
  assert.equal(extendPlayDraft(play, 400).anchor.at_us, 400);
  const reply = {...play, parent_comment_id: 'root'};
  assert.equal(seekPlayDraft(reply, 100, 1000), reply);
  assert.equal(playDraftSeek(reply, 100, 1000), 500);
  assert.deepEqual(extendPlayDraft(reply, 100).anchor, reply.anchor);
});
