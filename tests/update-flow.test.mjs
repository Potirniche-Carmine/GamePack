import test from 'node:test';
import assert from 'node:assert/strict';
import {createUpdateController, updatePresentation} from '../packages/app/src/updateFlow.ts';
import {createSettingsWrites, restartAfterSaving, saveEveryDraft} from '../packages/app/src/updatePersistence.ts';

const build = {version: '1.0.0', platform: 'macos', architecture: 'arm64'};
const available = {kind: 'available', version: '1.0.1', tag: 'v1.0.1', asset: 'GamePack-macos-arm64.tar.gz'};
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const settle = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
function harness(overrides = {}) {
  let native = {status: 'idle'};
  const calls = {build: 0, state: 0, check: 0, prepare: 0, open: 0};
  const operations = {
    build: async () => { calls.build++; return build; },
    state: async () => { calls.state++; return {...native}; },
    check: async () => { calls.check++; return available; },
    prepare: async tag => { calls.prepare++; assert.equal(tag, 'v1.0.1'); native = {status: 'downloading', version: '1.0.1', progress: 0}; },
    open: async tag => { calls.open++; assert.equal(tag, 'v1.0.1'); },
    ...overrides,
  };
  const controller = createUpdateController(operations);
  return {controller, calls, state: value => { native = value; }, view: () => updatePresentation(controller.getSnapshot())};
}

test('opening Settings reads local state only; check and preparation reject double presses', async t => {
  const checked = deferred(), prepared = deferred();
  let checks = 0, preparations = 0;
  const h = harness({check: async () => { checks++; return checked.promise; }, prepare: async () => { preparations++; return prepared.promise; }});
  const close = h.controller.subscribe(() => {}); t.after(close);
  await settle();
  assert.equal(h.calls.build, 1); assert.equal(h.calls.state, 1); assert.equal(checks, 0);
  const first = h.controller.check(); await h.controller.check();
  assert.equal(checks, 1); assert.equal(h.view().label, 'Checking…');
  checked.resolve(available); await first;
  assert.equal(h.view().label, 'Update');
  const download = h.controller.prepare(); await h.controller.prepare(); await h.controller.check();
  assert.equal(preparations, 1); assert.equal(checks, 1); assert.equal(h.view().label, 'Downloading…');
  h.state({status: 'verifying', version: '1.0.1'}); prepared.resolve(); await download;
  assert.equal(h.view().label, 'Verifying…'); assert.equal(h.view().disabled, true);
});

test('polling only runs while Settings is visible and native work is active', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const h = harness(); h.state({status: 'downloading', progress: .376, version: '1.0.1'});
  let close = h.controller.subscribe(() => {}); t.after(() => close()); await settle();
  assert.equal(h.view().label, 'Downloading 38%');
  t.mock.timers.tick(500); await settle(); assert.equal(h.calls.state, 2);
  close(); t.mock.timers.tick(5000); await settle(); assert.equal(h.calls.state, 2);
  h.state({status: 'ready', version: '1.0.1'});
  close = h.controller.subscribe(() => {}); await settle();
  assert.equal(h.view().label, 'Restart to update'); assert.equal(h.view().title, 'Version 1.0.1');
  t.mock.timers.tick(5000); await settle(); assert.equal(h.calls.state, 3);
});

test('progress and verification remain observable before prepare resolves, including an initial idle read', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const acceptance = deferred(); let starts = 0;
  const h = harness({prepare: async () => { starts++; return acceptance.promise; }});
  const close = h.controller.subscribe(() => {}); t.after(close); await settle(); await h.controller.check();
  const pending = h.controller.prepare(); await settle();
  assert.equal(h.view().label, 'Downloading…'); assert.equal(h.view().disabled, true);
  await h.controller.prepare(); assert.equal(starts, 1);
  h.state({status: 'downloading', progress: .62, version: '1.0.1'});
  t.mock.timers.tick(500); await settle(); assert.equal(h.view().label, 'Downloading 62%');
  h.state({status: 'verifying', version: '1.0.1'});
  t.mock.timers.tick(500); await settle(); assert.equal(h.view().label, 'Verifying…');
  acceptance.resolve(); await pending;
  assert.equal(h.view().label, 'Verifying…'); assert.equal(h.view().disabled, true);
});

