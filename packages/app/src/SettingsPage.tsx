import React, {useEffect, useMemo, useState} from 'react';
import {Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View} from 'react-native';
import {Avatar} from './Avatar';
import {Button} from './components';
import type {Colors} from './colors';
import {binding, shortcutLabel, shortcuts} from './shortcuts';
import {useTheme} from './theme';
import type {Profile, Settings, ThemeChoice} from './types';

type SettingsTab = 'profile' | 'appearance' | 'shortcuts';
const tabs: {id: SettingsTab; label: string}[] = [
  {id: 'profile', label: 'Profile'}, {id: 'appearance', label: 'Appearance'}, {id: 'shortcuts', label: 'Shortcuts'},
];

export function SettingsPage({settings, profile, recording, error, busy, onProfileSave, onRecord, onChange, onTheme, onClose, initialTab = 'appearance'}: {
  settings: Settings; profile: Profile; recording: string | null; error: string; busy: boolean;
  onProfileSave: (name: string) => void | Promise<void>;
  onRecord: (id: string | null) => void; onChange: (settings: Settings) => void;
  onTheme: (theme: ThemeChoice) => void; onClose: () => void; initialTab?: SettingsTab;
}) {
  const {colors} = useTheme();
  const s = useMemo(() => createSettingsStyles(colors), [colors]);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [query, setQuery] = useState('');
  const [name, setName] = useState(profile.name);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [nameFocused, setNameFocused] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  useEffect(() => { setName(profile.name); }, [profile.name]);
  const changedName = name.trim() !== profile.name.trim();
  const saveName = async () => {
    if (busy || savingProfile || !changedName || !name.trim()) return;
    setSavingProfile(true); setProfileError('');
    try { await onProfileSave(name.trim()); }
    catch (cause) { setProfileError(cause instanceof Error ? cause.message : 'Could not save your name.'); }
    finally { setSavingProfile(false); }
  };
  const filtered = shortcuts.filter(item => `${item.label} ${item.group}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleError = error || (tab === 'profile' ? profileError : '');

  return <View style={s.page}>
    <View style={s.header}>
      <Text accessibilityRole="header" style={s.title}>Settings</Text>
      <Button onPress={onClose} style={s.done}>Done</Button>
    </View>
    <View style={s.navigation}>
      {tabs.map(item => <SettingsTabButton key={item.id} label={item.label} selected={tab === item.id} onPress={() => {
        onRecord(null); setTab(item.id);
      }} />)}
    </View>
    {!!visibleError && <Text accessibilityRole="alert" style={s.error}>{visibleError}</Text>}
    <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {tab === 'profile' && <View style={s.profilePanel}>
        <View style={s.identity}>
          <Avatar name={name} size={72} />
          <Text numberOfLines={2} style={s.identityName}>{name.trim() || 'Your name'}</Text>
        </View>
        <Text style={s.fieldLabel}>Full name</Text>
        <TextInput accessibilityLabel="Full name" placeholder="First and last name" placeholderTextColor={colors.faint}
          style={[s.input, nameFocused && s.inputFocused]} value={name} onChangeText={value => { setName(value); setProfileError(''); }}
          onFocus={() => setNameFocused(true)} onBlur={() => setNameFocused(false)} editable={!busy && !savingProfile}
          maxLength={100} onSubmitEditing={() => void saveName()} returnKeyType="done" />
        <View style={s.profileActions}>
          <Button disabled={busy || savingProfile || !changedName} quiet onPress={() => { setName(profile.name); setProfileError(''); }}>Cancel</Button>
          <Button primary disabled={busy || savingProfile || !changedName || !name.trim()} onPress={() => void saveName()}>{savingProfile ? 'Saving…' : 'Save'}</Button>
        </View>
      </View>}
      {tab === 'appearance' && <View>
        <View style={s.themeOptions}>
          {(['system', 'light', 'dark'] as const).map(choice => <AppearanceOption key={choice} choice={choice} selected={settings.theme === choice} disabled={busy} onPress={() => onTheme(choice)} />)}
        </View>
        <View style={s.preference}>
          <Text style={s.preferenceLabel}>Pause when drawing starts</Text>
          <Switch accessibilityLabel="Pause when drawing starts" value={settings.pause_after_drawing} disabled={busy}
            onValueChange={value => onChange({...settings, pause_after_drawing: value})} trackColor={{false: colors.button, true: colors.selectedLine}} />
        </View>
      </View>}
      {tab === 'shortcuts' && <View>
        <View style={s.searchRow}>
          <TextInput accessibilityLabel="Search shortcuts" placeholder="Search shortcuts" placeholderTextColor={colors.faint} value={query}
            onChangeText={value => { onRecord(null); setQuery(value); }} onFocus={() => { onRecord(null); setSearchFocused(true); }} onBlur={() => setSearchFocused(false)}
            style={[s.input, s.search, searchFocused && s.inputFocused]} />
          <Button disabled={busy} quiet onPress={() => { onRecord(null); onChange({...settings, keybindings: {}}); }}>Reset all</Button>
        </View>
        {!filtered.length && <Text style={s.emptySearch}>No shortcuts found</Text>}
        {['Playback', 'Comments & drawing', 'Library'].map(group => {
          const items = filtered.filter(item => item.group === group);
          return items.length ? <View key={group} style={s.shortcutGroup}>
            <Text accessibilityRole="header" style={s.sectionTitle}>{group}</Text>
            {items.map(item => <View key={item.id} style={s.shortcutRow}>
              <Text style={s.shortcutLabel}>{item.label}</Text>
              <Button active={recording === item.id} disabled={busy} style={s.keycap} label={`Change ${item.label} shortcut`}
                onPress={() => onRecord(recording === item.id ? null : item.id)}>{recording === item.id ? 'Press keys…' : shortcutLabel(binding(item.id, settings.keybindings), Platform.OS === 'macos')}</Button>
              <Button quiet compact disabled={busy || !binding(item.id, settings.keybindings)} label={`Clear ${item.label} shortcut`}
                onPress={() => { onRecord(null); onChange({...settings, keybindings: {...settings.keybindings, [item.id]: null}}); }}>Clear</Button>
            </View>)}
          </View> : null;
        })}
      </View>}
    </ScrollView>
  </View>;
}

function SettingsTabButton({label, selected, onPress}: {label: string; selected: boolean; onPress: () => void}) {
  const {colors} = useTheme();
  const s = useMemo(() => createSettingsStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  return <Pressable accessibilityRole="tab" accessibilityState={{selected}} focusable onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({pressed}) => [s.tab, hovered && s.tabHover, selected && s.tabSelected, focused && s.focus, pressed && s.pressed]}>
    <Text style={[s.tabLabel, selected && s.tabLabelSelected]}>{label}</Text>
  </Pressable>;
}

function AppearanceOption({choice, selected, disabled, onPress}: {choice: ThemeChoice; selected: boolean; disabled: boolean; onPress: () => void}) {
  const {colors} = useTheme();
  const s = useMemo(() => createSettingsStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const label = choice[0].toUpperCase() + choice.slice(1);
  return <Pressable accessibilityRole="radio" accessibilityLabel={`${label} appearance`} accessibilityState={{checked: selected, disabled}} focusable={!disabled}
    disabled={disabled} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({pressed}) => [s.appearance, hovered && !disabled && s.appearanceHover, selected && s.appearanceSelected, focused && s.focus, pressed && s.pressed, disabled && s.disabled]}>
    <View style={s.preview}>
      <AppearancePreview dark={choice === 'dark'} />
      {choice === 'system' && <View style={s.previewDarkHalf}><View style={s.previewDarkScene}><AppearancePreview dark /></View></View>}
    </View>
    <View style={s.appearanceLabelRow}>
      <Text style={[s.appearanceLabel, selected && s.selectedText]}>{label}</Text>
      <View style={[s.radio, selected && s.radioSelected]}>{selected && <View style={s.radioDot} />}</View>
    </View>
  </Pressable>;
}

function AppearancePreview({dark}: {dark: boolean}) {
  const palette = dark ? {background: '#292c30', sidebar: '#34373c', line: '#626971', stage: '#181b1e', card: '#42474e', accent: '#c0c8d0'}
    : {background: '#fbfbfc', sidebar: '#eeeff1', line: '#b0b6bf', stage: '#d6dbe0', card: '#ffffff', accent: '#7f8a98'};
  return <View accessible={false} style={[previewStyles.window, {backgroundColor: palette.background}]}>
    <View style={previewStyles.topBar}><View style={[previewStyles.brand, {backgroundColor: palette.accent}]} /><View style={[previewStyles.topAction, {backgroundColor: palette.line}]} /></View>
    <View style={previewStyles.workspace}>
      <View style={[previewStyles.sidebar, {backgroundColor: palette.sidebar}]}>
        {[0, 1, 2].map(index => <View key={index} style={[previewStyles.sidebarLine, {backgroundColor: palette.line}, index === 0 && previewStyles.sidebarLineShort]} />)}
      </View>
      <View style={previewStyles.main}>
        <View style={[previewStyles.stage, {backgroundColor: palette.stage}]}>
          <View style={[previewStyles.comment, {backgroundColor: palette.card}]}>
            <View style={[previewStyles.commentAvatar, {backgroundColor: palette.line}]} /><View style={[previewStyles.commentLine, {backgroundColor: palette.line}]} />
          </View>
        </View>
        <View style={previewStyles.filmstrip}>{[0, 1, 2, 3, 4].map(index => <View key={index} style={[previewStyles.frame, {backgroundColor: palette.stage}]} />)}</View>
      </View>
    </View>
  </View>;
}

const createSettingsStyles = (c: Colors) => StyleSheet.create({
  page: {flex: 1, width: '100%', maxWidth: 880, alignSelf: 'center', paddingHorizontal: 40, paddingTop: 34, backgroundColor: c.bg},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 30},
  title: {color: c.text, fontSize: 28, lineHeight: 34, letterSpacing: -0.8, fontWeight: '600'},
  done: {minWidth: 68},
  navigation: {flexDirection: 'row', alignSelf: 'flex-start', padding: 3, borderRadius: 11, backgroundColor: c.sidebar, gap: 2, marginBottom: 30},
  tab: {minHeight: 34, minWidth: 102, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: 'transparent'},
  tabHover: {backgroundColor: c.inset},
  tabSelected: {backgroundColor: c.panel, borderColor: c.separator},
  tabLabel: {fontSize: 13, lineHeight: 19, fontWeight: '500', color: c.muted},
  tabLabelSelected: {color: c.text, fontWeight: '600'},
  scroll: {flex: 1},
  content: {paddingBottom: 40, width: '100%'},
  error: {color: c.errorText, backgroundColor: c.errorBg, padding: 12, borderRadius: 8, fontSize: 13, lineHeight: 19, marginBottom: 20},
  profilePanel: {maxWidth: 520},
  identity: {flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 34},
  identityName: {color: c.text, fontSize: 22, lineHeight: 29, fontWeight: '600', letterSpacing: -0.45, flex: 1},
  fieldLabel: {fontSize: 13, lineHeight: 19, fontWeight: '500', color: c.text, marginBottom: 9},
  input: {minHeight: 43, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1, borderColor: c.line, borderRadius: 9, color: c.text, backgroundColor: c.input, fontSize: 14, lineHeight: 20},
  inputFocused: {borderColor: c.selectedLine},
  profileActions: {flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 22},
  themeOptions: {flexDirection: 'row', gap: 16, flexWrap: 'wrap'},
  appearance: {flex: 1, minWidth: 150, borderRadius: 13, padding: 8, borderWidth: 2, borderColor: 'transparent'},
  appearanceSelected: {borderColor: c.selectedLine, backgroundColor: c.selected},
  appearanceHover: {backgroundColor: c.inset},
  preview: {height: 128, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: c.separator},
  previewDarkHalf: {position: 'absolute', left: '50%', right: 0, top: 0, bottom: 0, overflow: 'hidden'},
  previewDarkScene: {width: '200%', height: '100%', marginLeft: '-100%'},
  appearanceLabelRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3, paddingTop: 12, paddingBottom: 4},
  appearanceLabel: {fontSize: 14, lineHeight: 20, color: c.text, fontWeight: '500'},
  selectedText: {color: c.accentText},
  radio: {width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center'},
  radioSelected: {borderColor: c.selectedLine, backgroundColor: c.selectedLine},
  radioDot: {width: 6, height: 6, borderRadius: 3, backgroundColor: c.panel},
  preference: {flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 34, paddingVertical: 22, borderTopWidth: 1, borderTopColor: c.separator},
  preferenceLabel: {flex: 1, fontSize: 14, lineHeight: 21, color: c.text},
  searchRow: {flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 8},
  search: {flex: 1},
  shortcutGroup: {marginTop: 23},
  sectionTitle: {color: c.muted, fontSize: 12, lineHeight: 18, fontWeight: '600', marginBottom: 8},
  shortcutRow: {flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, borderBottomWidth: 1, borderBottomColor: c.separator},
  shortcutLabel: {flex: 1, color: c.text, fontSize: 13, lineHeight: 19},
  keycap: {minWidth: 124, minHeight: 32},
  emptySearch: {color: c.muted, fontSize: 14, lineHeight: 20, paddingVertical: 36, textAlign: 'center'},
  focus: {borderColor: c.selectedLine},
  pressed: {opacity: 0.75},
  disabled: {opacity: 0.6},
});

const previewStyles = StyleSheet.create({
  window: {flex: 1, padding: 8},
  topBar: {height: 15, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between'},
  brand: {width: 27, height: 4, borderRadius: 2},
  topAction: {width: 10, height: 4, borderRadius: 2},
  workspace: {flex: 1, flexDirection: 'row', gap: 5},
  sidebar: {width: '21%', borderRadius: 3, paddingHorizontal: 5, paddingTop: 7, gap: 6},
  sidebarLine: {height: 3, borderRadius: 2},
  sidebarLineShort: {width: '65%'},
  main: {flex: 1, gap: 5},
  stage: {flex: 1, borderRadius: 3, padding: 6, justifyContent: 'center', alignItems: 'flex-end'},
  comment: {height: 23, width: '68%', borderRadius: 4, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, gap: 4},
  commentAvatar: {width: 8, height: 8, borderRadius: 4},
  commentLine: {height: 3, borderRadius: 2, flex: 1},
  filmstrip: {flexDirection: 'row', height: 13, gap: 2},
  frame: {flex: 1, borderRadius: 2},
});
