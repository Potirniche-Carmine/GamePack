// Local native UI fixture. Register this component from a temporary Metro entry
// to inspect the real Settings page without contacting GitHub or installing.
import React, {useEffect, useMemo, useState} from 'react';
import {Text, View} from 'react-native';
import {Button} from '../../packages/app/src/components';
import {SettingsPage} from '../../packages/app/src/SettingsPage';
import {ThemeContext, useThemeChoice} from '../../packages/app/src/theme';
import {createUpdateController, type NativeUpdateState} from '../../packages/app/src/updateFlow';
import type {ThemeChoice} from '../../packages/app/src/types';

type Scenario = 'Current' | 'Available' | 'Downloading' | 'Verifying' | 'Ready' | 'Error' | 'Incomplete' | 'Save failure';
const scenarios: Scenario[] = ['Current', 'Available', 'Downloading', 'Verifying', 'Ready', 'Error', 'Incomplete', 'Save failure'];
export default function UpdateSettingsPreview() {
  const [choice, setChoice] = useState<ThemeChoice>('light');
  const theme = useThemeChoice(choice);
  const [scenario, setScenario] = useState<Scenario>('Available');
  const [name, setName] = useState('Alex Morgan');
  const [open, setOpen] = useState(true);
  const fixture = useMemo(() => {
    let state: NativeUpdateState = scenario === 'Downloading' ? {status: 'downloading', progress: .37, version: '1.0.1'}
      : scenario === 'Verifying' ? {status: 'verifying', version: '1.0.1'}
      : scenario === 'Ready' || scenario === 'Save failure' ? {status: 'ready', version: '1.0.1'}
      : scenario === 'Error' ? {status: 'error', error: 'The download was interrupted. Check your connection and try again.'} : {status: 'idle'};
    const timers: ReturnType<typeof setTimeout>[] = [];
    const controller = createUpdateController({
      build: async () => ({version: '1.0.0', platform: 'macos', architecture: 'arm64'}),
      state: async () => state,
      check: async () => scenario === 'Current' ? {kind: 'current'} : {kind: 'available', tag: 'v1.0.1', version: '1.0.1', asset: scenario === 'Incomplete' ? null : 'GamePack-macos-arm64.tar.gz'},
      prepare: async () => {
        state = {status: 'downloading', progress: .37, version: '1.0.1'};
        timers.push(setTimeout(() => { state = {status: 'verifying', version: '1.0.1'}; }, 2500));
        timers.push(setTimeout(() => { state = {status: 'ready', version: '1.0.1'}; }, 5000));
      },
      open: async () => {},
    });
    return {
      controller,
      restart: async () => {
        if (scenario === 'Save failure') throw new Error('Could not save your comment. Check available disk space and try again.');
        state = {status: 'installing', version: '1.0.1'};
      },
      dispose: () => timers.forEach(clearTimeout),
    };
  }, [scenario]);
  useEffect(() => () => fixture.dispose(), [fixture]);
  return <ThemeContext.Provider value={theme}><View style={{flex: 1, backgroundColor: theme.colors.bg, padding: 24, gap: 24}}>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
      {scenarios.map(value => <Button key={value} active={scenario === value} onPress={() => { setScenario(value); setOpen(true); }}>{value}</Button>)}
      <Button onPress={() => setChoice(choice === 'dark' ? 'light' : 'dark')}>{choice === 'dark' ? 'Light' : 'Dark'}</Button>
      {!open && <Button onPress={() => setOpen(true)}>Open Settings</Button>}
    </View>
    {open ? <SettingsPage key={scenario} animateEntrance={false} settings={{theme: choice, keybindings: {}}} profile={{author_id: 'preview', name}}
      recording={null} error="" busy={false} onRecord={() => {}} onChange={() => {}} onTheme={setChoice} onClose={() => setOpen(false)}
      onProfileSave={async value => { setName(value); }} onRestart={fixture.restart} updateController={fixture.controller} />
      : <Text style={{color: theme.colors.text}}>Settings closed</Text>}
  </View></ThemeContext.Provider>;
}
