import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Animated, Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Avatar} from './Avatar';
import {anchorLabel, Button, timeLabel} from './components';
import {conversationRoot, discussionReplies} from './discussion';
import {Glass} from './Glass';
import {ANNOTATION_COLOR} from './playback';
import {conversationPlacement, reviewViewport} from './spatial';
import {PlaybackDock} from './PlaybackDock';
import {useReducedMotion} from './motion';
import {conversationNumbers} from './presentation';
import {useTheme} from './theme';
import {useVideoThumbnails} from './useVideoThumbnails';
import type {Comment, Draft, Video} from './types';


type Props = {
  video: Video; time: number; duration: number; paused: boolean; reviewMode: 'watch' | 'review';
  activityToken: number; sceneReady: boolean; comments: Comment[]; notes: Comment[]; selectedId: string | null; draft: Draft | null; expanded: ReadonlySet<string>;
  disabled: boolean; header: ReactNode; composer: ReactNode; toolbar: ReactNode; toolbarAccessory: ReactNode; timeline: ReactNode; popover: ReactNode; children: ReactNode;
  rate: number; zoom: number; presenting: boolean; popoverKind: 'speed' | 'zoom';
  onMode: (mode: 'watch' | 'review') => void; onSelect: (note: Comment) => void; onReply: (note: Comment) => void;
  onExpand: (note: Comment) => void; onReplay: (note: Comment) => void;
  onPlay: () => void; onSpeed: () => void; onZoom: () => void; onPresent: () => void;
};

export function ReviewWorkspace(props: Props) {
  const {video, time, duration, notes, comments, draft, disabled, composer} = props;
  const {colors, dark} = useTheme();
  const [area, setArea] = useState({width: 1, height: 1});
  const [menuAnchors, setMenuAnchors] = useState({speed: 0, zoom: 0});
  const reviewing = props.reviewMode === 'review';
  const rect = reviewViewport(area, video.width && video.height ? video : {width: 16, height: 9}, reviewing, props.presenting);
  const reduce = useReducedMotion();
  const [idle, setIdle] = useState(false);
  const [overControls, setOverControls] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opacity = useRef(new Animated.Value(1)).current;
  const autoHide = props.presenting && !reviewing && !props.paused && !props.popover && !disabled && !overControls;
  const wake = () => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (autoHide) idleTimer.current = setTimeout(() => setIdle(true), 2400);
  };
  useEffect(() => {
    wake();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [autoHide, props.activityToken]);
  const hidden = autoHide && idle;
  useEffect(() => {
    Animated.timing(opacity, {toValue: hidden ? 0 : 1, duration: reduce ? 0 : hidden ? 180 : 100, useNativeDriver: true, isInteraction: false}).start();
  }, [hidden, reduce, opacity]);
  const thumbnails = useVideoThumbnails(video);
  const ambient = thumbnails[Math.min(thumbnails.length - 1, Math.floor(time / Math.max(1, duration) * thumbnails.length))];
  const numbers = useMemo(() => conversationNumbers(notes), [notes]);
  const visibleDraft = reviewing && composer && draft && (draft.parent_comment_id || draft.drawings.length) ? draft : null;
  const replyingTo = draft?.parent_comment_id ? conversationRoot(comments, draft.parent_comment_id) : null;
  const visibleNotes = replyingTo ? notes.filter(note => note.comment_id === replyingTo.comment_id) : notes;
  const placement = conversationPlacement(area, props.presenting);
  return <View onTouchStart={wake} onPointerMove={wake} style={styles.workspace} onLayout={event => setArea(event.nativeEvent.layout)}>
    {!!ambient && <AmbientVideo key={video.id} uri={ambient} />}
    <View pointerEvents="box-none" style={styles.stage}>
      <View style={[styles.video, {position: 'absolute', left: rect.x, top: rect.y, width: Math.max(1, rect.width), height: Math.max(1, rect.height)}]}>
        {props.children}
      </View>
    </View>
    {!props.presenting && <Glass style={styles.header}>{props.header}</Glass>}
    {reviewing && <View pointerEvents="box-none" style={[styles.toolRail, {top: props.presenting ? 16 : 76}]}>
      <View pointerEvents="box-none" style={styles.toolRow}>
        <Glass style={styles.tools}>{props.toolbar}</Glass>
        {!!props.toolbarAccessory && <View style={styles.toolAccessory}>{props.toolbarAccessory}</View>}
      </View>
    </View>}
    {reviewing && ((props.sceneReady && !!visibleNotes.length) || !!visibleDraft) && <View style={[styles.conversations, placement]}>
      <NoteColumn {...props} notes={props.sceneReady ? visibleNotes : []} draft={visibleDraft} numbers={numbers} composer={visibleDraft ? composer : null} />
    </View>}
    <PlaybackDock available={area.width} duration={duration} reviewing={reviewing} disabled={disabled} hidden={hidden} opacity={opacity}
      onInteractionChange={setOverControls} popover={props.popover} popoverCenter={menuAnchors[props.popoverKind]}>
      <View style={styles.transport}>
        <Button compact quiet shortcut="play" label={props.paused ? 'Play video' : 'Pause video'} icon={props.paused ? 'play' : 'pause'} disabled={disabled} onPress={props.onPlay} />
        <Text style={[styles.time, {color: colors.text}]}>{timeLabel(time)}<Text style={{color: colors.muted}}> / {timeLabel(duration)}</Text></Text>
        <View style={styles.transportSpace} />
        <View style={[styles.mode, {backgroundColor: dark ? '#00000028' : '#ffffff40'}]}>
          {(['watch', 'review'] as const).map(mode => <Button key={mode} quiet compact shortcut="reviewMode"
            label={mode === 'watch' ? 'Watch' : 'Review'}
            active={props.reviewMode === mode} disabled={disabled} onPress={() => props.onMode(mode)}
            style={[styles.modeButton, {borderColor: 'transparent', backgroundColor: props.reviewMode === mode ? dark ? '#ffffff22' : '#ffffffd9' : 'transparent'}]}>
            {mode === 'watch' ? 'Watch' : 'Review'}
          </Button>)}
        </View>
        <View style={styles.transportSpace} />
        <View onLayout={event => { const {x, width} = event.nativeEvent.layout; setMenuAnchors(previous => ({...previous, speed: 20 + x + width / 2})); }}>
        <Button quiet compact label="Playback speed" disabled={disabled} onPress={props.onSpeed}>{props.rate}×</Button></View>
        <View onLayout={event => { const {x, width} = event.nativeEvent.layout; setMenuAnchors(previous => ({...previous, zoom: 20 + x + width / 2})); }}>
        <Button quiet compact label="Video zoom" disabled={disabled} onPress={props.onZoom}>{props.zoom === 1 ? 'Fit' : `${Math.round(props.zoom * 100)}%`}</Button></View>
        <Button quiet compact icon={props.presenting ? 'minimize' : 'maximize'} label={props.presenting ? 'Exit full screen' : 'Enter full screen'} shortcut="present" disabled={disabled} onPress={props.onPresent} />
      </View>
      <View style={styles.timeline}>{props.timeline}</View>
    </PlaybackDock>
  </View>;
}

