import React, {useMemo, useSyncExternalStore} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button} from './components';
import {appBuild, openUpdateRelease, prepareUpdate, updateState} from './native';
import {useTheme} from './theme';
import {checkForUpdates} from './updates';
import {createUpdateController, updatePresentation, type UpdateController} from './updateFlow';
import type {Colors} from './colors';

const updates = createUpdateController({
  build: appBuild, state: updateState, prepare: prepareUpdate,
  check: (build, signal) => checkForUpdates(build, {signal}),
  open: tag => openUpdateRelease(tag, false),
});

// Dependency injection lets native previews exercise this real footer with a
// fake bridge, without adding test endpoints or environment flags to production.
export function UpdateSettings({disabled, onRestart, controller = updates}: {
  disabled: boolean; onRestart: () => Promise<void>; controller?: UpdateController;
}) {
  const {colors} = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const view = updatePresentation(snapshot);
  const press = () => {
    if (disabled || view.disabled) return;
    if (view.press === 'restart') void controller.restart(onRestart);
    else void controller[view.press]();
  };
  return <View style={s.footer}>
    <View style={s.row}>
      <View style={s.copy}>
        <Text style={s.title} accessibilityLiveRegion="polite">{view.title}</Text>
        <Text accessibilityRole={view.error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={[s.status, view.error && {color: colors.errorText}]}>{view.status || ' '}</Text>
      </View>
      <Button compact style={s.action} quiet={!view.primary} primary={view.primary} disabled={disabled || view.disabled} onPress={press}>{view.label}</Button>
    </View>
  </View>;
}

const styles = (c: Colors) => StyleSheet.create({
  footer: {paddingTop: 14, borderTopWidth: 1, borderTopColor: c.separator},
  row: {flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 48},
  copy: {flex: 1, gap: 3},
  action: {width: 154, flexShrink: 0},
  title: {color: c.muted, fontSize: 13, lineHeight: 19},
  status: {color: c.muted, fontSize: 12, lineHeight: 18, minHeight: 18},
});
