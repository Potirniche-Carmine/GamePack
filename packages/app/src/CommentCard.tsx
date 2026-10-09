import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Avatar} from './Avatar';
import {anchorLabel, Button} from './components';
import {Icon} from './Icon';
import {useTheme} from './theme';
import type {Comment} from './types';

export type CommentCardProps = {
  item: Comment; selected: boolean; onSelect: () => void; onPlay: () => void; onReply: () => void; disabled: boolean;
  replyCount: number; expanded: boolean; onToggle: () => void; activeColor?: string;
};

export function CommentCard({item, selected, onSelect, onPlay, onReply, disabled, replyCount, expanded, onToggle, activeColor}: CommentCardProps) {
  const {colors, styles: shared} = useTheme();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const isReply = !!item.parent_comment_id;
  const date = new Date(item.created_at_reported / 1000);
  const dateLabel = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
  const label = `${isReply ? 'Reply' : 'Comment'} by ${item.name_at_posting} at ${anchorLabel(item.anchor)}${replyCount ? `, ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` : ''}: ${item.text || 'Drawing'}`;
  const open = () => { if (!replyCount || !expanded) onSelect(); if (replyCount) onToggle(); };

  return <View style={[local.card, {backgroundColor: selected ? colors.selected : colors.panel,
    borderColor: selected ? colors.selectedLine : hovered ? colors.separator : 'transparent'}, isReply && local.replyCard,
    disabled && {opacity: 0.5}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{selected, disabled, expanded: replyCount ? expanded : undefined}} disabled={disabled}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPress={event => { event.stopPropagation(); open(); }}
      style={({pressed}) => [local.body, pressed && {opacity: 0.72}, focused && shared.focusRing]}>
      <View style={local.header}>
        <Avatar name={item.name_at_posting} size={isReply ? 28 : 32} />
        <View style={local.identity}>
          <Text numberOfLines={1} style={[local.author, {color: colors.text}]}>{item.name_at_posting}</Text>
          <Text style={[local.date, {color: colors.muted}]}>{dateLabel}</Text>
        </View>
        {!!replyCount && <View accessible={false} style={local.disclosure}>
          <View style={[local.replyDot, {backgroundColor: colors.accentText}]} />
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} color={colors.muted} />
        </View>}
      </View>
      {!!item.text && <Text style={[local.text, isReply && local.replyText, {color: colors.text}]}>{item.text}</Text>}
    </Pressable>
    <View style={local.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Play comment at ${anchorLabel(item.anchor)}`}
        accessibilityState={{disabled}} disabled={disabled} onPress={event => { event.stopPropagation(); onPlay(); }}
        style={({pressed}) => [local.timeButton, {backgroundColor: colors.inset}, pressed && {opacity: 0.65}]}>
        <Icon name="play" color={activeColor || colors.muted} />
        <Text style={[local.time, {color: colors.muted}]}>{anchorLabel(item.anchor)}</Text>
      </Pressable>
      <View style={local.spacer} />
      <Button quiet compact label={`Reply to ${item.name_at_posting}`} onPress={onReply} disabled={disabled}>Reply</Button>
    </View>
  </View>;
}

const local = StyleSheet.create({
  card: {borderRadius: 14, borderWidth: 1, overflow: 'hidden'},
  replyCard: {borderRadius: 12},
  body: {paddingHorizontal: 14, paddingTop: 14, paddingBottom: 5, borderRadius: 13},
  header: {flexDirection: 'row', alignItems: 'center', gap: 10},
  identity: {flex: 1, minWidth: 0, gap: 2},
  author: {fontSize: 12, fontWeight: '600'},
  date: {fontSize: 10, lineHeight: 13},
  disclosure: {flexDirection: 'row', alignItems: 'center', gap: 5},
  replyDot: {height: 5, width: 5, borderRadius: 3},
  text: {fontSize: 13, lineHeight: 20, marginTop: 10},
  replyText: {fontSize: 12, lineHeight: 19},
  actions: {flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingBottom: 9, paddingTop: 4},
  timeButton: {flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28, paddingHorizontal: 7, borderRadius: 7},
  time: {fontSize: 10, fontVariant: ['tabular-nums']},
  spacer: {flex: 1},
});
