import {NativeModules, requireNativeComponent, type NativeSyntheticEvent, type ViewProps} from 'react-native';
import type {CaptureFinished, DrawingTool, PlayerTime, ThemeChoice} from './types';

type NativeBridge = {
  command(request: string): Promise<string>;
  chooseVideo(): Promise<string | null>;
  dataDirectory(): Promise<string>;
  setAppearance(theme: ThemeChoice): void;
};

function bridge(): NativeBridge {
  const native = NativeModules.GamePack as NativeBridge | undefined;
  if (!native) throw new Error('The GamePack native module is unavailable. Launch the installed desktop app.');
  return native;
}

export async function dataDirectory(): Promise<string> { return bridge().dataDirectory(); }
export async function chooseVideo(): Promise<string | null> { return bridge().chooseVideo(); }
export function setAppearance(theme: ThemeChoice): void { bridge().setAppearance(theme); }
export async function command<T>(_root: string, name: string, fields: Record<string, unknown> = {}): Promise<T> {
  // The native bridge resolves GAMEPACK_HOME and passes root separately to Rust.
  const raw = await bridge().command(JSON.stringify({command: name, ...fields}));
  const response = JSON.parse(raw) as {ok: boolean; data?: T; error?: string};
  if (!response.ok) throw new Error(response.error || 'The operation could not be completed.');
  return response.data as T;
}

export type PlayerProps = ViewProps & {
  source: string; paused: boolean; rate: number; seekUs: number; seekToken: number;
  reviewEndUs: number; sceneJson: string; tool: DrawingTool; strokeColor: string;
  captureToken: number;
  onCaptureFinished: (event: NativeSyntheticEvent<CaptureFinished>) => void;
  onTime: (event: NativeSyntheticEvent<PlayerTime>) => void;
  onDrawing: (event: NativeSyntheticEvent<{drawingJson: string}>) => void;
};
export const GamePackPlayer = requireNativeComponent<PlayerProps>('GamePackPlayer');
