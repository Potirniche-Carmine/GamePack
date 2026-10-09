import React, {useMemo, useState} from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {anchorStart, timeLabel} from './components';
import {commentColorMap} from './playback';
import {useTheme} from './theme';
import {clusterTimelineComments, timelinePosition} from './timeline';
import type {Comment, Video} from './types';
import {useVideoThumbnails} from './useVideoThumbnails';

export function ReviewTimeline({video, time, duration, comments, selectedId, disabled, onSelect, onCluster, onSeek}: {
  video?: Pick<Video, 'path' | 'media_id'> | null;
  time: number; duration: number; comments: Comment[]; selectedId: string | null; disabled: boolean;
  onSelect: (comment: Comment) => void; onCluster?: (comments: Comment[]) => void; onSeek: (time: number) => void;
}) {
  const {colors, dark} = useTheme();
  const [width, setWidth] = useState(1);
  const [focused, setFocused] = useState<string | null>(null);
  const thumbnails = useVideoThumbnails(video);
  const frames = useMemo(() => {
    const count = Math.min(thumbnails.length, Math.max(4, Math.floor((width - 24) / 72)));
    return Array.from({length: count}, (_, index) => thumbnails[Math.min(thumbnails.length - 1, Math.floor((index + 0.5) * thumbnails.length / count))]);
  }, [thumbnails, width]);
  const ordered = useMemo(() => [...comments].sort((a, b) => anchorStart(a.anchor) - anchorStart(b.anchor) || a.comment_id.localeCompare(b.comment_id)), [comments]);
  const noteColors = useMemo(() => commentColorMap(ordered, dark), [ordered, dark]);
  const clusters = useMemo(() => clusterTimelineComments(ordered, duration, width), [ordered, duration, width]);
  return <View style={styles.root}>
    <View style={styles.lane} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <Pressable disabled={disabled || !duration} focusable={!disabled && duration > 0} {...{enableFocusRing: false}}
        accessibilityRole="adjustable" accessibilityLabel="Review timeline" accessibilityState={{disabled: disabled || !duration}}
        accessibilityValue={{min: 0, max: Math.round(duration / 1000000), now: Math.round(time / 1000000), text: timeLabel(time)}}
        accessibilityActions={[{name: 'increment', label: 'Forward five seconds'}, {name: 'decrement', label: 'Back five seconds'}]}
        onAccessibilityAction={event => onSeek(Math.max(0, Math.min(duration, time + (event.nativeEvent.actionName === 'increment' ? 5000000 : -5000000))))}
        onFocus={() => setFocused('track')} onBlur={() => setFocused(null)}
        style={[styles.track, {backgroundColor: colors.inset, borderColor: focused === 'track' ? colors.selectedLine : colors.separator}]}
        onPress={event => onSeek(Math.round(Math.min(1, Math.max(0, event.nativeEvent.locationX / Math.max(1, width - 24))) * duration))}>
        {frames.length ? <View pointerEvents="none" style={styles.filmstrip}>{frames.map((uri, index) => <View key={`${index}-${uri}`} style={styles.frame}>
          <Image accessible={false} source={{uri}} resizeMode="cover" fadeDuration={0} style={styles.frameImage} />
        </View>)}</View> : <View pointerEvents="none" style={styles.ticks}>
          {Array.from({length: 31}, (_, i) => <View key={i} style={[styles.tick, {backgroundColor: colors.separator, height: i % 5 ? 8 : 15}]} />)}
        </View>}
      </Pressable>
      {clusters.map(cluster => {
        const comment = cluster.comments[0], multiple = cluster.comments.length > 1;
        const selected = cluster.comments.some(item => item.comment_id === selectedId);
        const description = cluster.comments.map((item, index) => `Comment ${cluster.firstNumber + index} by ${item.name_at_posting} at ${timeLabel(anchorStart(item.anchor))}: ${item.text || 'Drawing'}`).join('; ');
        return <React.Fragment key={comment.comment_id}>
          {multiple && <View pointerEvents="none" style={[styles.clusterRange, {left: cluster.anchor, width: Math.max(1, cluster.endAnchor - cluster.anchor), backgroundColor: colors.line}]} />}
          <View pointerEvents="none" style={[styles.stem, {left: cluster.anchor, backgroundColor: multiple ? colors.line : noteColors.get(comment.comment_id)}]} />
          <Pressable disabled={disabled} focusable={!disabled} {...{enableFocusRing: false}} accessibilityRole="button"
            accessibilityLabel={multiple ? `${cluster.comments.length} comments. ${description}` : description}
            accessibilityState={{selected, disabled}} onFocus={() => setFocused(comment.comment_id)} onBlur={() => setFocused(null)} onPress={() => {
              if (multiple && onCluster) onCluster(cluster.comments);
              else if (multiple) {
                const next = (cluster.comments.findIndex(item => item.comment_id === selectedId) + 1) % cluster.comments.length;
                onSelect(cluster.comments[next]);
              } else onSelect(comment);
            }}
            style={({pressed}) => [styles.marker, {left: cluster.left, width: cluster.width,
              backgroundColor: multiple ? (selected ? colors.selected : colors.panel) : noteColors.get(comment.comment_id),
              borderColor: focused === comment.comment_id ? colors.text : multiple ? (selected ? colors.selectedLine : colors.line) : colors.panel},
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
  root: {height: 112, paddingTop: 8, paddingHorizontal: 4},
  lane: {height: 76, justifyContent: 'flex-end'},
  track: {height: 52, marginHorizontal: 12, borderWidth: 1, borderRadius: 7, overflow: 'hidden'},
  filmstrip: {...StyleSheet.absoluteFillObject, flexDirection: 'row', gap: 2},
  frame: {flex: 1, minWidth: 0, height: '100%', borderRadius: 4, overflow: 'hidden'},
  frameImage: {width: '100%', height: '100%'},
  ticks: {flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 5},
  tick: {width: 1},
  marker: {position: 'absolute', top: 0, height: 24, width: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 2},
  cluster: {borderWidth: 1, flexDirection: 'row', gap: 4},
  clusterRange: {position: 'absolute', top: 73, height: 1, opacity: 0.7},
  stem: {position: 'absolute', top: 23, height: 52, width: 1, opacity: 0.9},
  selected: {transform: [{scale: 1.14}]},
  number: {fontSize: 10, lineHeight: 14, fontWeight: '700', color: '#ffffff'},
  extra: {fontSize: 9, lineHeight: 14, fontWeight: '500'},
  playhead: {position: 'absolute', top: 24, bottom: -1, width: 2},
  labels: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 9},
  label: {fontSize: 11, lineHeight: 14, fontVariant: ['tabular-nums']},
});
