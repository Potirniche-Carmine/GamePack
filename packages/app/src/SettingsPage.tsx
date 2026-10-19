import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Animated, Platform, ScrollView, StyleSheet, Text, View} from 'react-native';
import {GlassSurface} from './Glass';
import {Avatar} from './Avatar';
import {Button, TextField} from './components';
import {easeOut, MotionPressable, useReducedMotion} from './motion';
import type {Colors} from './colors';
import {binding, shortcutLabel, shortcuts} from './shortcuts';
import {useTheme} from './theme';
import {appBuild, openUpdateRelease} from './native';
import {checkForUpdates, type AppBuild, type UpdateResult} from './updates';
import type {Profile, Settings, ThemeChoice} from './types';

type SettingsTab = 'profile' | 'appearance' | 'shortcuts';
const tabs: {id: SettingsTab; label: string}[] = [
  {id: 'profile', label: 'Profile'}, {id: 'appearance', label: 'Appearance'}, {id: 'shortcuts', label: 'Shortcuts'},
];

export function SettingsPage({settings, profile, recording, error, busy, onProfileSave, onRecord, onChange, onTheme, onClose, initialTab = 'appearance', animateEntrance = true}: {
  settings: Settings; profile: Profile; recording: string | null; error: string; busy: boolean;
  onProfileSave: (name: string) => void | Promise<void>;
  onRecord: (id: string | null) => void; onChange: (settings: Settings) => void;
  onTheme: (theme: ThemeChoice) => void; onClose: () => void; initialTab?: SettingsTab; animateEntrance?: boolean;
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
  const reduceMotion = useReducedMotion();
  const entrance = useRef(new Animated.Value(animateEntrance ? 0 : 1)).current;
  useEffect(() => {
    if (!animateEntrance) { entrance.setValue(1); return; }
    const animation = Animated.timing(entrance, {toValue: 1, duration: reduceMotion ? 120 : 180, easing: easeOut, useNativeDriver: true});
    animation.start();
    return () => animation.stop();
  }, [animateEntrance, entrance, reduceMotion]);
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

  return <Animated.View style={[s.page, {opacity: entrance}, !reduceMotion && {transform: [{scale: entrance.interpolate({inputRange: [0, 1], outputRange: [0.985, 1]})}]}]}>
    <GlassSurface radius={28} />
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, {borderRadius: 28, backgroundColor: colors.panel, opacity: .14}]} />
    <View style={s.header}>
      <Button icon="close" quiet compact label="Close settings" onPress={onClose} style={s.close} />
      <Text accessibilityRole="header" style={s.title}>Settings</Text>
      <View style={s.close} />
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
          <Avatar name={name} size={64} />
        </View>
        <Text style={s.fieldLabel}>Full name</Text>
        <TextField accessibilityLabel="Full name" placeholder="First and last name" placeholderTextColor={colors.faint}
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

      </View>}
      {tab === 'shortcuts' && <View>
        <View style={s.searchRow}>
          <TextField accessibilityLabel="Search shortcuts" placeholder="Search shortcuts" placeholderTextColor={colors.faint} value={query}
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
    <UpdateSettings disabled={busy} />
  </Animated.View>;
}

function UpdateSettings({disabled}: {disabled: boolean}) {
  const {colors} = useTheme();
  const s = useMemo(() => createSettingsStyles(colors), [colors]);
  const [build, setBuild] = useState<AppBuild | null>(null);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [opening, setOpening] = useState(false);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const openingRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    // Reading the installed binary is local. Network access starts only on press.
    void appBuild().then(value => { if (mounted.current) setBuild(value); }).catch(() => {});
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  const check = async () => {
    if (request.current || openingRef.current || disabled) return;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true); setError(''); setResult(null);
    try {
      const installed = build ?? await appBuild();
      if (!mounted.current) return;
      setBuild(installed);
      const next = await checkForUpdates(installed, {signal: controller.signal});
      if (mounted.current) setResult(next);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not check for updates. Try again.');
    } finally {
      request.current = null;
      if (mounted.current) setChecking(false);
    }
  };
  const open = async () => {
    if (result?.kind !== 'available' || openingRef.current || disabled) return;
    openingRef.current = true; setOpening(true); setError('');
    try { await openUpdateRelease(result.tag, result.asset !== null); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not open your browser. Try again.'); }
    finally { openingRef.current = false; if (mounted.current) setOpening(false); }
  };
  const status = error || (result?.kind === 'current' ? 'No updates available.' : result?.kind === 'unpublished' ? 'No published release is available yet.'
    : result?.kind === 'available' && !result.asset ? 'A download for this device is not available yet.' : '');
  return <View style={s.updates}>
    <View style={s.updateRow}>
      <Text style={s.updateLabel} accessibilityLiveRegion="polite">{result?.kind === 'available' ? `Version ${result.version} available` : build ? `GamePack ${build.version}` : 'GamePack'}</Text>
      <Button compact quiet disabled={disabled || checking || opening} onPress={() => void check()}>{checking ? 'Checking…' : 'Check for updates'}</Button>
      {result?.kind === 'available' && <Button compact primary disabled={disabled || opening} onPress={() => void open()}>{opening ? 'Opening…' : result.asset ? 'Download' : 'View release'}</Button>}
    </View>
    {!!status && <Text accessibilityRole={error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={[s.updateStatus, !!error && {color: colors.errorText}]}>{status}</Text>}
  </View>;
}

function SettingsTabButton({label, selected, onPress}: {label: string; selected: boolean; onPress: () => void}) {
  const {colors} = useTheme();
  const s = useMemo(() => createSettingsStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  return <MotionPressable accessibilityRole="tab" accessibilityState={{selected}} focusable onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.tab, hovered && s.tabHover, selected && s.tabSelected, focused && s.focus]}>
    <Text style={[s.tabLabel, selected && s.tabLabelSelected]}>{label}</Text>
  </MotionPressable>;
}

