export type Anchor =
  | {kind: 'point'; at_us: number}
  | {kind: 'interval'; start_us: number; end_us: number};
export type DrawingTool = 'none' | 'pen' | 'arrow' | 'ellipse';
export type Drawing = {
  id: string;
  tool: Exclude<DrawingTool, 'none'>;
  color: string;
  width: number;
  visible_from_us: number;
  visible_until_us: number;
  samples: {x: number; y: number; t_us: number}[];
};
export type Project = {id: string; title: string; created_at: number};
export type Video = {
  id: string; project_id: string; media_id: string; title: string; path: string;
  byte_size: number; duration_us: number; width: number; height: number;
};
export type Profile = {author_id: string; name: string};
export type ThemeChoice = 'system' | 'light' | 'dark';
export type Settings = {theme: ThemeChoice};
export type Draft = {
  id: string; project_id: string; video_id: string; text: string; anchor: Anchor;
  parent_comment_id?: string | null; drawings: Drawing[];
};
export type Comment = Draft & {
  comment_id: string; media_id: string; author_id: string; name_at_posting: string;
  created_at_reported: number; digest: string; schema_version: 1;
};
export type Bootstrap = {
  settings: Settings;
  profile: Profile; projects: Project[]; videos: Video[]; comments: Comment[]; drafts: Draft[];
  storage: {root: string; managed_bytes: number; database_bytes: number};
};
export type CaptureFinished = {captureToken: number; time_us: number; drawingJson?: string};
export type PlayerTime = {
  time_us: number; duration_us: number; width: number; height: number;
  playing: boolean; ended?: boolean; error?: string;
};
