import defaults from './shortcut-defaults.json';
export const shortcuts = defaults;
export type Keybindings = Record<string, string | null>;
export type ShortcutEvent = {chord: string; repeat: boolean; text?: string};
/** New defaults must not take a key already assigned in an older library. */
export function migrateReviewBindings(overrides: Keybindings): Keybindings {
  const next = {...overrides};
  for (const id of ['present', 'onVideoNotes', 'allReplies', 'laser', 'zoomIn', 'zoomOut', 'zoomReset']) {
    const chord = shortcuts.find(item => item.id === id)?.key;
    if (chord && !Object.prototype.hasOwnProperty.call(next, id) && Object.values(overrides).includes(chord)) next[id] = null;
  }
  return next;
}
export function binding(id: string, overrides: Keybindings): string | null {
  return Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : shortcuts.find(item => item.id === id)?.key ?? null;
}
function hasZoomInAlias(overrides: Keybindings): boolean {
  return binding('zoomIn', overrides) === '=' && !shortcuts.some(item => item.id !== 'zoomIn' && binding(item.id, overrides) === 'Shift+=');
}
/** Accept the printed + key as well as = without taking a custom assignment. */
export function effectiveShortcutChords(overrides: Keybindings): string[] {
  const chords = shortcuts.map(item => binding(item.id, overrides)).filter((chord): chord is string => !!chord);
  if (hasZoomInAlias(overrides)) chords.push('Shift+=');
  return [...new Set(chords)];
}
export function shortcutAction(event: ShortcutEvent, overrides: Keybindings): string | undefined {
  const item = shortcuts.find(item => binding(item.id, overrides) === event.chord);
  if (item) return !event.repeat || item.repeat ? item.id : undefined;
  return event.chord === 'Shift+=' && hasZoomInAlias(overrides) ? 'zoomIn' : undefined;
}
export function shortcutLabel(chord: string | null, mac: boolean): string {
  if (!chord) return 'Unassigned';
  const names: Record<string, string> = {Mod: mac ? '⌘' : 'Ctrl', Alt: mac ? '⌥' : 'Alt', Shift: mac ? '⇧' : 'Shift', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Backspace: mac ? '⌫' : 'Backspace', Enter: 'Return'};
  return chord.split('+').map(key => names[key] ?? key).join(mac ? ' ' : ' + ');
}
export function bindingError(id: string, chord: string, overrides: Keybindings): string | null {
  const parts = chord.split('+'), key = parts.pop()!;
  if (!/^(?:[A-Z0-9,.[\]\/;='-]|Space|Enter|Backspace|Delete|Home|End|ArrowLeft|ArrowRight|ArrowUp|ArrowDown)$/.test(key)) return 'Choose a letter, number, arrow, or navigation key.';
  if (['Mod+Q','Mod+W','Mod+H','Mod+M','Mod+C','Mod+X','Mod+V','Mod+A','Mod+Tab','Alt+F4'].includes(chord) || (key === 'Enter' && !parts.includes('Mod'))) return 'That shortcut is reserved for the system or text editing.';
  if (id === 'submit' && !parts.includes('Mod')) return 'Use Command or Control so posting works while typing.';
  const conflict = shortcuts.find(item => item.id !== id && binding(item.id, overrides) === chord);
  return conflict ? `Already used by ${conflict.label.toLowerCase()}.` : null;
}