function AppearanceOption({choice, selected, disabled, onPress}: {choice: ThemeChoice; selected: boolean; disabled: boolean; onPress: () => void}) {
  const {colors} = useTheme();
  const s = useMemo(() => createSettingsStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const label = choice[0].toUpperCase() + choice.slice(1);
  return <MotionPressable accessibilityRole="radio" accessibilityLabel={`${label} appearance`} accessibilityState={{checked: selected, disabled}} focusable={!disabled}
    disabled={disabled} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.appearance, hovered && !disabled && s.appearanceHover, selected && s.appearanceSelected, focused && s.focus, disabled && s.disabled]}>
    <View style={s.preview}>
      <AppearancePreview dark={choice === 'dark'} />
      {choice === 'system' && <View style={s.previewDarkHalf}><View style={s.previewDarkScene}><AppearancePreview dark /></View></View>}
    </View>
    <View style={s.appearanceLabelRow}>
      <Text style={[s.appearanceLabel, selected && s.selectedText]}>{label}</Text>
      <View style={[s.radio, selected && s.radioSelected]}>{selected && <View style={s.radioDot} />}</View>
    </View>
  </MotionPressable>;
}


function AppearancePreview({dark}: {dark: boolean}) {
  const palette = dark ? {background: '#292c30', line: '#626971', stage: '#181b1e', card: '#42474e', accent: '#c0c8d0'}
    : {background: '#fbfbfc', line: '#b0b6bf', stage: '#d6dbe0', card: '#ffffff', accent: '#7f8a98'};
  return <View accessible={false} style={[previewStyles.window, {backgroundColor: palette.background}]}>
    <View style={previewStyles.topBar}><View style={[previewStyles.brand, {backgroundColor: palette.accent}]} /><View style={[previewStyles.topAction, {backgroundColor: palette.line}]} /></View>
    <View style={previewStyles.workspace}>
      <View style={previewStyles.main}>
        <View style={previewStyles.videoRow}>
          <View style={[previewStyles.tools, {backgroundColor: palette.card}]}>{[0, 1, 2].map(index => <View key={index} style={[previewStyles.tool, {backgroundColor: palette.line}]} />)}</View>
          <View style={[previewStyles.stage, {backgroundColor: palette.stage}]} />
        </View>
        <View style={previewStyles.comments}>{[0, 1].map(index => <View key={index} style={[previewStyles.comment, {backgroundColor: palette.card}]}>
            <View style={[previewStyles.commentAvatar, {backgroundColor: palette.line}]} /><View style={[previewStyles.commentLine, {backgroundColor: palette.line}]} />
          </View>)}</View>
        <View style={previewStyles.filmstrip}>{[0, 1, 2, 3, 4].map(index => <View key={index} style={[previewStyles.frame, {backgroundColor: palette.stage}]} />)}</View>
      </View>
    </View>
  </View>;
}

