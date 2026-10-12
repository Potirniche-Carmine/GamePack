import test from 'node:test';
import assert from 'node:assert/strict';
import {canPostDraft, resumableDraft} from '../packages/app/src/drafts.ts';
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
