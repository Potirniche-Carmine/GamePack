import React, {createContext, forwardRef, useContext, useState, useEffect, useRef, type ReactNode} from 'react';
import {Platform, Text, TextInput, View, StyleSheet, type TextInputProps, type TextStyle, type StyleProp, type ViewStyle, type GestureResponderEvent} from 'react-native';
import type {Anchor, Comment} from './types';
import {Icon, type IconName} from './Icon';
import {useTheme} from './theme';
import {binding, shortcutLabel, type Keybindings} from './shortcuts';
import {MotionPressable} from './motion';

export const ShortcutContext = createContext<Keybindings>({});

export function Button({children, onPress, disabled, active, primary, compact, label, style, icon, danger, expanded, shortcut, quiet, autoFocus}: {
  children?: ReactNode; icon?: IconName; danger?: boolean; expanded?: boolean; onPress?: () => void; disabled?: boolean; active?: boolean;
  primary?: boolean; compact?: boolean; label?: string; style?: StyleProp<ViewStyle>; shortcut?: string; quiet?: boolean; autoFocus?: boolean;
}) {
  const {styles: s, colors} = useTheme();
  const target = useRef<View>(null);
  useEffect(() => { if (autoFocus && !disabled) { const frame = requestAnimationFrame(() => target.current?.focus()); return () => cancelAnimationFrame(frame); } }, [autoFocus, disabled]);
  const bindings = useContext(ShortcutContext);
  const chord = shortcut ? binding(shortcut, bindings) : null;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return <MotionPressable ref={target} focusable={!disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={chord ? shortcutLabel(chord, Platform.OS === 'macos') : undefined} accessibilityState={{disabled: !!disabled, selected: !!active, expanded}}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    disabled={disabled} onPress={onPress} style={({pressed}) => [s.button, compact && s.buttonCompact, quiet && s.buttonQuiet,
      hovered && !disabled && s.buttonHover, primary && s.buttonPrimary, active && s.buttonActive, danger && s.buttonDanger, pressed && !disabled && !primary && {backgroundColor: colors.inset},
      disabled && s.buttonDisabled, style, focused && s.focusRing]}>
    {!!icon && <Icon name={icon} color={disabled ? colors.faint : danger ? colors.danger : primary ? colors.primaryText : active ? colors.accentText : colors.text} />}
    {children !== undefined && <Text numberOfLines={1} style={[s.buttonText, primary && s.buttonPrimaryText, active && s.accentText, danger && {color: colors.danger}, disabled && s.disabledText]}>{children}</Text>}
  </MotionPressable>;
}

const textStyleKeys = new Set(['color', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'fontVariant', 'letterSpacing', 'lineHeight', 'textAlign', 'textDecorationLine', 'textDecorationStyle', 'textDecorationColor', 'textTransform', 'writingDirection', 'includeFontPadding', 'textAlignVertical']);

/** Keep the native editor inside an app-owned field; macOS draws no blue bezel. */
export const TextField = forwardRef<TextInput, TextInputProps & {inputStyle?: StyleProp<TextStyle>}>(function TextField({style, inputStyle, onFocus, onBlur, multiline, editable, ...props}, ref) {
  const {colors} = useTheme();
  const [focused, setFocused] = useState(false);
  const flat = StyleSheet.flatten(style) || {};
  const outer: Record<string, unknown> = {};
  const text: Record<string, unknown> = {};
  Object.entries(flat).forEach(([key, value]) => { (textStyleKeys.has(key) ? text : outer)[key] = value; });
  const focusProps = Platform.OS === 'macos' ? {enableFocusRing: false} : {};
  return <View style={[{minHeight: 40, borderWidth: 1, borderColor: colors.line, borderRadius: 9, backgroundColor: colors.input,
    paddingHorizontal: 12, justifyContent: multiline ? 'flex-start' : 'center'}, outer,
    focused && {borderColor: colors.selectedLine}]}>
    <TextInput {...props} {...focusProps} ref={ref} editable={editable} multiline={multiline}
      placeholderTextColor={props.placeholderTextColor ?? colors.faint}
      onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }}
      style={[{color: colors.text, fontSize: 14, padding: 0, margin: 0, borderWidth: 0, backgroundColor: 'transparent',
        minHeight: multiline ? 64 : 20, flexShrink: 1, textAlignVertical: multiline ? 'top' : 'center'}, text, inputStyle]} />
  </View>;
});
export const AppTextInput = TextField;

export function Empty({title, children, action}: {title?: string; children?: ReactNode; action?: ReactNode}) {
  const {styles: s} = useTheme();
  return <View style={s.empty}>{!!title && <Text style={s.emptyTitle}>{title}</Text>}
    {!!children && <Text style={s.emptyBody}>{children}</Text>}{action}</View>;
}

// Core React Native Modal has no macOS host. Keep dialogs in the native view
// hierarchy so the same content works on both desktop platforms.
export function Dialog({visible, children, onDismiss}: {visible: boolean; children: ReactNode; onDismiss: () => void}) {
  const {styles: s} = useTheme();
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
  const {colors} = useTheme();
  const [width, setWidth] = useState(1);
  const seek = (event: GestureResponderEvent) => onSeek(Math.round(Math.max(0, Math.min(1, event.nativeEvent.locationX / width)) * duration));
  return <View style={local.timeline} onLayout={event => setWidth(Math.max(1, event.nativeEvent.layout.width))}
    accessible accessibilityRole="adjustable" accessibilityLabel="Video position"
    accessibilityValue={{min: 0, max: Math.round(duration / 1000000), now: Math.round(time / 1000000), text: timeLabel(time)}}
    accessibilityActions={[{name: 'increment', label: 'Forward five seconds'}, {name: 'decrement', label: 'Back five seconds'}]}
    onAccessibilityAction={event => onSeek(Math.min(duration, Math.max(0, time + (event.nativeEvent.actionName === 'increment' ? 5000000 : -5000000))))}
    onStartShouldSetResponder={() => duration > 0} onMoveShouldSetResponder={() => duration > 0}
    onResponderGrant={seek} onResponderMove={seek}>
    <View pointerEvents="none" style={[local.track, {backgroundColor: colors.line}]}><View style={[local.progress, {backgroundColor: colors.accentText, width: `${Math.max(0, Math.min(100, time / (duration || 1) * 100))}%`}]} /></View>
    {comments.map(comment => <View pointerEvents="none" key={comment.comment_id} style={[local.marker,
      {backgroundColor: colors.faint, left: `${Math.min(100, anchorStart(comment.anchor) / (duration || 1) * 100)}%`}, comment.comment_id === selectedId && {backgroundColor: colors.accentText}]} />)}
    <View pointerEvents="none" style={[local.thumb, {backgroundColor: colors.text, left: `${Math.max(0, Math.min(100, time / (duration || 1) * 100))}%`}]} />
  </View>;
}

const local = StyleSheet.create({
  timeline: {height: 30, justifyContent: 'center', marginHorizontal: 8},
  track: {height: 4, borderRadius: 2, overflow: 'hidden'},
  progress: {height: 4},
  thumb: {position: 'absolute', width: 10, height: 10, marginLeft: -5, borderRadius: 5},
  marker: {position: 'absolute', width: 4, height: 4, top: 24, marginLeft: -2, borderRadius: 2},
});
