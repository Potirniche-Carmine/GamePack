import test from 'node:test';
import assert from 'node:assert/strict';
import {binding, bindingError, effectiveShortcutChords, migrateReviewBindings, shortcutAction, shortcutLabel, shortcuts} from '../packages/app/src/shortcuts.ts';

test('new review commands preserve keys already customized in older libraries', () => {
  const old = {play: 'F', comment: 'Shift+M', nextVideo: 'Mod+Shift+R'};
  const migrated = migrateReviewBindings(old);
  assert.deepEqual(migrated, {...old, present: null, onVideoNotes: null, allReplies: null});
  assert.equal(shortcutAction({chord: 'F', repeat: false}, migrated), 'play');
  assert.deepEqual(migrateReviewBindings(migrated), migrated);
  assert.deepEqual(migrateReviewBindings({present: 'Shift+F'}), {present: 'Shift+F'});
  assert.equal(old.present, undefined);
});

test('editor defaults are unique and remapping replaces rather than aliases a binding', () => {
  assert.equal(new Set(shortcuts.map(item => item.key)).size, shortcuts.length);
  const custom = {play: 'Shift+P', pen: null};
  assert.equal(shortcutAction({chord: 'Space', repeat: false}, custom), undefined);
  assert.equal(shortcutAction({chord: 'Shift+P', repeat: false}, custom), 'play');
  assert.equal(shortcutAction({chord: 'P', repeat: false}, custom), undefined);
  assert.equal(binding('settings', custom), 'Mod+,');
});
test('repeat only repeats seeking and frame steps', () => {
  assert.equal(shortcutAction({chord: 'Space', repeat: true}, {}), undefined);
  assert.equal(shortcutAction({chord: 'ArrowRight', repeat: true}, {}), 'nextFrame');
  assert.equal(shortcutAction({chord: 'Mod+Backspace', repeat: true}, {}), undefined);
});
test('conflicts, text editing, and reserved keys cannot silently overwrite commands', () => {
  assert.ok(bindingError('play', 'J', {}));
  assert.ok(bindingError('play', 'Mod+Q', {}));
  assert.ok(bindingError('play', 'Enter', {}));
  assert.ok(bindingError('submit', 'Shift+P', {}));
  assert.equal(bindingError('play', 'P', {pen: null}), null);
  assert.equal(bindingError('play', 'Mod+Shift+P', {}), null);
  assert.equal(shortcutLabel('Mod+Shift+Z', false), 'Ctrl + Shift + Z');
  assert.equal(shortcutLabel(null, true), 'Unassigned');
});

test('the printed plus key zooms with the default binding while respecting overrides', () => {
  for (const repeat of [false, true]) {
    assert.equal(shortcutAction({chord: '=', repeat}, {}), 'zoomIn');
    assert.equal(shortcutAction({chord: 'Shift+=', repeat}, {}), 'zoomIn');
  }
  assert.ok(effectiveShortcutChords({}).includes('Shift+='));
  for (const custom of [{zoomIn: null}, {zoomIn: 'Shift+Z'}]) {
    assert.equal(shortcutAction({chord: 'Shift+=', repeat: false}, custom), undefined);
    assert.equal(effectiveShortcutChords(custom).includes('Shift+='), false);
  }
  const assigned = {play: 'Shift+='};
  assert.equal(bindingError('play', 'Shift+=', {}), null);
  assert.equal(shortcutAction({chord: 'Shift+=', repeat: false}, assigned), 'play');
  assert.equal(shortcutAction({chord: 'Shift+=', repeat: true}, assigned), undefined);
  assert.equal(effectiveShortcutChords(assigned).filter(chord => chord === 'Shift+=').length, 1);
  assert.equal(shortcutAction({chord: '=', repeat: false}, assigned), 'zoomIn');
  assert.equal(shortcutAction({chord: '=', repeat: false}, {zoomIn: 'Shift+='}), undefined);
  assert.equal(shortcutAction({chord: 'Shift+=', repeat: true}, {zoomIn: 'Shift+='}), 'zoomIn');
});
