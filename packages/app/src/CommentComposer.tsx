import React, {useState, type RefObject} from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import {Avatar} from './Avatar';
import {Button, TextField} from './components';
import {DragHandle} from './SpatialCard';
import {useTheme} from './theme';
import type {Draft} from './types';

export function CommentComposer({draft, name, input, disabled, saving, failed, onText, onFocus, onHide, onDiscard, onRetry, onPost}: {
  draft: Draft; name: string; input: RefObject<TextInput | null>; disabled: boolean; saving: boolean; failed: boolean;
  onText: (text: string) => void; onFocus: () => void; onHide: () => void; onDiscard: () => void; onRetry: () => void; onPost: () => void;
}) {
  const {colors} = useTheme();
  const [inputHeight, setInputHeight] = useState(24);
  return <View style={[styles.composer, {backgroundColor: colors.panel}]}>
    <View style={styles.header}>
      <DragHandle style={styles.identity}><Avatar name={name} size={24} /><Text numberOfLines={1} style={[styles.author, {color: colors.muted}]}>{name}</Text></DragHandle>
      <Button quiet compact icon="close" label="Hide comment" disabled={disabled} onPress={onHide} />
    </View>
    <TextField ref={input} accessibilityLabel={draft.parent_comment_id ? 'Write reply' : 'Write comment'} placeholder={draft.parent_comment_id ? 'Add a reply…' : 'Add a comment…'}
      multiline editable={!disabled} style={[styles.field, {backgroundColor: colors.panel}]} inputStyle={{minHeight: 24, height: inputHeight, fontSize: 13, lineHeight: 19}}
      onContentSizeChange={event => setInputHeight(Math.max(24, Math.min(152, event.nativeEvent.contentSize.height)))}
      value={draft.text} onFocus={onFocus} onChangeText={onText} maxLength={16000} />
    <View style={styles.footer}>
      <Button quiet compact icon="trash" label="Discard comment" disabled={disabled} onPress={onDiscard} />
      {failed && <Button compact disabled={disabled} onPress={onRetry}>Retry</Button>}
      <View style={{flex: 1}} /><Button primary compact shortcut="submit" disabled={disabled || (!draft.text.trim() && !draft.drawings.length)} onPress={onPost}>{saving ? 'Saving…' : 'Post'}</Button>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  composer: {padding: 10, borderRadius: 11},
  header: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6},
  identity: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8},
  author: {fontSize: 11, lineHeight: 16, flex: 1},
  field: {minHeight: 24, borderWidth: 0, paddingHorizontal: 2, paddingVertical: 0},
  footer: {flexDirection: 'row', alignItems: 'center', marginTop: 6},
});
