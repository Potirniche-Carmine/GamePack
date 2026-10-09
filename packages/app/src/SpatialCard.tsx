import React, {createContext, useContext, useRef, useState, type ReactNode} from 'react';
import {Platform, StyleSheet, View, type GestureResponderEvent, type ViewProps} from 'react-native';
import {cardOrigin, clampCard, normalizedPoint, type Point, type Rect, type Size} from './spatial';

type DragSession = {pointer: Point; origin: Point; end: Point; moved: boolean};
type DragController = {
  disabled: boolean;
  begin: (event: GestureResponderEvent) => void;
  move: (event: GestureResponderEvent) => void;
  end: (event: GestureResponderEvent) => boolean;
  cancel: () => void;
};
const DragContext = createContext<DragController | null>(null);

function pointer(event: GestureResponderEvent): Point {
  // macOS sends NSEvent locations as page coordinates; do not depend on the
  // PanResponder touch-history accumulator for a desktop mouse gesture.
  const source = event.nativeEvent;
  return {x: source.pageX, y: source.pageY};
}

/** A card header owns its drag, while nested buttons keep their own responders. */
export function DragHandle({onPress, onHoverIn, onHoverOut, style, ...props}: ViewProps & {
  onPress?: () => void; onHoverIn?: () => void; onHoverOut?: () => void;
}) {
  const controller = useContext(DragContext);
  const [pressed, setPressed] = useState(false);
  const keyboardPressed = useRef(false);
  const interactive = !!onPress && !controller?.disabled;
  const nativeProps = Platform.OS === 'macos' || Platform.OS === 'windows' ? {
    enableFocusRing: false,
    onMouseEnter: onHoverIn,
    onMouseLeave: onHoverOut,
    keyDownEvents: interactive ? [{key: 'Enter'}, {key: ' '}] : [],
    keyUpEvents: interactive ? [{key: 'Enter'}, {key: ' '}] : [],
    onKeyDown: (event: {nativeEvent: {key: string}; stopPropagation: () => void}) => {
      if (!interactive || !['Enter', ' '].includes(event.nativeEvent.key)) return;
      event.stopPropagation(); keyboardPressed.current = true; setPressed(true);
    },
    onKeyUp: (event: {nativeEvent: {key: string}; stopPropagation: () => void}) => {
      if (!interactive || !['Enter', ' '].includes(event.nativeEvent.key)) return;
      event.stopPropagation(); setPressed(false);
      if (keyboardPressed.current) onPress?.();
      keyboardPressed.current = false;
    },
  } : {};
  return <View {...props} {...nativeProps} focusable={interactive || props.focusable} onAccessibilityTap={interactive ? onPress : undefined}
    onBlur={event => { keyboardPressed.current = false; setPressed(false); props.onBlur?.(event); }}
    onStartShouldSetResponder={() => !!controller && !controller.disabled}
    onResponderGrant={event => { setPressed(true); controller?.begin(event); }}
    onResponderMove={event => controller?.move(event)}
    onResponderRelease={event => { setPressed(false); if (controller?.end(event) && interactive) onPress?.(); }}
    onResponderTerminate={() => { setPressed(false); controller?.cancel(); }}
    onResponderTerminationRequest={() => false}
    style={[style, pressed && interactive && {opacity: .8}]} />;
}

/** Pointer coordinates map directly to layout; no animated transform can reset on disclosure. */
export function SpatialCard({position, rect, viewport, width, topInset = 16, active, disabled, onMove, onGrab, children}: {
  position: Point; rect: Rect; viewport: Size; width: number; topInset?: number; active?: boolean; disabled?: boolean;
  onMove: (point: Point) => void; onGrab: () => void; children: ReactNode;
}) {
  const [height, setHeight] = useState(100);
  const [dragPosition, setDragPosition] = useState<Point | null>(null);
  const size = {width, height};
  const origin = cardOrigin(position, rect, viewport, size, topInset);
  const latest = useRef({origin, rect, viewport, size, topInset, disabled, onMove, onGrab});
  latest.current = {origin, rect, viewport, size, topInset, disabled, onMove, onGrab};
  const drag = useRef<DragSession | null>(null);
  const update = (event: GestureResponderEvent) => {
    const session = drag.current;
    if (!session) return;
    const point = pointer(event);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const dx = point.x - session.pointer.x, dy = point.y - session.pointer.y;
    if (!session.moved && Math.abs(dx) + Math.abs(dy) <= 5) return;
    session.moved = true;
    const current = latest.current;
    session.end = clampCard({x: session.origin.x + dx, y: session.origin.y + dy}, current.viewport, current.size, current.topInset, current.rect);
    setDragPosition(session.end);
  };
  const controller: DragController = {
    disabled: !!disabled,
    begin: event => {
      const point = pointer(event);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      drag.current = {pointer: point, origin: latest.current.origin, end: latest.current.origin, moved: false};
      latest.current.onGrab();
    },
    move: update,
    end: event => {
      update(event);
      const session = drag.current;
      drag.current = null;
      if (session?.moved) latest.current.onMove(normalizedPoint(session.end, latest.current.rect));
      setDragPosition(null);
      return !!session && !session.moved;
    },
    cancel: () => { drag.current = null; setDragPosition(null); },
  };
  const displayed = dragPosition ?? origin;
  return <View style={[styles.position, {width, left: displayed.x, top: displayed.y, zIndex: dragPosition ? 30 : active ? 20 : 5}]}>
    <DragContext.Provider value={controller}>
      <View onLayout={event => setHeight(event.nativeEvent.layout.height)}>{children}</View>
    </DragContext.Provider>
  </View>;
}
const styles = StyleSheet.create({position: {position: 'absolute'}});
