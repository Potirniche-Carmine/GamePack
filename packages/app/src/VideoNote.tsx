import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Avatar} from './Avatar';
import {anchorLabel, anchorStart, Button} from './components';
import {discussionReplies} from './discussion';
import {Icon} from './Icon';
import {useTheme} from './theme';
import type {Comment} from './types';

export type VideoNoteProps = {
  notes: Comment[]; comments?: Comment[]; colors: ReadonlyMap<string, string>; large: boolean; paused: boolean; disabled: boolean;
  profileName?: string; onPause: () => void; onReply: (comment: Comment) => void;
};

export function VideoNote({notes, comments = notes, colors, large, paused, disabled, profileName, onPause, onReply}: VideoNoteProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const numbers = useMemo(() => new Map(comments.filter(comment => !comment.parent_comment_id)
    .sort((a, b) => anchorStart(a.anchor) - anchorStart(b.anchor) || a.comment_id.localeCompare(b.comment_id))
    .map((comment, index) => [comment.comment_id, index + 1])), [comments]);
  useEffect(() => {
    if (expandedId && !notes.some(note => note.comment_id === expandedId)) setExpandedId(null);
  }, [notes, expandedId]);
  if (!notes.length) return null;

  return <View pointerEvents="box-none" style={[local.notes, large && local.notesLarge]}>
    <ScrollView pointerEvents="box-none" style={local.scroll} contentContainerStyle={local.noteList}
      keyboardShouldPersistTaps="handled" onScrollBeginDrag={onPause}>
      {notes.map(note => <NoteCard key={note.comment_id} note={note} comments={comments}
        expanded={expandedId === note.comment_id} color={colors.get(note.comment_id)} number={numbers.get(note.comment_id)} disabled={disabled}
        profileName={profileName} onReply={onReply} onToggle={() => {
          if (!paused) onPause();
          setExpandedId(previous => previous === note.comment_id ? null : note.comment_id);
        }} />)}
    </ScrollView>
  </View>;
}

function NoteCard({note, comments, expanded, color, number, disabled, profileName, onToggle, onReply}: {
  note: Comment; comments: Comment[]; expanded: boolean; color?: string; number?: number; disabled: boolean;
  profileName?: string; onToggle: () => void; onReply: (comment: Comment) => void;
}) {
  const {colors, styles: shared, dark} = useTheme();
  const replies = useMemo(() => discussionReplies(comments, note.comment_id), [comments, note.comment_id]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const replyLabel = replies.length ? `, ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : '';
  return <View style={[local.card, {backgroundColor: colors.panel, borderColor: hovered || expanded ? colors.line : colors.separator}, disabled && {opacity: 0.6}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Comment by ${note.name_at_posting} at ${anchorLabel(note.anchor)}${replyLabel}: ${note.text || 'Drawing'}`}
      accessibilityState={{expanded, disabled}} disabled={disabled}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPress={event => { event.stopPropagation(); onToggle(); }}
      style={({pressed}) => [local.noteBody, pressed && {opacity: 0.7}, focused && shared.focusRing]}>
      <View style={local.noteHeader}>
        {number ? <View style={[local.numberBadge, {backgroundColor: color || colors.accentText}]}>
          <Text style={[local.number, {color: dark ? colors.bg : '#ffffff'}]}>{number}</Text>
        </View> : <Avatar name={note.name_at_posting} size={30} />}
        <View style={local.noteIdentity}>
          <Text numberOfLines={1} style={[local.author, {color: colors.text}]}>{note.name_at_posting}</Text>
          <Text style={[local.time, {color: colors.muted}]}>{anchorLabel(note.anchor)}</Text>
        </View>
        <View accessible={false} style={local.disclosure}>
          {!!replies.length && <View style={[local.dot, {backgroundColor: color || colors.accentText}]} />}
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} color={colors.muted} />
        </View>
      </View>
      {!!note.text && <Text numberOfLines={expanded ? undefined : 3} style={[local.noteText, {color: colors.text}]}>{note.text}</Text>}
    </Pressable>
    {expanded && <>
      {!!replies.length && <View style={[local.replies, {borderTopColor: colors.separator}]}>
        {replies.map(({comment, depth}) => <View key={comment.comment_id} style={[local.reply, {marginLeft: Math.min(depth, 2) * 12}]}>
          <View style={local.replyAvatar}><Avatar name={comment.name_at_posting} size={28} /></View>
          <View style={local.replyContent}>
            <View style={local.replyHeader}>
              <Text numberOfLines={1} style={[local.replyAuthor, {color: colors.text}]}>{comment.name_at_posting}</Text>
              <Text style={[local.replyTime, {color: colors.muted}]}>{anchorLabel(comment.anchor)}</Text>
              <Button quiet compact icon="reply" label={`Reply to ${comment.name_at_posting}`} disabled={disabled} onPress={() => onReply(comment)} />
            </View>
            {!!comment.text && <Text selectable style={[local.replyText, {color: colors.muted}]}>{comment.text}</Text>}
          </View>
        </View>)}
      </View>}
      <View style={[local.footer, {borderTopColor: colors.separator}]}>
        {!!profileName && <Avatar name={profileName} size={26} />}
        <Pressable accessibilityRole="button" accessibilityLabel={`Reply to ${note.name_at_posting}`}
          accessibilityState={{disabled}} disabled={disabled} onPress={event => { event.stopPropagation(); onReply(note); }}
          style={({pressed}) => [local.replyField, {backgroundColor: colors.inset}, pressed && {opacity: 0.6}]}>
          <Text style={[local.replyPlaceholder, {color: colors.muted}]}>Reply…</Text>
          <Icon name="reply" color={colors.muted} />
        </Pressable>
      </View>
    </>}
  </View>;
}

const local = StyleSheet.create({
  notes: {position: 'absolute', top: 20, right: 20, bottom: 108, width: 324, maxWidth: '66%'},
  notesLarge: {top: 88, right: 28, width: 366, bottom: 112},
  scroll: {flexGrow: 0},
  noteList: {gap: 10, padding: 2},
  card: {borderRadius: 16, borderWidth: 1},
  noteBody: {padding: 14, borderRadius: 15},
  noteHeader: {flexDirection: 'row', alignItems: 'center', gap: 9},
  noteIdentity: {minWidth: 0, flex: 1, gap: 3},
  numberBadge: {height: 28, width: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  number: {fontSize: 13, fontWeight: '700'},
  author: {fontSize: 12, fontWeight: '600'},
  time: {fontSize: 10, lineHeight: 12, fontVariant: ['tabular-nums']},
  disclosure: {flexDirection: 'row', alignItems: 'center', gap: 5},
  dot: {width: 5, height: 5, borderRadius: 3},
  noteText: {fontSize: 13, lineHeight: 20, fontWeight: '500', marginTop: 11},
  replies: {paddingTop: 14, paddingHorizontal: 14, borderTopWidth: StyleSheet.hairlineWidth},
  reply: {flexDirection: 'row', gap: 9, marginBottom: 12},
  replyAvatar: {paddingTop: 1},
  replyContent: {minWidth: 0, flex: 1},
  replyHeader: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5},
  replyAuthor: {fontSize: 11, fontWeight: '600', flex: 1},
  replyTime: {fontSize: 10, fontVariant: ['tabular-nums']},
  replyText: {fontSize: 12, lineHeight: 18},
  footer: {flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderTopWidth: StyleSheet.hairlineWidth},
  replyField: {flex: 1, minHeight: 34, borderRadius: 17, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  replyPlaceholder: {fontSize: 12},
});
