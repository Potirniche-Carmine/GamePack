import {WatchTimeline} from './WatchTimeline';
import React, {useMemo, useState} from 'react';
import {Animated, Image, Pressable, StyleSheet, Text, View} from 'react-native';
import Svg, {Rect} from 'react-native-svg';
import {anchorLabel, anchorStart, timeLabel} from './components';
import {ANNOTATION_COLOR, compareComments} from './playback';
import {useTheme} from './theme';
import {clusterTimelineComments, timelinePosition} from './timeline';
import type {Anchor, Comment, Video} from './types';
import {usePlaybackTimeline} from './usePlaybackTimeline';
import {useVideoThumbnails} from './useVideoThumbnails';

export function ReviewTimeline(props: React.ComponentProps<typeof ReviewFilmstrip>) {
  return props.mode === 'watch'
    ? <WatchTimeline {...props} paused={props.paused ?? true} rate={props.rate ?? 1} seekToken={props.seekToken ?? 0} />
    : <ReviewFilmstrip {...props} />;
}

function ReviewFilmstrip({mode = 'review', paused = true, rate = 1, seekToken = 0, reviewEnd, video, time, duration, comments, draftAnchor, selectedId, disabled, onSelect, onCluster, onSeek}: {
  mode?: 'watch' | 'review'; paused?: boolean; rate?: number; seekToken?: number; reviewEnd?: number;
  video?: Pick<Video, 'path' | 'media_id' | 'width' | 'height'> | null;
  time: number; duration: number; comments: Comment[]; draftAnchor?: Anchor; selectedId: string | null; disabled: boolean;
  onSelect: (comment: Comment) => void; onCluster?: (comments: Comment[]) => void; onSeek: (time: number) => void;
}) {
  const {colors} = useTheme();
  const {width, setWidth, position, slider, canSeek, start, move, finish, cancel} = usePlaybackTimeline({time, duration, paused, rate, seekToken, reviewEnd, disabled, onSeek});
  const [focused, setFocused] = useState<string | null>(null);
  const thumbnails = useVideoThumbnails(video);
  const aspectRatio = video && video.width > 0 && video.height > 0 ? video.width / video.height : 16 / 9;
  const frameWidth = 40 * aspectRatio;
  const frames = useMemo(() => {
    if (!thumbnails.length) return [];
    // Keep every tile at the source ratio. The track clips the final tile
    // instead of stretching the images to divide its width evenly.
    const count = Math.max(1, Math.ceil((width - 24) / (frameWidth + 2)));
    return Array.from({length: count}, (_, index) => thumbnails[Math.min(thumbnails.length - 1, Math.floor((index + 0.5) * thumbnails.length / count))]);
  }, [thumbnails, width, frameWidth]);
  const ordered = useMemo(() => [...comments].sort(compareComments), [comments]);
  const clusters = useMemo(() => clusterTimelineComments(ordered, duration, width), [ordered, duration, width]);

  return <View style={styles.root}>
    <View style={styles.lane} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <View ref={slider} accessible focusable={canSeek} {...{enableFocusRing: false}}
        accessibilityRole="adjustable" accessibilityLabel="Review timeline" accessibilityState={{disabled: disabled || !duration}}
        accessibilityValue={{min: 0, max: Math.round(duration / 1000000), now: Math.round(time / 1000000), text: timeLabel(time)}}
        accessibilityActions={[{name: 'increment', label: 'Forward five seconds'}, {name: 'decrement', label: 'Back five seconds'}]}
        onAccessibilityAction={event => onSeek(Math.max(0, Math.min(duration, time + (event.nativeEvent.actionName === 'increment' ? 5000000 : -5000000))))}
        onFocus={() => setFocused('track')} onBlur={() => setFocused(null)}
        style={[styles.track, {backgroundColor: colors.inset}]}
        onStartShouldSetResponder={() => canSeek} onMoveShouldSetResponder={() => canSeek}
        onResponderGrant={event => start({...event, nativeEvent: {...event.nativeEvent, locationX: event.nativeEvent.locationX + 12}})}
        onResponderMove={move} onResponderTerminationRequest={() => false} onResponderRelease={finish} onResponderTerminate={cancel}>
        {frames.length ? <View pointerEvents="none" style={styles.filmstrip}>{frames.map((uri, index) => <View key={`${index}-${uri}`} style={[styles.frame, {width: frameWidth}]}>
          <Image accessible={false} source={{uri}} resizeMode="contain" fadeDuration={0} style={styles.frameImage} />
        </View>)}</View> : <View pointerEvents="none" style={styles.ticks}>
          {Array.from({length: 31}, (_, i) => <View key={i} style={[styles.tick, {backgroundColor: colors.separator, height: i % 5 ? 8 : 15}]} />)}
        </View>}
        <Svg pointerEvents="none" accessible={false} width="100%" height={40} style={StyleSheet.absoluteFill}>
          <Rect x={.5} y={.5} width={Math.max(0, width - 25)} height={39} rx={7.5} fill="none" stroke={focused === 'track' ? colors.selectedLine : colors.separator} strokeWidth={1} />
        </Svg>
      </View>
      {[...ordered.map(item => ({id: item.comment_id, anchor: item.anchor})), ...(draftAnchor ? [{id: 'draft', anchor: draftAnchor}] : [])].map(item => item.anchor.kind === 'play' && <View key={item.id} pointerEvents="none" style={[styles.playRange, {
        left: timelinePosition(item.anchor.at_us, duration, width), width: Math.max(2, timelinePosition(item.anchor.end_us, duration, width) - timelinePosition(item.anchor.at_us, duration, width)),
        backgroundColor: ANNOTATION_COLOR, opacity: item.id === selectedId || item.id === 'draft' ? .9 : .45,
      }]} />)}
      {clusters.map(cluster => {
        const comment = cluster.comments[0], multiple = cluster.comments.length > 1;
        const selected = cluster.comments.some(item => item.comment_id === selectedId);
        const description = cluster.comments.map(item => `Comment by ${item.name_at_posting} at ${anchorLabel(item.anchor)}: ${item.text || 'Drawing'}`).join('; ');
        return <React.Fragment key={comment.comment_id}>
          {multiple && <View pointerEvents="none" style={[styles.clusterRange, {left: cluster.anchor, width: Math.max(1, cluster.endAnchor - cluster.anchor), backgroundColor: colors.line}]} />}
          <View pointerEvents="none" style={[styles.stem, {left: cluster.anchor, backgroundColor: multiple ? colors.line : ANNOTATION_COLOR}]} />
          <Pressable disabled={disabled} focusable={!disabled} {...{enableFocusRing: false}} accessibilityRole="button"
            accessibilityLabel={multiple ? `${cluster.comments.length} comments. ${description}` : description}
            accessibilityState={{selected, disabled}} onFocus={() => setFocused(comment.comment_id)} onBlur={() => setFocused(null)} onPress={() => {
              if (multiple && onCluster) onCluster(cluster.comments);
              else if (multiple) {
                const next = (cluster.comments.findIndex(item => item.comment_id === selectedId) + 1) % cluster.comments.length;
                onSelect(cluster.comments[next]);
              } else onSelect(comment);
            }}
            style={({pressed}) => [styles.marker, {left: cluster.left, width: cluster.width}, pressed && {opacity: .65}]}>
            <Svg pointerEvents="none" accessible={false} width={cluster.width} height={24} style={StyleSheet.absoluteFill}>
              <Rect x={.75} y={.75} width={Math.max(0, cluster.width - 1.5)} height={22.5} rx={11.25}
                fill={multiple ? (selected ? colors.selected : colors.panel) : ANNOTATION_COLOR}
                stroke={focused === comment.comment_id || selected ? colors.text : multiple ? colors.line : 'transparent'} strokeWidth={1.5} />
            </Svg>
            {multiple ? <Text style={[styles.number, {color: colors.text}]}>{cluster.comments.length}</Text> : <View style={styles.commentDot} />}
          </Pressable>
        </React.Fragment>;
      })}
      <Animated.View pointerEvents="none" style={[styles.playhead, {left: 12, backgroundColor: colors.text, transform: [{translateX: position.interpolate({inputRange: [0, 1], outputRange: [0, Math.max(0, width - 24)]})}]}]} />
    </View>
    <View style={styles.labels}>{Array.from({length: width < 580 ? 4 : 7}, (_, i) => <Text key={i} style={[styles.label, {color: colors.text}]}>{timeLabel(duration * i / (width < 580 ? 3 : 6))}</Text>)}</View>
  </View>;
}
const styles = StyleSheet.create({
  root: {height: 92, paddingTop: 2, paddingHorizontal: 4},
  lane: {height: 68, justifyContent: 'flex-end'},
  track: {height: 40, marginHorizontal: 12, borderRadius: 8, overflow: 'hidden'},
  filmstrip: {...StyleSheet.absoluteFillObject, flexDirection: 'row', gap: 2},
  frame: {flexShrink: 0, height: '100%', overflow: 'hidden', backgroundColor: '#000'},
  frameImage: {width: '100%', height: '100%'},
  ticks: {flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 5},
  tick: {width: 1},
  marker: {position: 'absolute', top: 0, height: 24, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', zIndex: 2},
  playRange: {position: 'absolute', bottom: 0, height: 4, borderRadius: 2},
  clusterRange: {position: 'absolute', bottom: 1, height: 1, opacity: 0.7},
  stem: {position: 'absolute', top: 24, bottom: 0, width: 1, opacity: 0.9},
  commentDot: {width: 5, height: 5, borderRadius: 3, backgroundColor: '#163048'},
  number: {fontSize: 11, lineHeight: 16, textAlign: 'center', includeFontPadding: false, fontVariant: ['tabular-nums'], fontWeight: '700'},
  playhead: {position: 'absolute', top: 28, bottom: 0, width: 2, borderRadius: 1},
  labels: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 6},
  label: {fontSize: 11, lineHeight: 16, fontWeight: '500', fontVariant: ['tabular-nums']},
});
