import React, {createContext, useContext, useMemo} from 'react';
import {useColorScheme} from 'react-native';
import {createStyles, darkColors, lightColors} from './styles';
import type {ThemeChoice} from './types';

const initial = {colors: lightColors, styles: createStyles(lightColors), dark: false};
export const ThemeContext = createContext(initial);
export function useTheme() { return useContext(ThemeContext); }
export function useThemeChoice(choice: ThemeChoice) {
  const scheme = useColorScheme();
  const dark = choice === 'dark' || (choice === 'system' && scheme === 'dark');
  return useMemo(() => { const colors = dark ? darkColors : lightColors; return {colors, styles: createStyles(colors), dark}; }, [dark]);
}
