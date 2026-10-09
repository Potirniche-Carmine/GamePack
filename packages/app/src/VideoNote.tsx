import React, {useMemo, useState, type ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Avatar} from './Avatar';
import {anchorLabel, anchorStart, Button} from './components';
import {discussionReplies} from './discussion';
import {useTheme} from './theme';
import {DragHandle} from './SpatialCard';
import {PinnedCard} from './PinnedCard';
import {cardAvailableHeight, layoutNotePositions, notePosition, type Point, type Rect, type Size} from './spatial';
import type {Comment} from './types';

export type VideoNoteProps = {
  notes: Comment[]; comments: Comment[]; colors: ReadonlyMap<string, string>; disabled: boolean;
  viewport: Size; rect: Rect; topInset?: number; cardsVisible: boolean; expanded: ReadonlySet<string>;
  replyParent?: string | null; composer?: ReactNode; profileName: string;
  onPause: () => void; onReply: (comment: Comment) => void; onToggle: (comment: Comment) => void;
  onMove: (comment: Comment, position: Point) => void;
};

export function VideoNote({notes, comments, colors, disabled, viewport, rect, topInset, cardsVisible, expanded, replyParent, composer, profileName, onPause, onReply, onToggle, onMove}: VideoNoteProps) {
  const numbers = useMemo(() => new Map(comments.filter(comment => !comment.parent_comment_id)
    .sort((a, b) => anchorStart(a.anchor) - anchorStart(b.anchor) || a.comment_id.localeCompare(b.comment_id))
    .map((comment, index) => [comment.comment_id, index + 1])), [comments]);
  const positions = useMemo(() => layoutNotePositions(notes, rect, viewport, topInset), [notes, rect, viewport, topInset]);
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    {notes.map((note, index) => <Note key={note.comment_id} note={note} comments={comments} number={numbers.get(note.comment_id) ?? index + 1}
      color={colors.get(note.comment_id) ?? '#388AF3'} expanded={cardsVisible && expanded.has(note.comment_id)} disabled={disabled}
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
  const {colors} = useTheme();
  const replies = useMemo(() => discussionReplies(comments, note.comment_id), [comments, note.comment_id]);
  const replying = replyParent === note.comment_id || replies.some(reply => reply.comment.comment_id === replyParent);
  const open = expanded || replying;
  const [focused, setFocused] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(62);
  const [footerHeight, setFooterHeight] = useState(56);
  const availableHeight = cardAvailableHeight(viewport, rect, topInset);
  const cardWidth = Math.max(1, Math.min(300, viewport.width - 100));
  const label = `Comment ${number} by ${note.name_at_posting} at ${anchorLabel(note.anchor)}${replies.length ? `, ${replies.length} replies` : ''}: ${note.text || 'Drawing'}`;
  return <PinnedCard position={position} viewport={viewport} rect={rect} width={cardWidth} topInset={topInset} open={open} color={color} number={number}
    label={label} disabled={disabled} onToggle={onToggle} onGrab={onPause} onMove={onMove}>
    <View style={[local.card, {maxHeight: availableHeight, backgroundColor: colors.panel, borderColor: focused ? colors.text : colors.line}]}>
      <View onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)} style={local.body}>
        <DragHandle accessible accessibilityRole="button" accessibilityLabel={`Move comment by ${note.name_at_posting}`} accessibilityHint="Drag to reposition pin."
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[local.header, {flex: 1}]}>
          <View style={{borderWidth: 2, borderColor: color, borderRadius: 16, padding: 1}}><Avatar name={note.name_at_posting} size={24} /></View>
          <Text numberOfLines={1} style={[local.author, {color: colors.text, flex: 1}]}>{note.name_at_posting}</Text>
        </DragHandle>
        <Button quiet compact icon="close" label={`Hide comment ${number}`} disabled={disabled || replying} onPress={onToggle} />
      </View>
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
  </PinnedCard>;
}
const local = StyleSheet.create({
  card: {borderRadius: 13, borderWidth: 1, overflow: 'hidden'},
  body: {paddingHorizontal: 10, paddingTop: 9, paddingBottom: 7, flexDirection: 'row', alignItems: 'center', gap: 8},
  header: {flexDirection: 'row', alignItems: 'center', gap: 9},
  numberBadge: {height: 26, width: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center'},
  number: {fontSize: 13, fontWeight: '700'},
  time: {fontSize: 11, lineHeight: 15, fontVariant: ['tabular-nums']},
  author: {fontSize: 12, lineHeight: 17, fontWeight: '500'},
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