test('native preparation survives closing Settings before the acceptance response', async t => {
  const prepared = deferred();
  const h = harness({prepare: () => prepared.promise});
  let close = h.controller.subscribe(() => {}); t.after(() => close()); await settle();
  await h.controller.check();
  const pending = h.controller.prepare(); close();
  h.state({status: 'ready', version: '1.0.1'}); prepared.resolve(); await pending;
  close = h.controller.subscribe(() => {}); await settle();
  assert.equal(h.view().label, 'Restart to update');
});

test('closing aborts checks and ignores their late response after reopening', async t => {
  const old = deferred(); let oldSignal, count = 0;
  const h = harness({check: async (_build, signal) => { if (++count === 1) { oldSignal = signal; return old.promise; } return {kind: 'current'}; }});
  let close = h.controller.subscribe(() => {}); t.after(() => close()); await settle();
  const pending = h.controller.check(); close(); assert.equal(oldSignal.aborted, true);
  close = h.controller.subscribe(() => {}); await settle(); await h.controller.check();
  old.resolve(available); await pending;
  assert.equal(h.view().label, 'Check for updates'); assert.equal(h.view().status, 'No updates available.');
});

test('stale native reads cannot replace the state recovered on reopening', async t => {
  const old = deferred(); let reads = 0;
  const h = harness({state: async () => ++reads === 1 ? old.promise : {status: 'ready', version: '1.0.1'}});
  let close = h.controller.subscribe(() => {}); close();
  close = h.controller.subscribe(() => {}); t.after(close); await settle();
  old.resolve({status: 'idle'}); await settle();
  assert.equal(h.view().label, 'Restart to update');
});

test('native read failure exposes Retry and cannot install from stale readiness', async t => {
  let reads = 0;
  const h = harness({state: async () => { if (++reads === 1) throw new Error('Could not read update state.'); return {status: 'ready', version: '1.0.1'}; }});
  const close = h.controller.subscribe(() => {}); t.after(close); await settle();
  assert.equal(h.view().label, 'Retry'); assert.equal(h.view().error, true);
  await h.controller.restart(async () => assert.fail('must read native state before restarting'));
  await h.controller.check(); assert.equal(h.view().label, 'Restart to update'); assert.equal(h.view().error, false);
});

test('failed preparations are retryable and native helper errors survive Settings recreation', async t => {
  let attempts = 0;
  const h = harness({prepare: async () => { if (++attempts === 1) throw new Error('Download failed. Try again.'); h.state({status: 'ready', version: '1.0.1'}); }});
  let close = h.controller.subscribe(() => {}); t.after(() => close()); await settle();
  await h.controller.check(); await h.controller.prepare();
  assert.equal(h.view().label, 'Retry update'); assert.match(h.view().status, /Download failed/);
  await h.controller.prepare(); assert.equal(h.view().label, 'Restart to update');
  close(); h.state({status: 'error', error: 'The app could not be replaced. Try again.'});
  const recovered = harness({state: async () => ({status: 'error', error: 'The app could not be replaced. Try again.'})});
  close = recovered.controller.subscribe(() => {}); await settle();
  assert.equal(recovered.view().label, 'Check for updates'); assert.match(recovered.view().status, /could not be replaced/);
});

test('incomplete releases offer only View release and never start native preparation', async t => {
  const h = harness({check: async () => ({...available, asset: null})});
  const close = h.controller.subscribe(() => {}); t.after(close); await settle(); await h.controller.check();
  assert.equal(h.view().label, 'View release'); await h.controller.prepare(); assert.equal(h.calls.prepare, 0);
  await h.controller.open(); assert.equal(h.calls.open, 1);
});

