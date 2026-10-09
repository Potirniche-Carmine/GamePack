import React, {useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {anchorStart, timeLabel} from './components';
import {commentColorMap} from './playback';
import {useTheme} from './theme';
import {clusterTimelineComments, timelinePosition} from './timeline';
import type {Comment} from './types';

export function ReviewTimeline({time, duration, comments, selectedId, disabled, onSelect, onCluster, onSeek}: {
  time: number; duration: number; comments: Comment[]; selectedId: string | null; disabled: boolean;
  onSelect: (comment: Comment) => void; onCluster?: (comments: Comment[]) => void; onSeek: (time: number) => void;
}) {
  const {colors, dark} = useTheme();
  const [width, setWidth] = useState(1);
  const ordered = useMemo(() => [...comments].sort((a, b) => anchorStart(a.anchor) - anchorStart(b.anchor) || a.comment_id.localeCompare(b.comment_id)), [comments]);
  const noteColors = useMemo(() => commentColorMap(ordered, dark), [ordered, dark]);
  const clusters = useMemo(() => clusterTimelineComments(ordered, duration, width), [ordered, duration, width]);
  return <View style={styles.root}>
    <View style={styles.lane} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <Pressable disabled={disabled || !duration} accessible={false} style={[styles.track, {backgroundColor: colors.inset, borderColor: colors.separator}]}
        onPress={event => onSeek(Math.round(Math.min(1, Math.max(0, event.nativeEvent.locationX / width)) * duration))}>
        {Array.from({length: 31}, (_, i) => <View key={i} style={[styles.tick, {backgroundColor: colors.separator, height: i % 5 ? 8 : 15}]} />)}
      </Pressable>
      {clusters.map(cluster => {
        const comment = cluster.comments[0], multiple = cluster.comments.length > 1;
        const selected = cluster.comments.some(item => item.comment_id === selectedId);
        const description = cluster.comments.map((item, index) => `Comment ${cluster.firstNumber + index} by ${item.name_at_posting} at ${timeLabel(anchorStart(item.anchor))}: ${item.text || 'Drawing'}`).join('; ');
        return <React.Fragment key={comment.comment_id}>
          {multiple && <View pointerEvents="none" style={[styles.clusterRange, {left: cluster.anchor, width: Math.max(1, cluster.endAnchor - cluster.anchor), backgroundColor: colors.line}]} />}
          <View pointerEvents="none" style={[styles.stem, {left: cluster.anchor, backgroundColor: multiple ? colors.line : noteColors.get(comment.comment_id)}]} />
          <Pressable disabled={disabled} accessibilityRole="button"
            accessibilityLabel={multiple ? `${cluster.comments.length} comments. ${description}` : description}
            accessibilityState={{selected, disabled}} onPress={() => {
              if (multiple && onCluster) onCluster(cluster.comments);
              else if (multiple) {
                const next = (cluster.comments.findIndex(item => item.comment_id === selectedId) + 1) % cluster.comments.length;
                onSelect(cluster.comments[next]);
              } else onSelect(comment);
            }}
            style={({pressed}) => [styles.marker, {left: cluster.left, width: cluster.width,
              backgroundColor: multiple ? (selected ? colors.selected : colors.panel) : noteColors.get(comment.comment_id),
              borderColor: multiple ? (selected ? colors.selectedLine : colors.line) : colors.panel},
              multiple && styles.cluster, pressed && {opacity: .65}, selected && !multiple && styles.selected]}>
            <Text style={[styles.number, {color: multiple ? colors.text : dark ? '#202022' : '#ffffff'}]}>{cluster.firstNumber}</Text>
            {multiple && <Text style={[styles.extra, {color: colors.muted}]}>+{cluster.comments.length - 1}</Text>}
          </Pressable>
        </React.Fragment>;
      })}
      <View pointerEvents="none" style={[styles.playhead, {left: timelinePosition(time, duration, width), backgroundColor: colors.text}]} />
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
  cluster: {borderWidth: 1, flexDirection: 'row', gap: 4},
  clusterRange: {position: 'absolute', top: 31, height: 1, opacity: 0.5},
  stem: {position: 'absolute', top: 23, height: 9, width: 1, opacity: 0.7},
  selected: {transform: [{scale: 1.14}]},
  number: {fontSize: 10, lineHeight: 14, fontWeight: '700', color: '#ffffff'},
  extra: {fontSize: 9, lineHeight: 14, fontWeight: '500'},
  playhead: {position: 'absolute', top: 22, bottom: -3, width: 1.5},
  labels: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 9},
  label: {fontSize: 10, fontVariant: ['tabular-nums']},
});