const createSettingsStyles = (c: Colors) => StyleSheet.create({
  page: {width: 720, height: 620, maxWidth: '96%', maxHeight: '96%', alignSelf: 'center', paddingHorizontal: 32, paddingTop: 24, paddingBottom: 28, borderRadius: 28},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22},
  title: {color: c.text, fontSize: 17, lineHeight: 23, letterSpacing: -0.35, fontWeight: '600'},
  close: {width: 32, height: 32, minHeight: 32, padding: 0, borderRadius: 16},
  navigation: {flexDirection: 'row', padding: 3, borderRadius: 18, backgroundColor: c.glassInset, gap: 2, marginBottom: 24},
  tab: {flex: 1, minHeight: 33, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 1, borderColor: 'transparent'},
  tabHover: {backgroundColor: c.inset},
  tabSelected: {backgroundColor: c.glassSelected, borderColor: 'transparent'},
  tabLabel: {fontSize: 13, lineHeight: 19, fontWeight: '500', color: c.muted},
  tabLabelSelected: {color: c.text, fontWeight: '600'},
  scroll: {flex: 1},
  content: {paddingBottom: 16, paddingRight: 10, width: '100%'},
  updates: {paddingTop: 14, borderTopWidth: 1, borderTopColor: c.separator},
  updateRow: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8},
  updateLabel: {flex: 1, minWidth: 140, color: c.muted, fontSize: 13, lineHeight: 19},
  updateStatus: {color: c.muted, fontSize: 12, lineHeight: 18, marginTop: 7},
  error: {color: c.errorText, backgroundColor: c.errorBg, padding: 12, borderRadius: 8, fontSize: 13, lineHeight: 19, marginBottom: 20},
  profilePanel: {width: '100%', maxWidth: 360, alignSelf: 'center'},
  identity: {alignItems: 'center', marginTop: 8, marginBottom: 26},
  fieldLabel: {fontSize: 13, lineHeight: 19, fontWeight: '500', color: c.text, marginBottom: 9},
  input: {height: 42, minHeight: 42, paddingHorizontal: 12, paddingVertical: 0, borderWidth: 1, borderColor: c.line, borderRadius: 9, color: c.text, backgroundColor: c.glassInset, fontSize: 14},
  inputFocused: {borderColor: c.selectedLine},
  profileActions: {flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 20},
  themeOptions: {flexDirection: 'row', gap: 12},
  appearance: {flex: 1, borderRadius: 11, padding: 7, borderWidth: 2, borderColor: 'transparent'},
  appearanceSelected: {borderColor: c.selectedLine, backgroundColor: c.selected},
  appearanceHover: {backgroundColor: c.inset},
  preview: {height: 103, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: c.separator},
  previewDarkHalf: {position: 'absolute', left: '50%', right: 0, top: 0, bottom: 0, overflow: 'hidden'},
  previewDarkScene: {width: '200%', height: '100%', marginLeft: '-100%'},
  appearanceLabelRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3, paddingTop: 12, paddingBottom: 4},
  appearanceLabel: {fontSize: 14, lineHeight: 20, color: c.text, fontWeight: '500'},
  selectedText: {color: c.accentText},
  radio: {width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center'},
  radioSelected: {borderColor: c.selectedLine, backgroundColor: c.selectedLine},
  radioDot: {width: 6, height: 6, borderRadius: 3, backgroundColor: c.panel},
  searchRow: {flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 8},
  search: {flex: 1},
  shortcutGroup: {marginTop: 23},
  sectionTitle: {color: c.muted, fontSize: 13, lineHeight: 20, fontWeight: '600', marginBottom: 10},
  shortcutRow: {flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.separator},
  shortcutLabel: {flex: 1, color: c.text, fontSize: 14, lineHeight: 21},
  keycap: {minWidth: 106, minHeight: 30},
  emptySearch: {color: c.muted, fontSize: 14, lineHeight: 20, paddingVertical: 36, textAlign: 'center'},
  focus: {borderColor: c.selectedLine},
  disabled: {opacity: 0.6},
});

const previewStyles = StyleSheet.create({
  window: {flex: 1, padding: 8},
  topBar: {height: 15, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between'},
  brand: {width: 27, height: 4, borderRadius: 2},
  topAction: {width: 10, height: 4, borderRadius: 2},
  workspace: {flex: 1, flexDirection: 'row', gap: 5},
  main: {flex: 1, gap: 5},
  videoRow: {flex: 1, flexDirection: 'row', gap: 5},
  stage: {flex: 1, borderRadius: 3},
  tools: {width: 10, borderRadius: 5, alignItems: 'center', justifyContent: 'space-evenly'},
  tool: {height: 4, width: 4, borderRadius: 1},
  comments: {height: 15, flexDirection: 'row', gap: 4},
  comment: {flex: 1, borderRadius: 4, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, gap: 4},
  commentAvatar: {width: 8, height: 8, borderRadius: 4},
  commentLine: {height: 3, borderRadius: 2, flex: 1},
  filmstrip: {flexDirection: 'row', height: 13, gap: 2},
  frame: {flex: 1, borderRadius: 2},
});
