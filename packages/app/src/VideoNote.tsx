import React, {useMemo, useState, type ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Avatar} from './Avatar';
import {anchorLabel, anchorStart, Button} from './components';
import {discussionReplies} from './discussion';
import {useTheme} from './theme';
import {DragHandle, SpatialCard} from './SpatialCard';
import {cardAvailableHeight, layoutNotePositions, notePosition, type Point, type Rect, type Size} from './spatial';
import type {Comment} from './types';

export type VideoNoteProps = {
  notes: Comment[]; comments: Comment[]; colors: ReadonlyMap<string, string>; disabled: boolean;
  viewport: Size; rect: Rect; topInset?: number; expanded: ReadonlySet<string>;
  replyParent?: string | null; composer?: ReactNode; profileName: string;
  onPause: () => void; onReply: (comment: Comment) => void; onToggle: (comment: Comment) => void;
  onMove: (comment: Comment, position: Point) => void;
};

export function VideoNote({notes, comments, colors, disabled, viewport, rect, topInset, expanded, replyParent, composer, profileName, onPause, onReply, onToggle, onMove}: VideoNoteProps) {
  const numbers = useMemo(() => new Map(comments.filter(comment => !comment.parent_comment_id)
    .sort((a, b) => anchorStart(a.anchor) - anchorStart(b.anchor) || a.comment_id.localeCompare(b.comment_id))
    .map((comment, index) => [comment.comment_id, index + 1])), [comments]);
  const positions = useMemo(() => layoutNotePositions(notes, rect, viewport, topInset), [notes, rect, viewport, topInset]);
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    {notes.map((note, index) => <Note key={note.comment_id} note={note} comments={comments} number={numbers.get(note.comment_id) ?? index + 1}
      color={colors.get(note.comment_id) ?? '#388AF3'} expanded={expanded.has(note.comment_id)} disabled={disabled}
      position={positions.get(note.comment_id) ?? notePosition(note, index)} viewport={viewport} rect={rect} topInset={topInset}
      replyParent={replyParent} composer={composer} profileName={profileName} onPause={onPause} onReply={onReply}
      onToggle={() => onToggle(note)} onMove={position => onMove(note, position)} />)}
  </View>;
}

