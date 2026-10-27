import {NativeModules, NativeEventEmitter, requireNativeComponent, type NativeSyntheticEvent, type ViewProps} from 'react-native';
import type {CaptureReady, StrokeFlushFinished, DrawingTool, PlayerTime, ThemeChoice} from './types';
import type {AppBuild} from './updates';
import type {NativeUpdateState} from './updateFlow';

type NativeBridge = {
  command(request: string): Promise<string>;
  chooseVideo(): Promise<string | null>;
  dataDirectory(): Promise<string>;
  appBuild(): Promise<AppBuild>;
  prepareUpdate(tag: string): Promise<void>;
  updateState(): Promise<NativeUpdateState>;
  installUpdate(): Promise<void>;
  openUpdateRelease(tag: string, download: boolean): Promise<void>;
  thumbnails(path: string, mediaId: string): Promise<string[]>;
  configureShortcuts(chords: string[], recording: boolean, typingShortcut: string): void;
  configureDrawingHistory?(canUndo: boolean, canRedo: boolean): void;
  setAppearance(theme: ThemeChoice): void;
  setFullScreen(enabled: boolean): void;
  measureCommentInput?(reactTag: number): Promise<number | null>;
};

function bridge(): NativeBridge {
  const native = NativeModules.GamePack as NativeBridge | undefined;
  if (!native) throw new Error('The GamePack native module is unavailable. Launch the installed desktop app.');
  return native;
}

export async function dataDirectory(): Promise<string> { return bridge().dataDirectory(); }
export async function appBuild(): Promise<AppBuild> { return bridge().appBuild(); }
export async function prepareUpdate(tag: string): Promise<void> { return bridge().prepareUpdate(tag); }
export async function updateState(): Promise<NativeUpdateState> { return bridge().updateState(); }
export async function installUpdate(): Promise<void> { return bridge().installUpdate(); }
export async function openUpdateRelease(tag: string, download: boolean): Promise<void> { return bridge().openUpdateRelease(tag, download); }
export async function chooseVideo(): Promise<string | null> { return bridge().chooseVideo(); }
export async function videoThumbnails(path: string, mediaId: string): Promise<string[]> {
  try { return await bridge().thumbnails(path, mediaId); } catch { return []; }
}
export function setAppearance(theme: ThemeChoice): void { bridge().setAppearance(theme); }
export function setFullScreen(enabled: boolean): void { bridge().setFullScreen(enabled); }
export async function measureCommentInput(reactTag: number | null): Promise<number | null> { return reactTag === null ? null : await bridge().measureCommentInput?.(reactTag) ?? null; }
export async function command<T>(_root: string, name: string, fields: Record<string, unknown> = {}): Promise<T> {
  // The native bridge resolves GAMEPACK_HOME and passes root separately to Rust.
  const raw = await bridge().command(JSON.stringify({command: name, ...fields}));
  const response = JSON.parse(raw) as {ok: boolean; data?: T; error?: string};
  if (!response.ok) throw new Error(response.error || 'The operation could not be completed.');
  return response.data as T;
}

export type PlayerProps = ViewProps & {
  source: string; paused: boolean; rate: number; zoom: number; zoomToken: number; seekUs: number; seekToken: number;
  reviewEndUs: number; sceneJson: string; presentedSceneKey: string; tool: DrawingTool;
  flushToken: number; stepToken: number; stepFrames: number;
  captureToken: number;
  onCaptureReady: (event: NativeSyntheticEvent<CaptureReady>) => void;
  onStrokeFlushFinished: (event: NativeSyntheticEvent<StrokeFlushFinished>) => void;
  onTime: (event: NativeSyntheticEvent<PlayerTime>) => void;
  onDrawing: (event: NativeSyntheticEvent<{drawingJson: string}>) => void;
  onDrawingStart: (event: NativeSyntheticEvent<{time_us: number; paused: boolean}>) => void;
  onPointer: (event: NativeSyntheticEvent<{x: number; y: number}>) => void;
  onSceneReady: (event: NativeSyntheticEvent<{key: string}>) => void;
  onActivity: (event: NativeSyntheticEvent<{}>) => void;
  onZoom: (event: NativeSyntheticEvent<{zoom: number; zoomToken: number}>) => void;
};
export const GamePackPlayer = requireNativeComponent<PlayerProps>('GamePackPlayer');
export const GamePackGlass = requireNativeComponent<ViewProps & {dark: boolean; cornerRadius: number; desktop?: boolean}>('GamePackGlass');

export function configureShortcuts(chords: string[], recording: boolean, typingShortcut: string) {
  bridge().configureShortcuts(chords, recording, typingShortcut);
}
export function configureDrawingHistory(canUndo: boolean, canRedo: boolean) { bridge().configureDrawingHistory?.(canUndo, canRedo); }
export function listenShortcuts(callback: (event: import('./shortcuts').ShortcutEvent) => void) {
  const emitter = new NativeEventEmitter(NativeModules.GamePack);
  return emitter.addListener('GamePackShortcut', callback);
}
export function listenWindowState(callback: (event: {fullScreen?: boolean}) => void) {
  return new NativeEventEmitter(NativeModules.GamePack).addListener('GamePackWindowState', callback);
}
