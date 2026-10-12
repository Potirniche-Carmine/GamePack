import React, {type ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {GamePackGlass} from './native';
import {useTheme} from './theme';
import {ANNOTATION_COLOR} from './playback';

export function GlassSurface({radius = 20}: {radius?: number}) {
  const {dark} = useTheme();
  return <GamePackGlass key={dark ? 'dark' : 'light'} accessible={false} pointerEvents="none" dark={dark} cornerRadius={radius} style={StyleSheet.absoluteFill} />;
}

export function Glass({children, style, selected = false}: {children?: ReactNode; style?: StyleProp<ViewStyle>; selected?: boolean}) {
  const radius = Number(StyleSheet.flatten(style)?.borderRadius ?? 20);
  return <View style={[{borderRadius: radius}, style]}>
    <GlassSurface radius={radius} />
    {selected && <View pointerEvents="none" style={[StyleSheet.absoluteFill, {borderRadius: radius, borderWidth: 1, borderColor: ANNOTATION_COLOR}]} />}
    {children}
  </View>;
}

export function LibraryBackdrop() {
  const {dark} = useTheme();
  return <GamePackGlass key={dark ? 'dark' : 'light'} accessible={false} pointerEvents="none" desktop dark={dark} cornerRadius={0} style={StyleSheet.absoluteFill} />;
}
