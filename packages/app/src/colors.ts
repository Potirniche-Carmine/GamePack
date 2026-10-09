export const darkColors = {
  bg: '#19191b', panel: '#242426', sidebar: '#202022', inset: '#202022',
  separator: '#3a3a3d', line: '#858589', text: '#f4f3f0', muted: '#bcbbc0', faint: '#aaa9ae',
  accent: '#eeede9', accentText: '#e7e6e2', primaryText: '#242426', selected: '#38383c',
  selectedLine: '#a6a5ab', button: '#303033', disabled: '#29292c', input: '#222224',
  danger: '#ffb5b1', errorBg: '#4c2e35', errorText: '#ffe5e2',
};
export const lightColors: typeof darkColors = {
  bg: '#f7f6f3', panel: '#ffffff', sidebar: '#f0efec', inset: '#efeeeb',
  separator: '#e2e0dc', line: '#898783', text: '#29292d', muted: '#64636a', faint: '#6d6b72',
  accent: '#303034', accentText: '#333337', primaryText: '#ffffff', selected: '#e7e5e1',
  selectedLine: '#77757b', button: '#f0efec', disabled: '#efeeeb', input: '#fbfaf8',
  danger: '#a42b36', errorBg: '#ffebe8', errorText: '#81252d',
};
export type Colors = typeof darkColors;