test('restart remains single flight and a failed save keeps the staged update retryable', async t => {
  const h = harness(); h.state({status: 'ready', version: '1.0.1'});
  const close = h.controller.subscribe(() => {}); t.after(close); await settle();
  const saved = deferred(); let restarts = 0;
  const pending = h.controller.restart(async () => { restarts++; await saved.promise; });
  await h.controller.restart(async () => { restarts++; });
  assert.equal(restarts, 1); assert.equal(h.view().label, 'Saving…');
  saved.reject(new Error('Could not save your comment.')); await pending;
  assert.equal(h.view().label, 'Restart to update'); assert.match(h.view().status, /Could not save/);
  await h.controller.restart(async () => { restarts++; h.state({status: 'installing'}); });
  assert.equal(restarts, 2); assert.equal(h.view().label, 'Restarting…');
});

test('restart orders stroke acknowledgment, every draft, settings, then install', async () => {
  const stroke = deferred(), settings = deferred(), events = [];
  const task = restartAfterSaving({
    finishStroke: async () => { events.push('stroke'); await stroke.promise; events.push('ack'); },
    saveDrafts: async () => { events.push('drafts'); },
    saveSettings: async () => { events.push('settings'); await settings.promise; },
    install: async () => { events.push('install'); },
  });
  await settle(); assert.deepEqual(events, ['stroke']);
  stroke.resolve(); await settle(); assert.deepEqual(events, ['stroke', 'ack', 'drafts', 'settings']);
  settings.resolve(); await task; assert.equal(events.at(-1), 'install');
  for (const failure of ['finishStroke', 'saveDrafts', 'saveSettings']) {
    let installs = 0;
    const operations = {finishStroke: async () => {}, saveDrafts: async () => {}, saveSettings: async () => {}, install: async () => { installs++; }};
    operations[failure] = async () => { throw new Error(failure); };
    await assert.rejects(restartAfterSaving(operations), new RegExp(failure)); assert.equal(installs, 0);
  }
});

test('restart saves timerless drafts and revisits a draft changed while another write was pending', async () => {
  let drafts = [{id: 'failed-autosave', text: 'unsaved'}, {id: 'active', text: 'latest'}];
  const saves = [];
  await saveEveryDraft(() => drafts, async id => {
    const value = drafts.find(item => item.id === id); saves.push({...value});
    if (id === 'active') drafts = [{id: 'failed-autosave', text: 'arrived during save'}, value];
    return value;
  });
  assert.deepEqual(saves.map(value => value.text), ['unsaved', 'latest', 'arrived during save']);
});

test('settings barrier awaits pending writes and retains failed writes across unrelated successes', async () => {
  const writes = createSettingsWrites(), profile = deferred(); let attempts = 0;
  const pending = writes.run('profile', () => profile.promise);
  let flushed = false; const flushing = writes.flush().then(() => { flushed = true; });
  await settle(); assert.equal(flushed, false); profile.resolve(); await pending; await flushing;
  await assert.rejects(writes.run('appearance', async () => { if (++attempts < 3) throw new Error('Disk unavailable'); }));
  await writes.run('shortcuts', async () => {});
  await assert.rejects(writes.flush(), /Disk unavailable/); assert.equal(attempts, 2);
  await writes.flush(); assert.equal(attempts, 3);
  await writes.flush(); assert.equal(attempts, 3);
});

test('same-setting writes are ordered and flush includes writes added while waiting', async () => {
  const writes = createSettingsWrites(), first = deferred(), second = deferred(), events = [];
  const a = writes.run('profile', async () => { events.push('first'); await first.promise; });
  const b = writes.run('profile', async () => { events.push('second'); await second.promise; });
  const flush = writes.flush(); await settle(); assert.deepEqual(events, ['first']);
  first.resolve(); await a; await settle(); assert.deepEqual(events, ['first', 'second']);
  const last = deferred(); const c = writes.run('appearance', () => last.promise);
  second.resolve(); await b; let done = false; void flush.then(() => { done = true; }); await settle(); assert.equal(done, false);
  last.resolve(); await c; await flush; assert.equal(done, true);
});
