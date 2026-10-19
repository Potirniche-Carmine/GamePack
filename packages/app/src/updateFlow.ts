import type {AppBuild, UpdateResult} from './updates';

export type NativeUpdateState = {
  status: 'idle' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error';
  version?: string; error?: string; progress?: number;
};
export type UpdateSnapshot = {
  build: AppBuild | null; release: UpdateResult | null; native: NativeUpdateState;
  loaded: boolean; stateError: boolean; checking: boolean; action: 'prepare' | 'restart' | 'open' | null; error: string;
};
type Operations = {
  build: () => Promise<AppBuild>;
  check: (build: AppBuild, signal: AbortSignal) => Promise<UpdateResult>;
  state: () => Promise<NativeUpdateState>;
  prepare: (tag: string) => Promise<void>;
  open: (tag: string) => Promise<void>;
};
const running = (state: NativeUpdateState) => ['downloading', 'verifying', 'installing'].includes(state.status);
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The update could not be completed. Try again.';

// One instance lives outside Settings. Native owns the download and staged files;
// this controller only observes them while the footer is visible.
export function createUpdateController(operations: Operations, pollMs = 500) {
  let snapshot: UpdateSnapshot = {build: null, release: null, native: {status: 'idle'}, loaded: false, stateError: false, checking: false, action: null, error: ''};
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0, reading = 0;
  let request: AbortController | null = null;
  const publish = (change: Partial<UpdateSnapshot>) => {
    snapshot = {...snapshot, ...change};
    listeners.forEach(listener => listener());
  };
  const stopTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const refresh = async () => {
    stopTimer();
    const ownGeneration = generation, ownRead = ++reading;
    try {
      const state = await operations.state();
      if (ownGeneration !== generation || ownRead !== reading) return;
      // Acceptance may race the first read. Keep visible progress and the action
      // lock until native leaves idle or prepareUpdate finishes.
      const native = snapshot.action === 'prepare' && state.status === 'idle' ? snapshot.native : state;
      publish({native, loaded: true, stateError: false, ...(snapshot.stateError ? {error: ''} : {})});
    } catch (cause) {
      if (ownGeneration !== generation || ownRead !== reading) return;
      publish({loaded: true, stateError: true, error: message(cause)});
    }
    if (ownGeneration === generation && ownRead === reading && listeners.size && (running(snapshot.native) || snapshot.action === 'prepare') && !snapshot.stateError) {
      timer = setTimeout(() => { timer = undefined; void refresh(); }, pollMs);
    }
  };
  const available = () => snapshot.release?.kind === 'available' ? snapshot.release : null;
  const locked = () => !snapshot.loaded || snapshot.checking || snapshot.action !== null || (!snapshot.stateError && running(snapshot.native));
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        ++generation;
        // Local bridge reads only. Checking GitHub always requires a press.
        void operations.build().then(build => publish({build})).catch(() => {});
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { ++generation; ++reading; stopTimer(); request?.abort(); request = null; publish({checking: false}); }
      };
    },
    async check() {
      if (locked()) return;
      if (snapshot.stateError) { publish({error: ''}); await refresh(); return; }
      if (snapshot.native.status === 'ready') return;
      const ownRequest = new AbortController(), ownGeneration = generation;
      request = ownRequest;
      publish({checking: true, error: '', release: null});
      try {
        const build = snapshot.build ?? await operations.build();
        if (ownRequest.signal.aborted) return;
        publish({build});
        const release = await operations.check(build, ownRequest.signal);
        if (!ownRequest.signal.aborted && ownGeneration === generation) publish({release, native: {status: 'idle'}});
      } catch (cause) {
        if (!ownRequest.signal.aborted && ownGeneration === generation) publish({error: message(cause)});
      } finally {
        if (request === ownRequest) { request = null; publish({checking: false}); }
      }
    },
    async prepare() {
      const release = available();
      if (locked() || snapshot.stateError || !release?.asset || snapshot.native.status === 'ready') return;
      publish({action: 'prepare', error: '', native: {status: 'downloading', version: release.version}});
      stopTimer(); ++reading;
      try {
        const pending = operations.prepare(release.tag);
        if (listeners.size) void refresh();
        await pending;
      } catch (cause) {
        stopTimer(); ++reading;
        publish({native: {status: 'error', version: release.version, error: message(cause)}});
      }
      finally { publish({action: null}); }
      if (snapshot.native.status !== 'error' && listeners.size) await refresh();
    },
    async restart(restart: () => Promise<void>) {
      if (locked() || snapshot.stateError || snapshot.native.status !== 'ready') return;
      publish({action: 'restart', error: ''});
      try {
        // The caller flushes held ink and saves all work before invoking native install.
        await restart();
        publish({native: {...snapshot.native, status: 'installing'}});
      } catch (cause) { publish({error: message(cause)}); }
      finally { publish({action: null}); }
      if (listeners.size) await refresh();
    },
    async open() {
      const release = available();
      if (locked() || !release || release.asset) return;
      publish({action: 'open', error: ''});
      try { await operations.open(release.tag); }
      catch (cause) { publish({error: message(cause)}); }
      finally { publish({action: null}); }
    },
  };
}
export type UpdateController = ReturnType<typeof createUpdateController>;

export function updatePresentation(snapshot: UpdateSnapshot) {
  const {native, release, build, action, checking} = snapshot;
  const version = native.version || (release?.kind === 'available' ? release.version : undefined);
  let label = 'Check for updates', press: 'check' | 'prepare' | 'restart' | 'open' = 'check';
  if (snapshot.stateError) label = 'Retry';
  else if (action === 'restart') label = 'Saving…';
  else if (native.status === 'installing') label = 'Restarting…';
  else if (native.status === 'downloading') label = Number.isFinite(native.progress) ? `Downloading ${Math.round(Math.max(0, Math.min(1, native.progress!)) * 100)}%` : 'Downloading…';
  else if (native.status === 'verifying') label = 'Verifying…';
  else if (native.status === 'ready') { label = 'Restart to update'; press = 'restart'; }
  else if (checking) label = 'Checking…';
  else if (action === 'open') label = 'Opening…';
  else if (release?.kind === 'available') {
    label = release.asset ? native.status === 'error' ? 'Retry update' : 'Update' : 'View release';
    press = release.asset ? 'prepare' : 'open';
  }
  const error = snapshot.error || (native.status === 'error' ? native.error || 'The update failed. Try again.' : '');
  const status = error || (release?.kind === 'current' ? 'No updates available.' : release?.kind === 'unpublished' ? 'No published release is available yet.' : '');
  return {
    title: version ? `Version ${version}` : build ? `GamePack ${build.version}` : 'GamePack',
    label, press, status, error: !!error,
    disabled: !snapshot.loaded || checking || action !== null || (!snapshot.stateError && running(native)),
    primary: press === 'prepare' || press === 'restart',
  };
}
