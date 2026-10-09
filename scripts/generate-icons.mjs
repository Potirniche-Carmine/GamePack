// Official Lucide assets, rendered at native display scales. No custom paths.
import {readFileSync, writeFileSync, mkdirSync, copyFileSync} from 'node:fs';
import {Resvg} from '@resvg/resvg-js';
const names = ['maximize', 'minimize', 'panel-left', 'panel-right', 'chevron-left', 'chevrons-down-up', 'chevrons-up-down', 'bookmark', 'mouse-pointer-2', 'pencil', 'move-up-right', 'ellipse', 'undo-2', 'redo-2', 'settings', 'settings-2', 'trash-2', 'folder', 'film', 'message-square', 'reply', 'play', 'pause', 'chevron-right', 'chevron-down', 'x', 'plus', 'eye', 'eye-off', 'clock', 'check', 'target'];
const output = new URL('../packages/app/assets/icons/', import.meta.url);
mkdirSync(output, {recursive: true});
for (const name of names) {
  const svg = readFileSync(new URL(`../node_modules/lucide-static/icons/${name}.svg`, import.meta.url), 'utf8').replaceAll('currentColor', '#000000');
  for (const scale of [1, 2, 3]) {
    const png = new Resvg(svg, {fitTo: {mode: 'width', value: 18 * scale}}).render().asPng();
    writeFileSync(new URL(`${name}${scale === 1 ? '' : `@${scale}x`}.png`, output), png);
  }
}
copyFileSync(new URL('../node_modules/lucide-static/LICENSE', import.meta.url), new URL('LICENSE', output));