function AmbientVideo({uri}: {uri: string}) {
  const [layers, setLayers] = useState({previous: uri, current: uri});
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    opacity.stopAnimation();
    opacity.setValue(0);
    setLayers(previous => ({previous: previous.current, current: uri}));
    Animated.timing(opacity, {toValue: 1, duration: 450, useNativeDriver: true, isInteraction: false}).start();
    return () => opacity.stopAnimation();
  }, [uri, opacity]);
  const style = [StyleSheet.absoluteFill, {transform: [{scale: 1.5}]}];
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Image accessible={false} source={{uri: layers.previous}} blurRadius={60} resizeMode="stretch" style={style} />
    <Animated.Image accessible={false} source={{uri: layers.current}} blurRadius={60} resizeMode="stretch" style={[style, {opacity}]} />
  </View>;
}

function NoteColumn(props: Props & {numbers: ReadonlyMap<string, number>}) {
  const {colors, dark} = useTheme();
  const scroll = useRef<ScrollView>(null);
  const replying = props.draft?.parent_comment_id ? conversationRoot(props.comments, props.draft.parent_comment_id) : null;
  const hasComposer = !!props.draft;
  const rows = props.notes.map(note => ({note, replies: discussionReplies(props.comments, note.comment_id)}));
  const rowHeight = (index: number) => props.expanded.has(rows[index].note.comment_id) && rows[index].replies.length ? 236 : 146;
  const selectedIndex = props.notes.findIndex(note => note.comment_id === props.selectedId);
  const selectedOffset = rows.slice(0, Math.max(0, selectedIndex)).reduce((sum, _, index) => sum + rowHeight(index) + 10, 0);
  useEffect(() => {
    if (hasComposer) scroll.current?.scrollToEnd({animated: false});
    else if (selectedIndex >= 0) scroll.current?.scrollTo({y: selectedOffset, animated: false});
  }, [props.selectedId, hasComposer, props.draft?.id, selectedOffset, selectedIndex]);
  return <ScrollView ref={scroll} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled" style={styles.noteColumn}
    onContentSizeChange={() => { if (hasComposer) scroll.current?.scrollToEnd({animated: false}); }}
    contentContainerStyle={styles.noteContent}>
      {rows.map(({note, replies}, index) => {
        const expanded = props.expanded.has(note.comment_id);
        return <Glass key={note.comment_id} selected={props.selectedId === note.comment_id || replying?.comment_id === note.comment_id} style={[styles.note, {height: rowHeight(index)}]}>
          <Pressable disabled={props.disabled} accessibilityRole="button" accessibilityLabel={`Select comment${props.numbers.has(note.comment_id) ? ` ${props.numbers.get(note.comment_id)}` : ''} by ${note.name_at_posting}`}
            onPress={() => props.onSelect(note)} style={styles.noteHeader}>
            {props.numbers.has(note.comment_id) && <View style={styles.number}><Text style={styles.pinNumber}>{props.numbers.get(note.comment_id)}</Text></View>}
            <Avatar name={note.name_at_posting} size={22} /><Text numberOfLines={1} style={[styles.author, {color: colors.text}]}>{note.name_at_posting}</Text>
            <Text style={[styles.timestamp, {color: colors.muted}]}>{anchorLabel(note.anchor)}</Text>
          </Pressable>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.noteBody}>
            <Text selectable style={[styles.noteText, {color: colors.text}]}>{note.text || 'Drawing'}</Text>
            {expanded && replies.map(({comment, depth}) => <View key={comment.comment_id} style={[styles.reply, {marginLeft: 16 + Math.min(depth, 3) * 12,
              borderLeftColor: dark ? colors.line : '#575760', backgroundColor: dark ? '#ffffff09' : '#00000006'}]}>
              <View style={styles.replyHeader}><Avatar name={comment.name_at_posting} size={18} />
                <Text style={[styles.replyAuthor, {color: colors.text}]}>{comment.name_at_posting}</Text></View>
              <Text selectable style={[styles.replyText, {color: colors.text}]}>{comment.text || 'Drawing'}</Text>
            </View>)}
          </ScrollView>
          <View style={styles.noteActions}>
            {note.anchor.kind === 'play' && <Button quiet compact icon="play" label="Replay play" disabled={props.disabled} onPress={() => props.onReplay(note)}>Replay</Button>}
            {!!replies.length && <Button quiet compact label={`${expanded ? 'Hide' : 'Show'} replies to ${note.name_at_posting}`} disabled={props.disabled} onPress={() => props.onExpand(note)}>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</Button>}
            <View style={{flex: 1}} /><Button quiet compact label={`Reply to ${note.name_at_posting}`} disabled={props.disabled} onPress={() => props.onReply(note)}>Reply</Button>
          </View>
        </Glass>;
      })}
      {hasComposer && <Glass selected style={[styles.note, replying && {marginLeft: 16}]}>
        {props.composer}
      </Glass>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  workspace: {flex: 1, minHeight: 0, overflow: 'hidden', backgroundColor: '#000000'},
  stage: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center'},
  video: {backgroundColor: '#000', overflow: 'hidden'},
  header: {position: 'absolute', top: 12, left: 16, right: 16, borderRadius: 20},
  toolRail: {position: 'absolute', left: 16, top: 86, bottom: 150, justifyContent: 'center', alignItems: 'flex-start', zIndex: 10},
  tools: {alignItems: 'center', padding: 6, gap: 4, borderRadius: 24},
  toolRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
  toolAccessory: {paddingTop: 18},
  conversations: {position: 'absolute'},
  pinNumber: {color: '#15344e', fontSize: 11, fontWeight: '700'},
  noteColumn: {flexShrink: 1},
  noteContent: {gap: 10, paddingVertical: 1},
  note: {paddingHorizontal: 13, paddingTop: 10, paddingBottom: 12, borderRadius: 18},
  noteHeader: {flexDirection: 'row', alignItems: 'center', gap: 7, height: 28, marginBottom: 5},
  number: {width: 21, height: 21, borderRadius: 11, backgroundColor: ANNOTATION_COLOR, alignItems: 'center', justifyContent: 'center'},
  author: {fontSize: 12, fontWeight: '600', flex: 1},
  timestamp: {fontSize: 11, fontVariant: ['tabular-nums']},
  noteBody: {flex: 1, minHeight: 20},
  noteText: {fontSize: 13, lineHeight: 19},
  noteActions: {flexDirection: 'row', alignItems: 'center', minHeight: 32, marginTop: 8, gap: 4},
  reply: {padding: 10, marginTop: 10, borderLeftWidth: 2, borderTopRightRadius: 9, borderBottomRightRadius: 9},
  replyHeader: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5},
  replyAuthor: {fontSize: 11, fontWeight: '600', flex: 1},
  replyText: {fontSize: 12, lineHeight: 18},
  transport: {height: 44, flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4},
  transportSpace: {flex: 1, minWidth: 4},
  time: {fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: .2, fontVariant: ['tabular-nums']},
  mode: {flexDirection: 'row', padding: 3, borderRadius: 18},
  modeButton: {paddingHorizontal: 12, paddingVertical: 5, borderRadius: 15},
  modeLabel: {fontSize: 12, fontWeight: '600'},
  timeline: {paddingHorizontal: 0},
});
