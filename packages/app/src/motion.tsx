import React, {forwardRef, useRef, useState, useSyncExternalStore} from 'react';
import {AccessibilityInfo, Animated, Easing, Platform, Pressable, type GestureResponderEvent, type PressableProps, type View} from 'react-native';

export const easeOut = Easing.bezier(0.23, 1, 0.32, 1);

let reducedMotion = true;
const listeners = new Set<() => void>();
let subscription: ReturnType<typeof AccessibilityInfo.addEventListener> | undefined;
function updateReducedMotion(value: boolean) {
  reducedMotion = value;
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!subscription) {
    subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', updateReducedMotion);
    void AccessibilityInfo.isReduceMotionEnabled().then(updateReducedMotion).catch(() => {});
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { subscription?.remove(); subscription = undefined; }
  };
}
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, () => reducedMotion, () => true);
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pointer feedback starts on down; keyboard activations never wait for motion. */
export const MotionPressable = forwardRef<View, PressableProps>(function MotionPressable({style, onPressIn, onPressOut, ...props}, ref) {
  const reduce = useReducedMotion();
  const [pressed, setPressedState] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const keyboardPress = useRef(false);
  const setPressed = (pressed: boolean, event: GestureResponderEvent) => {
    setPressedState(pressed);
    if (pressed) keyboardPress.current = 'key' in event.nativeEvent;
    progress.stopAnimation();
    if (keyboardPress.current || props.disabled) { progress.setValue(0); return; }
    Animated.timing(progress, {toValue: pressed ? 1 : 0, duration: pressed ? 100 : 160, easing: easeOut, useNativeDriver: true}).start();
  };
  const focusProps = Platform.OS === 'macos' ? {enableFocusRing: false} : {};
  return <AnimatedPressable {...props} {...focusProps} ref={ref}
    onPressIn={event => { setPressed(true, event); onPressIn?.(event); }}
    onPressOut={event => { setPressed(false, event); onPressOut?.(event); }}
    style={[typeof style === 'function' ? style({pressed}) : style,
      props.disabled ? undefined : reduce ? {opacity: progress.interpolate({inputRange: [0, 1], outputRange: [1, 0.84]})}
        : {transform: [{scale: progress.interpolate({inputRange: [0, 1], outputRange: [1, 0.97]})}]}]} />;
});
