export type Anchor = {kind: 'point'; at_us: number};
export type DrawingTool = 'none' | 'pointer' | 'laser' | 'pen' | 'arrow' | 'ellipse';
export type Drawing = {
  id: string;
  tool: Exclude<DrawingTool, 'none' | 'pointer' | 'laser'>;
  width: number;
  samples: {x: number; y: number}[];
};
export type Project = {id: string; title: string; created_at: number};
export type Folder = {id: string; project_id: string; title: string; created_at: number};
export type Video = {
  id: string; project_id: string; folder_id: string | null; media_id: string; title: string; path: string;
  byte_size: number; duration_us: number; width: number; height: number;
};
export type Profile = {author_id: string; name: string};
export type ThemeChoice = 'system' | 'light' | 'dark';
export type Settings = {theme: ThemeChoice; keybindings: Record<string, string | null>};
export type Position = {x: number; y: number};
export type Draft = {
  id: string; project_id: string; video_id: string; text: string; anchor: Anchor;
  parent_comment_id?: string | null; drawings: Drawing[];
  position?: Position | null;
};
export type Comment = Draft & {
  comment_id: string; media_id: string; author_id: string; name_at_posting: string;
  created_at_reported: number; digest: string; schema_version: 2;
};
export type Bootstrap = {
  settings: Settings;
  profile: Profile; projects: Project[]; folders: Folder[]; videos: Video[]; comments: Comment[]; drafts: Draft[];
  storage: {root: string; managed_bytes: number; database_bytes: number};
};
export type StrokeFlushFinished = {flushToken: number; time_us: number; drawingJson?: string};
export type PlayerTime = {
  time_us: number; duration_us: number; width: number; height: number;
  seekToken: number; playing: boolean; ended?: boolean; error?: string;
};
