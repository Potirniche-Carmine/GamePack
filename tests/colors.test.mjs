import test from 'node:test';
import assert from 'node:assert/strict';
import {darkColors, lightColors} from '../packages/app/src/colors.ts';
const luminance = color => color.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
test('both themes meet text, control-boundary and selected-state contrast targets', () => {
  for (const colors of [darkColors, lightColors]) {
    for (const surface of ['bg', 'panel', 'sidebar', 'inset', 'input', 'button']) {
      for (const text of ['text', 'muted', 'faint']) assert.ok(contrast(colors[text], colors[surface]) >= 4.5, `${text} on ${surface}: ${contrast(colors[text], colors[surface])}`);
    }
    for (const [text, surface] of [['accentText', 'selected'], ['primaryText', 'accent'], ['danger', 'errorBg']]) assert.ok(contrast(colors[text], colors[surface]) >= 4.5);
    assert.ok(contrast(colors.line, colors.input) >= 3);
    assert.ok(contrast(colors.line, colors.button) >= 3);
    assert.ok(contrast(colors.selectedLine, colors.selected) >= 3);
  }
});
