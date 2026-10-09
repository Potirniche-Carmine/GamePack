import React, {useEffect, useRef, useState} from 'react';
import {AccessibilityInfo, Animated, Easing, StyleSheet, View} from 'react-native';

/** A temporary presentation pointer; it never becomes a saved drawing. */
export function PointerPulse({point}: {point: {x: number; y: number; token: number} | null}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!point) return;
    progress.stopAnimation(); progress.setValue(0); setVisible(true);
    const animation = Animated.timing(progress, {toValue: 1, duration: reducedMotion ? 400 : 800, easing: Easing.out(Easing.cubic), useNativeDriver: true});
    animation.start(({finished}) => { if (finished) setVisible(false); });
    return () => animation.stop();
  }, [point, progress, reducedMotion]);
  if (!point || !visible) return null;
  return <View pointerEvents="none" style={[s.origin, {left: `${point.x * 100}%`, top: `${point.y * 100}%`}]}>
    <Animated.View style={[s.ring, {opacity: progress.interpolate({inputRange: [0, 1], outputRange: [0.9, 0]}), transform: [{scale: reducedMotion ? 1 : progress.interpolate({inputRange: [0, 1], outputRange: [0.5, 2.1]})}]}]} />
    <Animated.View style={[s.dot, {opacity: progress.interpolate({inputRange: [0, 0.65, 1], outputRange: [1, 1, 0]})}]} />
  </View>;
}
const s = StyleSheet.create({
  origin: {position: 'absolute', width: 0, height: 0},
  ring: {position: 'absolute', left: -15, top: -15, width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: '#79BFFD44'},
  dot: {position: 'absolute', left: -5, top: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: '#79BFFD', borderWidth: 2, borderColor: '#FFFFFF'},
});
