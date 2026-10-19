import React, {useEffect, useRef, useState, type RefObject} from 'react';
import {findNodeHandle, StyleSheet, Text, TextInput, View} from 'react-native';
import {Avatar} from './Avatar';
import {anchorLabel, Button, TextField} from './components';
import {useTheme} from './theme';
import {measureCommentInput} from './native';
import {canPostDraft} from './drafts';
import type {Draft} from './types';

export function CommentComposer({draft, name, input, disabled, saving, failed, onText, onFocus, onHide, onDiscard, onRetry, onPost}: {
  draft: Draft; name: string; input: RefObject<TextInput | null>; disabled: boolean; saving: boolean; failed: boolean;
  onText: (text: string) => void; onFocus: () => void; onHide: () => void; onDiscard: () => void; onRetry: () => void; onPost: () => void;
}) {
  const {colors} = useTheme();
  const [nativeHeight, setNativeHeight] = useState<number | undefined>();
  const measurement = useRef(0);
  const measure = () => {
    const token = ++measurement.current;
    void measureCommentInput(findNodeHandle(input.current)).then(height => {
      if (token === measurement.current && height !== null) setNativeHeight(Math.max(24, Math.min(152, height)));
    }).catch(() => undefined);
  };
  useEffect(() => {
    const frame = requestAnimationFrame(measure);
    return () => { cancelAnimationFrame(frame); measurement.current++; };
  }, [draft.text]);
  return <View style={[styles.composer, {backgroundColor: 'transparent'}]}>
    <View style={styles.header}>
      <View style={styles.identity}><Avatar name={name} size={24} /><Text numberOfLines={1} style={[styles.author, {color: colors.text}]}>{name}</Text></View>
      <Text style={{color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums']}}>{anchorLabel(draft.anchor)}</Text>
      <Button quiet compact icon="close" label="Hide comment" disabled={disabled} onPress={onHide} />
    </View>
    <View style={[styles.textArea, nativeHeight !== undefined && {height: nativeHeight}]}>
      <Text accessible={false} pointerEvents="none" style={styles.measure}>{`${draft.text} `}</Text>
      <TextField ref={input} accessibilityLabel={draft.parent_comment_id ? 'Write reply' : 'Write comment'} placeholder={draft.parent_comment_id ? 'Add a reply…' : 'Add a comment…'}
        onLayout={measure}
        multiline editable={!disabled} style={[styles.field, {backgroundColor: 'transparent'}]} inputStyle={styles.editor}
        value={draft.text} onFocus={onFocus} onChangeText={onText} maxLength={16000} />
    </View>
    <View style={styles.footer}>
      <Button quiet compact icon="trash" label="Discard comment" disabled={disabled} onPress={onDiscard} />
      {failed && <Button compact disabled={disabled} onPress={onRetry}>Retry</Button>}
      <View style={{flex: 1}} /><Button primary compact shortcut="submit" disabled={disabled || !canPostDraft(draft)} onPress={onPost}>{saving ? 'Saving…' : 'Post'}</Button>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  composer: {padding: 10, borderRadius: 11},
  header: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6},
  identity: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8},
  author: {fontSize: 11, lineHeight: 16, flex: 1},
  textArea: {minHeight: 24, maxHeight: 152, overflow: 'hidden'},
  field: {...StyleSheet.absoluteFillObject, minHeight: 24, borderWidth: 0, paddingHorizontal: 2, paddingVertical: 0},
  editor: {flex: 1, minHeight: 24, fontSize: 13, lineHeight: 19},
  measure: {opacity: 0, fontSize: 13, lineHeight: 19, paddingHorizontal: 4, paddingVertical: 5},
  footer: {flexDirection: 'row', alignItems: 'center', marginTop: 6},
});
