import {useEffect, useRef, useState} from 'react';
import {Animated, Easing, View, type GestureResponderEvent} from 'react-native';
import {timelineMotion, timelineSeekTime, type TimelineSample} from './timeline';

export type PlaybackTimelineProps = {
  time: number; duration: number; paused: boolean; rate: number; seekToken: number;
  disabled: boolean; onSeek: (time: number) => void;
};

/** Interpolate only the presentation; native playback remains the source of truth. */
export function usePlaybackTimeline({time, duration, paused, rate, seekToken, disabled, onSeek}: PlaybackTimelineProps) {
  const [width, setWidth] = useState(1);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const position = useRef(new Animated.Value(0)).current;
  const lastSeek = useRef(0);
  const lastTarget = useRef<number | null>(null);
  const slider = useRef<View>(null);
  const drag = useRef<{pageX: number; locationX: number; time: number} | null>(null);
  const previous = useRef<TimelineSample | null>(null);
  const canSeek = !disabled && duration > 0;
  const progress = (value: number) => Math.max(0, Math.min(1, value / Math.max(1, duration)));
  useEffect(() => {
    const sample = {time, duration, paused, rate, seekToken};
    const motion = timelineMotion(previous.current, sample);
    previous.current = sample;
    if (drag.current) return;
    position.stopAnimation();
    if (motion.kind === 'snap') position.setValue(progress(time));
    if (motion.kind === 'animate' || (motion.kind === 'snap' && !paused)) {
      // A bounded prediction stops if native playback stalls. No free-running
      // JS timer can carry the thumb beyond the last confirmed frame.
      Animated.timing(position, {toValue: progress(motion.kind === 'animate' ? motion.time : time + rate * 140000), duration: motion.kind === 'animate' ? motion.duration : 140,
        easing: paused ? Easing.out(Easing.quad) : Easing.linear, useNativeDriver: true, isInteraction: false}).start();
    }
    return () => position.stopAnimation();
  }, [time, duration, paused, rate, seekToken, position, scrubbing]);
  const updateDrag = (event: GestureResponderEvent) => {
    const current = drag.current;
    if (!current) return;
    const x = current.locationX + event.nativeEvent.pageX - current.pageX;
    current.time = timelineSeekTime(x, duration, width);
    position.setValue(progress(current.time));
    if (current.time !== lastTarget.current && Date.now() - lastSeek.current >= 64) {
      lastSeek.current = Date.now(); lastTarget.current = current.time; onSeek(current.time);
    }
  };
  return {width, setWidth, focused, setFocused, hovered, setHovered, scrubbing, position, slider, canSeek,
    start: (event: GestureResponderEvent) => {
      slider.current?.focus(); position.stopAnimation();
      drag.current = {pageX: event.nativeEvent.pageX, locationX: event.nativeEvent.locationX, time};
      lastSeek.current = 0; lastTarget.current = paused ? time : null; setScrubbing(true); updateDrag(event);
    },
    move: updateDrag,
    finish: (event: GestureResponderEvent) => {
      updateDrag(event); const target = drag.current?.time;
      drag.current = null; setScrubbing(false); if (target !== undefined && target !== lastTarget.current) onSeek(target);
    },
    cancel: () => { drag.current = null; setScrubbing(false); position.setValue(progress(time)); },
  };
}
