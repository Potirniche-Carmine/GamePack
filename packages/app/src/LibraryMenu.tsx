import React, {useEffect, useRef, useState} from 'react';
import {Animated, Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {Icon, type IconName} from './Icon';
import {useTheme} from './theme';
import {easeOut, useReducedMotion} from './motion';

export type LibraryAction = {label: string; icon: IconName; onPress: () => void; danger?: boolean};
export type LibraryMenuState = {
  id: string; title: string; actions: LibraryAction[]; x: number; y: number;
  keyboard: boolean; trigger: View;
};

type KeyEvent = {nativeEvent: {key: string}; stopPropagation: () => void};

/** Kept in the browser's top layer so a menu never resizes or clips a library row. */
export function LibraryMenu({menu, onDismiss}: {menu: LibraryMenuState; onDismiss: (restoreFocus?: boolean) => void}) {
  const {colors: c} = useTheme();
  const items = useRef<(View | null)[]>([]);
  const surface = useRef<View>(null);
  const reduced = useReducedMotion();
  const [active, setActive] = useState(menu.keyboard ? 0 : -1);
  const opacity = useRef(new Animated.Value(menu.keyboard ? 1 : 0)).current;
  useEffect(() => {
    if (!menu.keyboard) Animated.timing(opacity, {toValue: 1, duration: reduced ? 100 : 160, easing: easeOut, useNativeDriver: true}).start();
    const frame = requestAnimationFrame(() => menu.keyboard ? items.current[0]?.focus() : surface.current?.focus());
    return () => { cancelAnimationFrame(frame); opacity.stopAnimation(); };
  }, [menu.keyboard, opacity, reduced]);
  const focus = (index: number) => {
    const next = (index + menu.actions.length) % menu.actions.length;
    setActive(next); items.current[next]?.focus();
  };
  const activate = (index: number) => {
    const action = menu.actions[index];
    if (!action) return;
    onDismiss(false); action.onPress();
  };
  const keyboardProps = Platform.OS === 'macos' || Platform.OS === 'windows' ? {
    keyDownEvents: ['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab', 'Enter', ' '].map(key => ({key})),
    onKeyDown: (event: KeyEvent) => {
      switch (event.nativeEvent.key) {
        case 'Escape': event.stopPropagation(); onDismiss(true); break;
        case 'ArrowDown': event.stopPropagation(); focus(active + 1); break;
        case 'ArrowUp': event.stopPropagation(); focus(active < 0 ? menu.actions.length - 1 : active - 1); break;
        case 'Home': event.stopPropagation(); focus(0); break;
        case 'End': event.stopPropagation(); focus(menu.actions.length - 1); break;
        case 'Tab': event.stopPropagation(); onDismiss(true); break;
        // Pressable owns Enter/Space activation; handling them a second time would run an action twice.
      }
    },
  } : {};
  return <View {...keyboardProps} style={local.layer} accessibilityViewIsModal onAccessibilityEscape={() => onDismiss(true)}>
    <Pressable accessible={false} focusable={false} style={StyleSheet.absoluteFill} onPress={() => onDismiss(false)} />
    <Animated.View ref={surface} focusable {...{enableFocusRing: false}} accessibilityRole="menu" accessibilityLabel={`Options for ${menu.title}`}
      style={[local.menu, {left: menu.x, top: menu.y, backgroundColor: c.panel, borderColor: c.separator, opacity}]}>
      {menu.actions.map((action, index) => <Pressable key={action.label} ref={node => {items.current[index] = node;}}
        accessibilityRole="menuitem" accessibilityLabel={action.label} focusable {...{enableFocusRing: false}}
        onHoverIn={() => {setActive(index); items.current[index]?.focus();}} onFocus={() => setActive(index)}
        onPress={() => activate(index)}
        style={({pressed}) => [local.action, active === index && {backgroundColor: c.inset}, pressed && {backgroundColor: c.selected}]}>
        <Icon name={action.icon} color={action.danger ? c.danger : c.muted} />
        <Text style={[local.label, {color: action.danger ? c.danger : c.text}]}>{action.label}</Text>
      </Pressable>)}
    </Animated.View>
  </View>;
}

const local = StyleSheet.create({
  layer: {...StyleSheet.absoluteFillObject, zIndex: 100},
  menu: {position: 'absolute', width: 196, borderRadius: 12, borderWidth: 1, padding: 5},
  action: {height: 36, paddingHorizontal: 10, borderRadius: 7, flexDirection: 'row', alignItems: 'center', gap: 10},
  label: {fontSize: 13, lineHeight: 18, fontWeight: '500'},
});
