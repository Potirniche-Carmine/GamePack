import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {Button} from './components';
import {Icon, type IconName} from './Icon';
import {libraryContents, videoTitle} from './library';
import {useTheme} from './theme';
import type {Folder, Project, Video} from './types';

export type LibraryBrowserProps = {
  projects: Project[]; folders: Folder[]; videos: Video[];
  projectId: string | null; folderId: string | null; videoId?: string | null;
  compact?: boolean; disabled?: boolean;
  onOpenProject: (project: Project) => void; onOpenFolder: (folder: Folder) => void;
  onOpenRoot: () => void; onOpenVideo: (video: Video) => void;
  onNewProject: () => void; onImport: () => void; onCreateFolder: () => void;
  onRenameProject: (project: Project) => void; onDeleteProject: (project: Project) => void;
  onRenameFolder: (folder: Folder) => void; onDeleteFolder: (folder: Folder) => void;
  onMoveVideo: (video: Video) => void; onDeleteVideo: (video: Video) => void;
};

type ItemAction = {label: string; icon: IconName; onPress: () => void; danger?: boolean};

function LibraryItem({title, subtitle, icon, selected, compact, disabled, onPress, actions, tile}: {
  title: string; subtitle?: string; icon: IconName; selected?: boolean; compact?: boolean;
  disabled?: boolean; onPress: () => void; actions?: ItemAction[]; tile?: boolean;
}) {
  const {colors: c, styles: s} = useTheme();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [options, setOptions] = useState(false);
  return <View style={[local.item, tile && local.tile, tile && {borderColor: c.separator, backgroundColor: c.panel}, selected && {backgroundColor: c.selected}]}>
    <View style={[local.itemRow, hovered && !selected && {backgroundColor: c.inset}]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title}`} accessibilityState={{selected: !!selected, disabled: !!disabled}}
        disabled={disabled} focusable={!disabled} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={({pressed}) => [local.itemMain, compact && local.compactMain, tile && local.tileMain, focused && s.focusRing, pressed && {opacity: 0.7}]}>
        <View style={[local.itemIcon, compact && local.compactIcon, tile && local.tileIcon, !compact && {backgroundColor: c.inset}]}>
          <Icon name={icon} color={selected ? c.accentText : c.muted} />
        </View>
        <View style={local.itemText}><Text numberOfLines={tile ? 2 : 1} style={[local.itemTitle, compact && local.compactTitle, {color: selected ? c.accentText : c.text}]}>{title}</Text>
          {!!subtitle && <Text numberOfLines={1} style={[local.itemSubtitle, {color: c.muted}]}>{subtitle}</Text>}
        </View>
        {!compact && !tile && <Icon name="chevronRight" color={c.faint} />}
      </Pressable>
      {!!actions?.length && <Button quiet compact disabled={disabled} active={options} expanded={options} label={`Options for ${title}`} onPress={() => setOptions(value => !value)} style={local.optionsButton}>···</Button>}
    </View>
    {options && <View style={[local.itemActions, {borderTopColor: c.separator}]}>{actions?.map(action => <Button key={action.label} quiet compact icon={action.icon} danger={action.danger} disabled={disabled}
      onPress={() => { setOptions(false); action.onPress(); }}>{action.label}</Button>)}</View>}
  </View>;
}

export function LibraryBrowser(props: LibraryBrowserProps) {
  const {projects, folders, videos, projectId, folderId, videoId, compact = false, disabled = false} = props;
  const {colors: c, styles: s} = useTheme();
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [projectId, folderId]);
  const contents = useMemo(() => libraryContents(projects, folders, videos, projectId, folderId, query), [projects, folders, videos, projectId, folderId, query]);
  const project = projects.find(item => item.id === projectId);
  const folder = folders.find(item => item.id === folderId && item.project_id === projectId);
  const projectFolders = folders.filter(item => item.project_id === projectId);
  const projectActions = (item: Project): ItemAction[] => [
    {label: 'Rename', icon: 'pen', onPress: () => props.onRenameProject(item)},
    {label: 'Delete', icon: 'trash', danger: true, onPress: () => props.onDeleteProject(item)},
  ];
  const folderActions = (item: Folder): ItemAction[] => [
    {label: 'Rename', icon: 'pen', onPress: () => props.onRenameFolder(item)},
    {label: 'Remove folder', icon: 'trash', danger: true, onPress: () => props.onDeleteFolder(item)},
  ];
  const videoActions = (item: Video): ItemAction[] => [
    {label: 'Move', icon: 'folder', onPress: () => props.onMoveVideo(item)},
    {label: 'Delete', icon: 'trash', danger: true, onPress: () => props.onDeleteVideo(item)},
  ];
  const empty = !contents.projects.length && !contents.folders.length && !contents.videos.length;
  const searching = !!query.trim();
  const emptyTitle = searching ? 'No matches' : !project ? 'No projects yet' : folder ? 'This folder is empty' : 'No videos yet';
  const search = <View style={[local.search, compact && local.compactSearch, {backgroundColor: c.input, borderColor: c.separator}]}>
    <TextInput accessibilityLabel={project ? 'Search videos and folders' : 'Search projects'} placeholder={project ? 'Search videos and folders' : 'Search projects'}
      placeholderTextColor={c.faint} value={query} onChangeText={setQuery} style={[local.searchInput, {color: c.text}]} editable={!disabled} clearButtonMode="never" />
    {!!query && <Button quiet compact icon="close" label="Clear search" onPress={() => setQuery('')} />}
  </View>;

  return <View style={[local.browser, !compact && local.fullBrowser]}>
    {!compact && <View style={local.heading}>
      <Text numberOfLines={1} style={[local.headingTitle, {color: c.text}]}>{folder?.title || project?.title || 'Projects'}</Text>
      <View style={local.headingActions}>
        {project ? <><Button quiet icon="folder" disabled={disabled || !!folder} onPress={props.onCreateFolder}>New folder</Button><Button primary icon="plus" shortcut="import" disabled={disabled} onPress={props.onImport}>Add video</Button></>
          : <Button primary icon="plus" shortcut="newProject" disabled={disabled} onPress={props.onNewProject}>New project</Button>}
      </View>
    </View>}
    {!compact && search}
    <ScrollView style={local.scroll} contentContainerStyle={[local.content, compact && local.compactContent, !compact && empty && local.emptyScroll]} keyboardShouldPersistTaps="handled">
      {compact && <>
        <View style={local.sectionHeader}><Text style={[local.sectionTitle, {color: c.muted}]}>Projects</Text><Button quiet compact icon="plus" label="New project" shortcut="newProject" disabled={disabled} onPress={props.onNewProject} /></View>
        {projects.map(item => <LibraryItem key={item.id} compact title={item.title} icon="folder" selected={projectId === item.id} disabled={disabled} onPress={() => props.onOpenProject(item)} actions={projectActions(item)} />)}
        {!projects.length && <Button quiet icon="plus" disabled={disabled} onPress={props.onNewProject}>New project</Button>}
        {!!project && <>
          <View style={[local.sectionHeader, local.sectionGap]}><Text style={[local.sectionTitle, {color: c.muted}]} numberOfLines={1}>{project.title}</Text><Button quiet compact icon="plus" label="New folder" disabled={disabled} onPress={props.onCreateFolder} /></View>
          <LibraryItem compact title="Project overview" icon="library" selected={!folderId && !videoId} disabled={disabled} onPress={props.onOpenRoot} />
          {projectFolders.map(item => <LibraryItem key={item.id} compact title={item.title} icon="folder" selected={folderId === item.id} disabled={disabled} onPress={() => props.onOpenFolder(item)} actions={folderActions(item)} />)}
          <View style={local.sectionGap}>{search}</View>
        </>}
      </>}
      {!compact && !project && !!contents.projects.length && <View style={local.grid}>{contents.projects.map(item => <LibraryItem key={item.id} tile title={item.title} icon="folder" disabled={disabled} onPress={() => props.onOpenProject(item)} actions={projectActions(item)} />)}</View>}
      {!compact && !!contents.folders.length && <View style={local.folderList}>{contents.folders.map(item => <LibraryItem key={item.id} title={item.title} icon="folder" disabled={disabled} onPress={() => props.onOpenFolder(item)} actions={folderActions(item)} />)}</View>}
      {!!project && !!contents.videos.length && <View style={[local.videoList, !compact && {borderTopColor: c.separator, borderTopWidth: contents.folders.length ? 1 : 0}]}>
        {contents.videos.map(item => <LibraryItem key={item.id} title={videoTitle(item)} subtitle={searching && !folder ? projectFolders.find(location => location.id === item.folder_id)?.title : undefined}
          compact={compact} icon="video" selected={videoId === item.id} disabled={disabled} onPress={() => props.onOpenVideo(item)} actions={videoActions(item)} />)}
      </View>}
      {empty && (!compact || !!project) && <View style={[local.empty, compact && local.compactEmpty]}>
        {!compact && <View style={[local.emptyIcon, {backgroundColor: c.inset}]}><Icon name={project ? 'video' : 'folder'} color={c.muted} /></View>}
        <Text style={[local.emptyTitle, compact && local.compactEmptyTitle, {color: c.muted}]}>{emptyTitle}</Text>
        {!searching && (!compact || !!folder) && <Button quiet icon="plus" disabled={disabled} onPress={project ? props.onImport : props.onNewProject}>{project ? 'Add video' : 'New project'}</Button>}
      </View>}
    </ScrollView>
    {compact && !!project && <View style={[local.footer, {borderTopColor: c.separator}]}><Button primary icon="plus" shortcut="import" disabled={disabled} onPress={props.onImport}>Add video</Button></View>}
  </View>;
}

const local = StyleSheet.create({
  browser: {flex: 1, minHeight: 0},
  fullBrowser: {paddingHorizontal: 36, paddingTop: 30},
  heading: {flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 26, flexWrap: 'wrap'},
  headingTitle: {fontSize: 28, letterSpacing: -0.8, fontWeight: '600', flex: 1, minWidth: 160},
  headingActions: {flexDirection: 'row', alignItems: 'center', gap: 10},
  search: {height: 42, borderWidth: 1, borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginBottom: 22, maxWidth: 400},
  compactSearch: {height: 36, marginBottom: 7, marginHorizontal: 2, paddingHorizontal: 9},
  searchInput: {padding: 0, flex: 1, minWidth: 0, fontSize: 13, height: 36},
  scroll: {flex: 1},
  content: {paddingBottom: 30, gap: 4},
  compactContent: {paddingHorizontal: 10, paddingBottom: 16, gap: 2},
  emptyScroll: {flexGrow: 1},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 16},
  folderList: {gap: 4, marginBottom: 16},
  videoList: {paddingTop: 6},
  item: {borderRadius: 10, overflow: 'hidden'},
  tile: {width: 250, minHeight: 138, borderWidth: 1, borderRadius: 14},
  itemRow: {flexDirection: 'row', alignItems: 'center', borderRadius: 10},
  itemMain: {flex: 1, minWidth: 0, minHeight: 66, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 10},
  compactMain: {minHeight: 38, paddingVertical: 7, paddingHorizontal: 9, gap: 10},
  tileMain: {minHeight: 136, alignItems: 'flex-start', flexDirection: 'column', justifyContent: 'space-between', padding: 20, gap: 18},
  itemIcon: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10},
  compactIcon: {width: 18, height: 20, borderRadius: 0},
  tileIcon: {width: 38, height: 38},
  itemText: {flex: 1, minWidth: 0, gap: 4},
  itemTitle: {fontSize: 14, fontWeight: '500', lineHeight: 20, letterSpacing: -0.15},
  compactTitle: {fontSize: 12, lineHeight: 18},
  itemSubtitle: {fontSize: 12, lineHeight: 17},
  optionsButton: {minWidth: 28, width: 30, marginRight: 5, paddingHorizontal: 3, alignSelf: 'center'},
  itemActions: {paddingHorizontal: 8, paddingVertical: 7, flexDirection: 'row', flexWrap: 'wrap', gap: 4, borderTopWidth: 1},
  sectionHeader: {minHeight: 34, flexDirection: 'row', alignItems: 'center', paddingLeft: 9, gap: 4},
  sectionTitle: {flex: 1, fontSize: 11, fontWeight: '600'},
  sectionGap: {marginTop: 20},
  empty: {flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 18, paddingBottom: 52},
  compactEmpty: {minHeight: 90, padding: 16, paddingBottom: 16, gap: 12},
  emptyIcon: {width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center'},
  emptyTitle: {fontSize: 17, fontWeight: '500', letterSpacing: -0.3},
  compactEmptyTitle: {fontSize: 12},
  footer: {padding: 12, borderTopWidth: 1},
});
