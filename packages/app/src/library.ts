import type {Folder, Project, Video} from './types';

const byTitle = <T extends {id: string; title: string}>(a: T, b: T): number =>
  a.title.localeCompare(b.title, undefined, {numeric: true, sensitivity: 'base'}) || a.id.localeCompare(b.id);

export type LibraryContents = {projects: Project[]; folders: Folder[]; videos: Video[]};

/** A folder is a location within one project; an unscoped search never crosses projects. */
export function libraryContents(projects: readonly Project[], folders: readonly Folder[], videos: readonly Video[],
  projectId: string | null, folderId: string | null, query = ''): LibraryContents {
  const search = query.trim().toLocaleLowerCase();
  const matches = (title: string) => title.toLocaleLowerCase().includes(search);
  if (!projectId) return {projects: projects.filter(item => matches(item.title)).sort(byTitle), folders: [], videos: []};
  if (!projects.some(item => item.id === projectId)) return {projects: [], folders: [], videos: []};
  const projectFolders = folders.filter(item => item.project_id === projectId);
  if (folderId && !projectFolders.some(item => item.id === folderId)) return {projects: [], folders: [], videos: []};
  const folderTitles = new Map(projectFolders.map(item => [item.id, item.title]));
  return {
    projects: [],
    folders: folderId ? [] : projectFolders.filter(item => matches(item.title)).sort(byTitle),
    videos: videos.filter(item => item.project_id === projectId && (
      folderId ? item.folder_id === folderId && matches(item.title)
        : search ? matches(item.title) || matches(folderTitles.get(item.folder_id ?? '') ?? '')
          : !item.folder_id
    )).sort(byTitle),
  };
}

export function videoTitle(video: Pick<Video, 'title'>): string {
  return video.title.replace(/\.(mp4|m4v|mov|avi|mkv|webm|mpeg|mpg|m2ts|mts)$/i, '') || video.title;
}
