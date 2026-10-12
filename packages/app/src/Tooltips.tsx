import React, {createContext, useMemo, useRef, useState, type ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTheme} from './theme';

type Hint = {owner: object; label: string; shortcut: string; left: number; top: number};
export const TooltipContext = createContext({
  show: (_owner: object, _target: View, _label: string, _shortcut: string) => {},
  hide: (_owner: object) => {},
});

/** Render above the native glass/toolbar clipping layers, without taking focus. */
export function TooltipProvider({children}: {children: ReactNode}) {
  const {colors} = useTheme();
  const root = useRef<View>(null);
  const size = useRef({width: 1, height: 1});
  const owner = useRef<object | null>(null);
  const generation = useRef(0);
  const [hint, setHint] = useState<Hint | null>(null);
  const context = useMemo(() => ({
    show: (nextOwner: object, target: View, label: string, shortcut: string) => {
      owner.current = nextOwner;
      const token = ++generation.current;
      target.measureInWindow((x, y, width, height) => root.current?.measureInWindow((rootX, rootY) => {
        if (token !== generation.current) return;
        setHint({owner: nextOwner, label, shortcut,
          left: Math.max(8, Math.min(size.current.width - 162, x - rootX + width + 12)),
          top: Math.max(8, Math.min(size.current.height - 42, y - rootY + (height - 34) / 2))});
      }));
    },
    hide: (previousOwner: object) => {
      if (owner.current !== previousOwner) return;
      owner.current = null; generation.current++; setHint(null);
    },
  }), []);
  return <TooltipContext.Provider value={context}>
    <View ref={root} collapsable={false} style={styles.root} onLayout={event => { size.current = event.nativeEvent.layout; generation.current++; setHint(null); }}>
      {children}
      {hint && <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.hint, {left: hint.left, top: hint.top, backgroundColor: colors.panel, borderColor: colors.line}]}>
        <Text accessible={false} style={[styles.label, {color: colors.text}]}>{hint.label}</Text>
        {!!hint.shortcut && <View style={[styles.key, {backgroundColor: colors.inset, borderColor: colors.line}]}>
          <Text accessible={false} style={[styles.shortcut, {color: colors.muted}]}>{hint.shortcut}</Text>
        </View>}
      </View>}
    </View>
  </TooltipContext.Provider>;
}

const styles = StyleSheet.create({
  root: {flex: 1},
  hint: {position: 'absolute', zIndex: 100, width: 154, minHeight: 34, paddingHorizontal: 10, paddingVertical: 6,
    flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 10, borderWidth: 1,
    shadowColor: '#000000', shadowOpacity: .15, shadowRadius: 10, shadowOffset: {width: 0, height: 4}},
  label: {fontSize: 12, fontWeight: '500', flex: 1},
  key: {minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 5, borderWidth: 1, alignItems: 'center', justifyContent: 'center'},
  shortcut: {fontSize: 11, fontWeight: '500'},
});
