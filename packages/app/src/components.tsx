import React, {useState, type ReactNode} from 'react';
import {Platform, Pressable, Text, View, StyleSheet, type StyleProp, type ViewStyle, type GestureResponderEvent} from 'react-native';
import type {Anchor, Comment} from './types';
import {colors, styles as s} from './styles';

export function Button({children, onPress, disabled, active, primary, compact, label, style}: {
  children: ReactNode; onPress?: () => void; disabled?: boolean; active?: boolean;
  primary?: boolean; compact?: boolean; label?: string; style?: StyleProp<ViewStyle>;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled: !!disabled, selected: !!active}}
    disabled={disabled} onPress={onPress} style={({pressed}) => [s.button, compact && s.buttonCompact,
      primary && s.buttonPrimary, active && s.buttonActive, pressed && !disabled && s.buttonPressed,
      disabled && s.buttonDisabled, style]}>
    <Text style={[s.buttonText, primary && s.buttonPrimaryText, active && s.accentText, disabled && s.disabledText]}>{children}</Text>
  </Pressable>;
}

export function Empty({title, children, action}: {title: string; children: ReactNode; action?: ReactNode}) {
  return <View style={s.empty}><View style={s.emptyIcon}><Text style={s.emptyIconText}>▷</Text></View>
    <Text style={s.emptyTitle}>{title}</Text><Text style={s.emptyBody}>{children}</Text>{action}</View>;
}

// Core React Native Modal has no macOS host. Keep dialogs in the native view
// hierarchy so the same content works on both desktop platforms.
export function Dialog({visible, children, onDismiss}: {visible: boolean; children: ReactNode; onDismiss: () => void}) {
  if (!visible) return null;
  const keyboardProps = Platform.OS === 'macos' ? {
    keyDownEvents: [{key: 'Escape'}],
    onKeyDown: (event: {nativeEvent: {key: string}}) => { if (event.nativeEvent.key === 'Escape') onDismiss(); },
  } : {};
  return <View {...keyboardProps} style={s.modalBackdrop} accessibilityViewIsModal onAccessibilityEscape={onDismiss}>
    <View style={s.modal}>{children}</View>
  </View>;
}

export function timeLabel(us: number, milliseconds = false): string {
  const value = Math.max(0, Math.round(us || 0));
  const seconds = Math.floor(value / 1000000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const rest = seconds % 60;
  const base = `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return milliseconds ? `${base}.${String(Math.floor(value % 1000000 / 1000)).padStart(3, '0')}` : base;
}
export function parseTime(text: string): number | null {
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,6})?$/.test(text.trim())) return null;
  const parts = text.trim().split(':').map(Number);
  if (parts.length > 1 && parts.slice(1).some(n => n >= 60)) return null;
  const seconds = parts.reduce((sum, n) => sum * 60 + n, 0);
  return Number.isFinite(seconds) && seconds <= Number.MAX_SAFE_INTEGER / 1000000 ? Math.round(seconds * 1000000) : null;
}
export function anchorLabel(anchor: Anchor): string {
  return anchor.kind === 'point' ? timeLabel(anchor.at_us) : `${timeLabel(anchor.start_us)} – ${timeLabel(anchor.end_us)}`;
}
export function anchorStart(anchor: Anchor): number { return anchor.kind === 'point' ? anchor.at_us : anchor.start_us; }
export function bytesLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function Timeline({time, duration, comments, selectedId, onSeek}: {
  time: number; duration: number; comments: Comment[]; selectedId: string | null; onSeek: (time: number) => void;
}) {
  const [width, setWidth] = useState(1);
  const seek = (event: GestureResponderEvent) => onSeek(Math.round(Math.max(0, Math.min(1, event.nativeEvent.locationX / width)) * duration));
  return <View style={local.timeline} onLayout={event => setWidth(Math.max(1, event.nativeEvent.layout.width))}
    accessible accessibilityRole="adjustable" accessibilityLabel="Video position"
    accessibilityValue={{min: 0, max: Math.round(duration / 1000000), now: Math.round(time / 1000000), text: timeLabel(time)}}
    accessibilityActions={[{name: 'increment', label: 'Forward five seconds'}, {name: 'decrement', label: 'Back five seconds'}]}
    onAccessibilityAction={event => onSeek(Math.min(duration, Math.max(0, time + (event.nativeEvent.actionName === 'increment' ? 5000000 : -5000000))))}
    onStartShouldSetResponder={() => duration > 0} onMoveShouldSetResponder={() => duration > 0}
    onResponderGrant={seek} onResponderMove={seek}>
    <View pointerEvents="none" style={local.track}><View style={[local.progress, {width: `${Math.max(0, Math.min(100, time / (duration || 1) * 100))}%`}]} /></View>
    {comments.map(comment => <View pointerEvents="none" key={comment.comment_id} style={[local.marker,
      {left: `${Math.min(100, anchorStart(comment.anchor) / (duration || 1) * 100)}%`}, comment.comment_id === selectedId && local.markerSelected]} />)}
    <View pointerEvents="none" style={[local.thumb, {left: `${Math.max(0, Math.min(100, time / (duration || 1) * 100))}%`}]} />
  </View>;
}

const local = StyleSheet.create({
  timeline: {height: 30, justifyContent: 'center', marginHorizontal: 8},
  track: {height: 4, backgroundColor: '#484b52', borderRadius: 2, overflow: 'hidden'},
  progress: {height: 4, backgroundColor: colors.accent},
  thumb: {position: 'absolute', width: 10, height: 10, marginLeft: -5, borderRadius: 5, backgroundColor: '#fff'},
  marker: {position: 'absolute', width: 4, height: 4, top: 24, marginLeft: -2, borderRadius: 2, backgroundColor: '#7e8490'},
  markerSelected: {backgroundColor: colors.accent, height: 5, width: 5},
});
