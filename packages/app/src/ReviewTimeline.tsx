import React, {useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {anchorStart, timeLabel} from './components';
import {commentColorMap} from './playback';
import {useTheme} from './theme';
import type {Comment} from './types';

export function ReviewTimeline({time, duration, comments, selectedId, disabled, onSelect, onSeek}: {
  time: number; duration: number; comments: Comment[]; selectedId: string | null; disabled: boolean;
  onSelect: (comment: Comment) => void; onSeek: (time: number) => void;
}) {
  const {colors, dark} = useTheme();
  const [width, setWidth] = useState(1);
  const ordered = useMemo(() => [...comments].sort((a, b) => anchorStart(a.anchor) - anchorStart(b.anchor) || a.comment_id.localeCompare(b.comment_id)), [comments]);
  const noteColors = useMemo(() => commentColorMap(ordered, dark), [ordered, dark]);
  const position = (us: number) => Math.max(0, Math.min(width - 24, us / (duration || 1) * (width - 24)));
  return <View style={styles.root}>
    <View style={styles.lane} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <Pressable disabled={disabled || !duration} accessible={false} style={[styles.track, {backgroundColor: colors.inset, borderColor: colors.separator}]}
        onPress={event => onSeek(Math.round(Math.min(1, Math.max(0, event.nativeEvent.locationX / width)) * duration))}>
        {Array.from({length: 31}, (_, i) => <View key={i} style={[styles.tick, {backgroundColor: colors.separator, height: i % 5 ? 8 : 15}]} />)}
      </Pressable>
      {ordered.map((comment, index) => <Pressable key={comment.comment_id} disabled={disabled} accessibilityRole="button"
        accessibilityLabel={`Comment ${index + 1} at ${timeLabel(anchorStart(comment.anchor))}: ${comment.text || 'Drawing'}`}
        accessibilityState={{selected: selectedId === comment.comment_id, disabled}} onPress={() => onSelect(comment)}
        style={({pressed}) => [styles.marker, {left: position(anchorStart(comment.anchor)), backgroundColor: noteColors.get(comment.comment_id), borderColor: colors.panel}, pressed && {opacity: .65}, selectedId === comment.comment_id && styles.selected]}>
        <Text style={[styles.number, {color: dark ? '#202022' : '#ffffff'}]}>{index + 1}</Text>
      </Pressable>)}
      <View pointerEvents="none" style={[styles.playhead, {left: position(time) + 11, backgroundColor: colors.text}]} />
    </View>
    <View style={styles.labels}>{Array.from({length: width < 500 ? 4 : 7}, (_, i) => <Text key={i} style={[styles.label, {color: colors.faint}]}>{timeLabel(duration * i / (width < 500 ? 3 : 6))}</Text>)}</View>
  </View>;
}
const styles = StyleSheet.create({
  root: {height: 88, paddingTop: 12, paddingHorizontal: 4},
  lane: {height: 40, justifyContent: 'flex-end'},
  track: {height: 26, borderWidth: 1, borderRadius: 7, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 4},
  tick: {width: 1},
  marker: {position: 'absolute', top: 0, height: 24, width: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 2},
  selected: {transform: [{scale: 1.14}]},
  number: {fontSize: 10, lineHeight: 14, fontWeight: '700', color: '#ffffff'},
  playhead: {position: 'absolute', top: 22, bottom: -3, width: 1.5},
  labels: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 9},
  label: {fontSize: 10, fontVariant: ['tabular-nums']},
});
