import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryContents, videoTitle} from '../packages/app/src/library.ts';

const projects = [{id: 'a', title: 'Season 2'}, {id: 'b', title: 'Season 10'}];
const folders = [{id: 'first', project_id: 'a', title: 'First half'}, {id: 'second', project_id: 'a', title: 'Second half'}, {id: 'other', project_id: 'b', title: 'First half'}];
const videos = [{id: 'one', project_id: 'a', folder_id: null, title: 'Match 2.mp4'}, {id: 'two', project_id: 'a', folder_id: 'first', title: 'Attack.mov'}, {id: 'three', project_id: 'b', folder_id: 'other', title: 'Attack.mov'}, {id: 'four', project_id: 'a', folder_id: null, title: 'Match 10.mp4'}];

test('project root shows its folders and root videos; folder selection shows only its videos', () => {
  const original = JSON.stringify({projects, folders, videos});
  assert.deepEqual(libraryContents(projects, folders, videos, null, null).projects.map(item => item.id), ['a', 'b']);
  const root = libraryContents(projects, folders, videos, 'a', null);
  assert.deepEqual(root.folders.map(item => item.id), ['first', 'second']);
  assert.deepEqual(root.videos.map(item => item.id), ['one', 'four']);
  assert.deepEqual(libraryContents(projects, folders, videos, 'a', 'first').videos.map(item => item.id), ['two']);
  assert.deepEqual(libraryContents(projects, folders, videos, 'a', 'second'), {projects: [], folders: [], videos: []});
  assert.deepEqual(libraryContents(projects, folders, videos, 'a', 'other'), {projects: [], folders: [], videos: []});
  assert.deepEqual(libraryContents(projects, folders, videos, 'missing', null), {projects: [], folders: [], videos: []});
  assert.equal(JSON.stringify({projects, folders, videos}), original);
});

test('search finds videos inside a project without leaking other projects or folders', () => {
  assert.deepEqual(libraryContents(projects, folders, videos, null, null, '  season 10 ').projects.map(item => item.id), ['b']);
  assert.deepEqual(libraryContents(projects, folders, videos, 'a', null, ' ATTACK ').videos.map(item => item.id), ['two']);
  assert.deepEqual(libraryContents(projects, folders, videos, 'a', null, 'first').videos.map(item => item.id), ['two']);
  assert.deepEqual(libraryContents(projects, folders, videos, 'a', 'second', 'attack').videos, []);
  assert.equal(videoTitle({title: 'Championship.final.MOV'}), 'Championship.final');
  assert.equal(videoTitle({title: 'Game 2.1'}), 'Game 2.1');
});
