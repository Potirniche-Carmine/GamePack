import {NativeModules, requireNativeComponent, type NativeSyntheticEvent, type ViewProps} from 'react-native';
import type {DrawingTool, PlayerTime} from './types';

type NativeBridge = {
  command(request: string): Promise<string>;
  chooseVideo(): Promise<string | null>;
  dataDirectory(): Promise<string>;
};

function bridge(): NativeBridge {
  const native = NativeModules.GamePack as NativeBridge | undefined;
  if (!native) throw new Error('The GamePack native module is unavailable. Launch the macOS app through its native build.');
  return native;
}

export async function dataDirectory(): Promise<string> { return bridge().dataDirectory(); }
export async function chooseVideo(): Promise<string | null> { return bridge().chooseVideo(); }
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
  onTime: (event: NativeSyntheticEvent<PlayerTime>) => void;
  onDrawing: (event: NativeSyntheticEvent<{drawingJson: string}>) => void;
};
export const GamePackPlayer = requireNativeComponent<PlayerProps>('GamePackPlayer');
