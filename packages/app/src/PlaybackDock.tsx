import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import {Animated, Platform, StyleSheet, View, type GestureResponderEvent} from 'react-native';
import {Glass} from './Glass';
import {resizeTimelineDock, timelineDockBounds, timelineDockWidth} from './timeline';
import {useTheme} from './theme';

/** Resize through layout so text, thumbnails and hit targets retain their proportions. */
export function PlaybackDock({available, duration, reviewing, disabled, hidden, opacity, onInteractionChange, popover, popoverCenter, children}: {
  available: number; duration: number; reviewing: boolean; disabled: boolean; hidden: boolean;
  opacity: Animated.Value; onInteractionChange: (active: boolean) => void; popover: ReactNode; popoverCenter: number; children: ReactNode;
}) {
  const {colors} = useTheme();
  const [popoverWidth, setPopoverWidth] = useState(64);
  const [preferred, setPreferred] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [activeEdge, setActiveEdge] = useState<number | null>(null);
  const [focusedEdge, setFocusedEdge] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{pageX: number; width: number; side: -1 | 1; identifier: string; previous: number | null} | null>(null);
  const width = timelineDockWidth(available, duration, reviewing, preferred);
  const bounds = timelineDockBounds(available);
  const canResize = !disabled && bounds.max > bounds.min;
  useEffect(() => {
    onInteractionChange(hovered || resizing || focusedEdge !== null);
    return () => onInteractionChange(false);
  }, [hovered, resizing, focusedEdge, onInteractionChange]);
  const cancel = () => {
    if (drag.current) setPreferred(drag.current.previous);
    drag.current = null; setResizing(false);
  };
  useEffect(() => { cancel(); }, [disabled, available]);
  const move = (event: GestureResponderEvent) => {
    const start = drag.current;
    if (!start || start.identifier !== event.nativeEvent.identifier) return;
    setPreferred(resizeTimelineDock(start.width, event.nativeEvent.pageX - start.pageX, start.side, available));
  };
  return <Animated.View pointerEvents={hidden ? 'none' : 'auto'} accessibilityElementsHidden={hidden}
    importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    {...{onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false)}}
    style={[styles.dock, {width, left: (available - width) / 2, opacity}]}>
    <Glass style={styles.surface}>{children}</Glass>
    {([-1, 1] as const).map(side => <View key={side}
      accessible focusable={canResize} accessibilityRole="adjustable" accessibilityLabel={`Resize timeline from ${side < 0 ? 'left' : 'right'}`}
      accessibilityState={{disabled: !canResize}} accessibilityValue={{min: bounds.min, max: bounds.max, now: Math.round(width)}}
      accessibilityActions={[{name: 'increment', label: 'Widen timeline'}, {name: 'decrement', label: 'Narrow timeline'}, {name: 'activate', label: 'Reset timeline width'}]}
      onAccessibilityAction={event => {
        if (!canResize) return;
        const action = event.nativeEvent.actionName;
        if (action === 'activate') setPreferred(null);
        else if (action === 'increment' || action === 'decrement') setPreferred(timelineDockWidth(available, duration, reviewing, width + (action === 'increment' ? 40 : -40)));
      }}
      {...{enableFocusRing: false, mouseDownCanMoveWindow: false,
        onMouseEnter: () => setActiveEdge(side), onMouseLeave: () => setActiveEdge(null),
        onDoubleClick: () => { if (canResize) { drag.current = null; setResizing(false); setPreferred(null); } }}}
      onFocus={() => setFocusedEdge(side)} onBlur={() => setFocusedEdge(null)}
      onStartShouldSetResponder={() => canResize} onMoveShouldSetResponder={() => canResize}
      onResponderGrant={event => {
        if (drag.current) return;
        drag.current = {pageX: event.nativeEvent.pageX, width, side, identifier: event.nativeEvent.identifier, previous: preferred};
        setResizing(true);
      }}
      onResponderMove={move} onResponderRelease={event => { move(event); drag.current = null; setResizing(false); }}
      onResponderTerminationRequest={() => false} onResponderTerminate={cancel}
      style={[styles.edge, side < 0 ? {left: 0} : {right: 0}, Platform.OS === 'macos' && ({cursor: canResize ? 'ew-resize' : 'default'} as object)]}>
      <View pointerEvents="none" style={[styles.grip, {backgroundColor: focusedEdge === side || activeEdge === side || (resizing && drag.current?.side === side) ? colors.text : colors.muted, opacity: canResize ? 1 : .3}]} />
    </View>)}
    {!!popover && <View onLayout={event => setPopoverWidth(event.nativeEvent.layout.width)}
      style={[styles.popover, {left: Math.max(0, Math.min(width - popoverWidth, popoverCenter - popoverWidth / 2))}]}>
      <Glass style={styles.menu}>{popover}</Glass>
    </View>}
  </Animated.View>;
}

const styles = StyleSheet.create({
  dock: {position: 'absolute', bottom: 18},
  surface: {borderRadius: 24, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10},
  edge: {position: 'absolute', top: 22, bottom: 22, width: 16, alignItems: 'center', justifyContent: 'center'},
  grip: {width: 3, height: 28, borderRadius: 1.5},
  popover: {position: 'absolute', bottom: '100%', marginBottom: 8},
  menu: {padding: 6, borderRadius: 16},
});
