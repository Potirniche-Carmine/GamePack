import React, {memo, useEffect, useMemo, useRef} from 'react';
import {Animated, StyleSheet, View} from 'react-native';
import {timeLabel} from './components';
import {useTheme} from './theme';
import {usePlaybackTimeline} from './usePlaybackTimeline';

/** Native playback reports at 10 Hz. Only the progress transforms interpolate;
 * labels, review stops, and the engine retain the authoritative media clock. */
export function WatchTimeline({time, duration, paused, rate, seekToken, disabled, onSeek}: {
  time: number; duration: number; paused: boolean; rate: number; seekToken: number;
  disabled: boolean; onSeek: (time: number) => void;
}) {
  const {colors, dark} = useTheme();
  const {width, setWidth, focused, setFocused, hovered, setHovered, scrubbing, position, slider, canSeek, start, move, finish, cancel} = usePlaybackTimeline({time, duration, paused, rate, seekToken, disabled, onSeek});
  const emphasized = focused || hovered || scrubbing;
  const emphasis = useRef(new Animated.Value(emphasized ? 1 : 0)).current;
  // Hover/focus feedback must not repaint a stale JS translation over the
  // continuously running native playhead.
  useEffect(() => emphasis.setValue(emphasized ? 1 : 0), [emphasis, emphasized]);
  const travel = Math.max(0, width - 24);
  const restingX = Math.max(0, Math.min(1, time / Math.max(1, duration))) * travel;
  return <View ref={slider} {...{enableFocusRing: false, onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false)}}
    focusable={canSeek} accessible accessibilityRole="adjustable" accessibilityLabel="Video timeline" accessibilityState={{disabled: !canSeek}}
    accessibilityValue={{min: 0, max: Math.round(duration / 1000000), now: Math.round(time / 1000000), text: timeLabel(time)}}
    accessibilityActions={[{name: 'increment', label: 'Forward five seconds'}, {name: 'decrement', label: 'Back five seconds'}]}
    onAccessibilityAction={event => { if (canSeek) onSeek(Math.max(0, Math.min(duration, time + (event.nativeEvent.actionName === 'increment' ? 5000000 : -5000000)))); }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onLayout={event => setWidth(event.nativeEvent.layout.width)} style={styles.root}
    onStartShouldSetResponder={() => canSeek} onMoveShouldSetResponder={() => canSeek}
    onResponderGrant={start} onResponderMove={move} onResponderTerminationRequest={() => false}
    onResponderRelease={finish} onResponderTerminate={cancel}>
    <View pointerEvents="none" style={[styles.track, {height: emphasized ? 6 : 4, backgroundColor: dark ? '#ffffff30' : '#17233030', borderColor: focused ? colors.selectedLine : 'transparent', borderWidth: focused ? 1 : 0}]}>
      {paused && !scrubbing ? <View style={[styles.fill, {width: restingX, backgroundColor: colors.text}]} />
        : <WatchProgress position={position} travel={travel} color={colors.text} />}
    </View>
    {paused && !scrubbing ? <View pointerEvents="none" style={[styles.thumb, {left: 7 + restingX, backgroundColor: colors.text, opacity: emphasized ? 1 : .95,
      transform: [{scale: emphasized ? 1.2 : 1}]}]} />
      : <WatchThumb position={position} travel={travel} color={colors.text} emphasis={emphasis} />}
  </View>;
}

// As in ReviewPlayhead, media-clock renders must not overwrite native motion
// with the last position synchronized back to JS.
type IndicatorProps = {position: Animated.Value; travel: number; color: string};
const WatchProgress = memo(function WatchProgress({position, travel, color}: IndicatorProps) {
  const translateX = useMemo(() => position.interpolate({inputRange: [0, 1], outputRange: [-travel, 0]}), [position, travel]);
  return <Animated.View style={[styles.fill, {width: travel, backgroundColor: color, transform: [{translateX}]}]} />;
});
const WatchThumb = memo(function WatchThumb({position, travel, color, emphasis}: IndicatorProps & {emphasis: Animated.Value}) {
  const translateX = useMemo(() => position.interpolate({inputRange: [0, 1], outputRange: [0, travel]}), [position, travel]);
  const scale = useMemo(() => emphasis.interpolate({inputRange: [0, 1], outputRange: [1, 1.2]}), [emphasis]);
  const opacity = useMemo(() => emphasis.interpolate({inputRange: [0, 1], outputRange: [.95, 1]}), [emphasis]);
  return <Animated.View pointerEvents="none" style={[styles.thumb, {backgroundColor: color, opacity,
    transform: [{translateX}, {scale}]}]} />;
});

const styles = StyleSheet.create({
  root: {height: 28, marginHorizontal: 4, justifyContent: 'center'},
  track: {marginHorizontal: 12, borderRadius: 3, overflow: 'hidden'},
  fill: {height: '100%', borderRadius: 3},
  thumb: {position: 'absolute', left: 7, top: 9, height: 10, width: 10, borderRadius: 5},
});
