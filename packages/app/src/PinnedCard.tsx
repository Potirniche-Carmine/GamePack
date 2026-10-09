import React, {useState, type ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DragHandle, SpatialCard} from './SpatialCard';
import {cardOrigin, pinnedCardOffset, type Point, type Rect, type Size} from './spatial';
import {useTheme} from './theme';

/** The pin owns the saved location. Opening or growing its card never moves it. */
export function PinnedCard({position, viewport, rect, topInset = 16, color, number, label, open, width = 280, disabled, onToggle, onMove, onGrab, children}: {
  position: Point; viewport: Size; rect: Rect; topInset?: number; color: string; number?: number; label: string;
  open: boolean; width?: number; disabled?: boolean; onToggle: () => void; onMove: (point: Point) => void;
  onGrab: () => void; children?: ReactNode;
}) {
  const {dark, colors} = useTheme();
  const [height, setHeight] = useState(120);
  const [focused, setFocused] = useState(false);
  const cardWidth = Math.max(1, Math.min(width, viewport.width - 100));
  const origin = cardOrigin(position, rect, viewport, {width: 32, height: 40}, topInset);
  const offset = pinnedCardOffset(origin, viewport, {width: cardWidth, height}, topInset);
  return <SpatialCard position={position} viewport={viewport} rect={rect} width={32} topInset={topInset} active={open} disabled={disabled} onMove={onMove} onGrab={onGrab}>
    <DragHandle accessible accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Click to show or hide. Drag to move pin."
      accessibilityState={{expanded: open, disabled: !!disabled}} onPress={onToggle} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={styles.pin}>
      <View style={[styles.head, {backgroundColor: color, borderColor: focused ? colors.text : '#ffffff'}]}>
        <Text style={[styles.number, {color: dark ? '#18181a' : '#ffffff'}]}>{number ?? '+'}</Text>
      </View>
      <View style={[styles.tip, {borderTopColor: '#ffffff'}]} /><View style={[styles.tipColor, {borderTopColor: color}]} />
    </DragHandle>
    {open && <View onLayout={event => setHeight(event.nativeEvent.layout.height)} style={[styles.card, {left: offset.x, top: offset.y, width: cardWidth}]}>{children}</View>}
  </SpatialCard>;
}
const styles = StyleSheet.create({
  pin: {width: 32, height: 40, alignItems: 'center'},
  head: {width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 1},
  number: {fontSize: 12, fontWeight: '700'},
  tip: {position: 'absolute', top: 25, borderLeftWidth: 9, borderRightWidth: 9, borderTopWidth: 14, borderLeftColor: 'transparent', borderRightColor: 'transparent'},
  tipColor: {position: 'absolute', top: 26, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', zIndex: 2},
  card: {position: 'absolute'},
});
