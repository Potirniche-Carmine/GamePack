import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {initialsForName} from './profile';
import {useTheme} from './theme';

export function Avatar({name, size = 32}: {name: string; size?: number}) {
  const {colors} = useTheme();
  return <View accessible={false} style={[styles.avatar, {width: size, height: size, borderRadius: size / 2, backgroundColor: colors.button}]}>
    <Text accessible={false} numberOfLines={1} style={[styles.initials, {fontSize: Math.round(size * 0.35), lineHeight: Math.round(size * 0.47), color: colors.text}]}>{initialsForName(name)}</Text>
  </View>;
}

const styles = StyleSheet.create({
  avatar: {alignItems: 'center', justifyContent: 'center', flexShrink: 0},
  initials: {fontWeight: '600', textAlign: 'center', letterSpacing: -0.2},
});