function Note({note, comments, number, color, expanded, disabled, position, viewport, rect, topInset, replyParent, composer, profileName, onPause, onReply, onToggle, onMove}: {
  note: Comment; comments: Comment[]; number: number; color: string; expanded: boolean; disabled: boolean;
  position: Point; viewport: Size; rect: Rect; topInset?: number; replyParent?: string | null; composer?: ReactNode; profileName: string;
  onPause: () => void; onReply: (comment: Comment) => void; onToggle: () => void; onMove: (point: Point) => void;
}) {
  const {colors, dark} = useTheme();
  const replies = useMemo(() => discussionReplies(comments, note.comment_id), [comments, note.comment_id]);
  const replying = replyParent === note.comment_id || replies.some(reply => reply.comment.comment_id === replyParent);
  const open = expanded || replying;
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(62);
  const [footerHeight, setFooterHeight] = useState(56);
  const availableHeight = cardAvailableHeight(viewport, rect, topInset);
  const cardWidth = Math.max(1, Math.min(open ? 350 : 240, viewport.width - 100));
  const label = `Comment ${number} by ${note.name_at_posting} at ${anchorLabel(note.anchor)}${replies.length ? `, ${replies.length} replies` : ''}: ${note.text || 'Drawing'}`;
  return <SpatialCard position={position} viewport={viewport} rect={rect} width={cardWidth} topInset={topInset} active={open} disabled={disabled} onGrab={onPause} onMove={onMove}>
    <View style={[local.card, {maxHeight: availableHeight, backgroundColor: colors.panel, borderColor: focused ? colors.text : hovered || open ? colors.line : colors.separator}]}>
      <DragHandle onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)} accessible accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Click to expand. Drag to reposition."
        accessibilityState={{expanded: open, disabled}} onPress={onToggle}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
        style={local.body}>
        <View style={[local.header, !open && {marginBottom: 8}]}>
          <View style={[local.numberBadge, {backgroundColor: color}]}><Text style={[local.number, {color: dark ? '#18181a' : '#ffffff'}]}>{number}</Text></View>
          <View style={{flex: 1, gap: 2}}>
            <Text style={[local.time, {color: colors.muted}]}>{anchorLabel(note.anchor)}</Text>
            {open && <Text numberOfLines={1} style={[local.author, {color: colors.muted}]}>{note.name_at_posting}</Text>}
          </View>
          {!!replies.length && <View style={[local.dot, {backgroundColor: color}]} />}
        </View>
        {!open && <Text numberOfLines={3} style={[local.text, {color: colors.text}]}>{note.text || 'Drawing'}</Text>}
      </DragHandle>
      {open && <>
        <ScrollView style={{maxHeight: Math.max(0, availableHeight - headerHeight - footerHeight - 2), flexShrink: 1}} keyboardShouldPersistTaps="handled" contentContainerStyle={local.conversation}>
          <Text selectable style={[local.text, {color: colors.text}]}>{note.text || 'Drawing'}</Text>
          {!!replies.length && <View style={local.replies}>{replies.map(({comment, depth}) => <View key={comment.comment_id} style={[local.reply, {marginLeft: Math.min(depth, 2) * 10}]}>
            <Avatar name={comment.name_at_posting} size={27} />
            <View style={local.replyContent}>
              <Text style={[local.replyAuthor, {color: colors.muted}]}>{comment.name_at_posting}</Text>
              <Text selectable style={[local.replyText, {color: colors.text}]}>{comment.text || 'Drawing'}</Text>
            </View>
            <Button quiet compact icon="reply" label={`Reply to ${comment.name_at_posting}`} disabled={disabled} onPress={() => onReply(comment)} />
          </View>)}</View>}
        </ScrollView>
        {replying ? <ScrollView style={{maxHeight: availableHeight * .55, flexShrink: 0}} keyboardShouldPersistTaps="handled"
          onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}>{composer}</ScrollView>
          : <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} style={[local.footer, {borderTopColor: colors.separator}]}>
          <Avatar name={profileName} size={26} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Reply to ${note.name_at_posting}`} disabled={disabled} onPress={() => onReply(note)} {...{enableFocusRing: false}}
            style={({pressed}) => [local.replyField, {backgroundColor: colors.inset}, pressed && {opacity: .7}]}>
            <Text style={[local.placeholder, {color: colors.muted}]}>Add a reply…</Text>
          </Pressable>
        </View>}
      </>}
    </View>
  </SpatialCard>;
}
const local = StyleSheet.create({
  card: {borderRadius: 13, borderWidth: 1, overflow: 'hidden'},
  body: {padding: 13, paddingBottom: 14},
  header: {flexDirection: 'row', alignItems: 'center', gap: 9},
  numberBadge: {height: 26, width: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center'},
  number: {fontSize: 13, fontWeight: '700'},
  time: {fontSize: 11, lineHeight: 15, fontVariant: ['tabular-nums']},
  author: {fontSize: 10, lineHeight: 14},
  dot: {width: 5, height: 5, borderRadius: 3, marginRight: 3},
  text: {fontSize: 13, lineHeight: 19, fontWeight: '500'},
  conversation: {paddingHorizontal: 13, paddingBottom: 14},
  replies: {paddingTop: 18, gap: 14},
  reply: {flexDirection: 'row', alignItems: 'flex-start', gap: 9},
  replyContent: {flex: 1, minWidth: 0},
  replyAuthor: {fontSize: 10, lineHeight: 14, marginBottom: 3},
  replyText: {fontSize: 12, lineHeight: 18},
  footer: {padding: 11, flexDirection: 'row', gap: 9, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth},
  replyField: {minHeight: 32, borderRadius: 16, paddingHorizontal: 12, flex: 1, justifyContent: 'center'},
  placeholder: {fontSize: 12, lineHeight: 16},
});
