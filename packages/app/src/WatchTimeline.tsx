import React from 'react';
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
  const travel = Math.max(0, width - 24);
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
      <Animated.View style={[styles.fill, {width: travel, backgroundColor: colors.text,
        transform: [{translateX: position.interpolate({inputRange: [0, 1], outputRange: [-travel, 0]})}]}]} />
    </View>
    <Animated.View pointerEvents="none" style={[styles.thumb, {backgroundColor: colors.text, opacity: emphasized ? 1 : .95,
      transform: [{translateX: position.interpolate({inputRange: [0, 1], outputRange: [0, travel]})}, {scale: emphasized ? 1.2 : 1}]}]} />
  </View>;
}

const styles = StyleSheet.create({
  root: {height: 28, marginHorizontal: 4, justifyContent: 'center'},
  track: {marginHorizontal: 12, borderRadius: 3, overflow: 'hidden'},
  fill: {height: '100%', borderRadius: 3},
  thumb: {position: 'absolute', left: 7, top: 9, height: 10, width: 10, borderRadius: 5},
});
