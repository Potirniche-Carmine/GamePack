import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button, TextField} from './components';
import {Icon, type IconName} from './Icon';
import {libraryContents, videoTitle} from './library';
import {LibraryMenu, type LibraryAction, type LibraryMenuState} from './LibraryMenu';
import {MotionPressable} from './motion';
import {useTheme} from './theme';
import type {Folder, Project, Video} from './types';

export type LibraryBrowserProps = {
  projects: Project[]; folders: Folder[]; videos: Video[];
  projectId: string | null; folderId: string | null; videoId?: string | null;
  compact?: boolean; disabled?: boolean; onMenuOpenChange?: (open: boolean) => void;
  onOpenProject: (project: Project) => void; onOpenFolder: (folder: Folder) => void;
  onOpenRoot: () => void; onOpenVideo: (video: Video) => void;
  onNewProject: () => void; onImport: () => void; onCreateFolder: () => void;
  onRenameProject: (project: Project) => void; onDeleteProject: (project: Project) => void;
  onRenameFolder: (folder: Folder) => void; onDeleteFolder: (folder: Folder) => void;
  onMoveVideo: (video: Video) => void; onDeleteVideo: (video: Video) => void;
};

type MenuRequest = {id: string; title: string; actions: LibraryAction[]; trigger: View; keyboard: boolean};
type ItemProps = {
  id: string; title: string; subtitle?: string; icon: IconName; selected?: boolean; compact?: boolean;
  disabled?: boolean; onPress: () => void; actions?: LibraryAction[]; tileWidth?: number;
  menuId?: string; onOpenMenu: (request: MenuRequest) => void;
};

function LibraryItem({id, title, subtitle, icon, selected, compact, disabled, onPress, actions, tileWidth, menuId, onOpenMenu}: ItemProps) {
  const {colors: c, styles: s} = useTheme();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [optionsHovered, setOptionsHovered] = useState(false);
  const [optionsFocused, setOptionsFocused] = useState(false);
  const options = useRef<View>(null);
  const tile = tileWidth !== undefined;
  const menuOpen = menuId === id;
  return <View style={[local.item, tile && local.tile, tile && {width: tileWidth, borderColor: focused ? c.selectedLine : c.separator, backgroundColor: c.panel},
    selected && {backgroundColor: c.selected}]}>
    <Pressable {...{enableFocusRing: false}} accessibilityRole="button" accessibilityLabel={`Open ${title}`} accessibilityState={{selected: !!selected, disabled: !!disabled}}
      disabled={disabled} focusable={!disabled} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({pressed}) => [local.itemMain, compact && local.compactMain, tile && local.tileMain,
        hovered && !selected && {backgroundColor: c.inset}, focused && !tile && s.focusRing, pressed && {backgroundColor: c.selected}]}>
      <View style={[local.itemIcon, compact && local.compactIcon, tile && local.tileIcon, !compact && {backgroundColor: c.inset}]}>
        <Icon name={icon} color={selected ? c.accentText : c.muted} />
      </View>
      <View style={[local.itemText, tile && local.tileText]}>
        <Text numberOfLines={tile ? 2 : 1} style={[local.itemTitle, compact && local.compactTitle, tile && local.tileTitle, {color: selected ? c.accentText : c.text}]}>{title}</Text>
        {!!subtitle && <Text numberOfLines={1} style={[local.itemSubtitle, {color: c.muted}]}>{subtitle}</Text>}
      </View>
      {!compact && !tile && <View style={local.rowChevron}><Icon name="chevronRight" color={c.faint} /></View>}
    </Pressable>
    {!!actions?.length && <MotionPressable ref={options} disabled={disabled} focusable={!disabled}
      accessibilityRole="button" accessibilityLabel={`Options for ${title}`} accessibilityState={{expanded: menuOpen, disabled: !!disabled}}
      onHoverIn={() => setOptionsHovered(true)} onHoverOut={() => setOptionsHovered(false)}
      onFocus={() => setOptionsFocused(true)} onBlur={() => setOptionsFocused(false)}
      onPress={event => { if (options.current) onOpenMenu({id, title, actions, trigger: options.current, keyboard: 'key' in event.nativeEvent}); }}
      style={({pressed}) => [local.optionsButton, tile && local.tileOptions, compact && local.compactOptions,
        (optionsHovered || menuOpen || pressed) && {backgroundColor: c.selected}, optionsFocused && s.focusRing]}>
      <View style={local.dots} pointerEvents="none">{[0, 1, 2].map(dot => <View key={dot} style={[local.dot, {backgroundColor: c.muted}]} />)}</View>
    </MotionPressable>}
  </View>;
}

export function LibraryBrowser(props: LibraryBrowserProps) {
  const {projects, folders, videos, projectId, folderId, videoId, compact = false, disabled = false} = props;
  const {colors: c} = useTheme();
  const root = useRef<View>(null);
  const [bounds, setBounds] = useState({width: 1040, height: 600});
  const [menu, setMenu] = useState<LibraryMenuState | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => { setQuery(''); setMenu(null); }, [projectId, folderId]);
  useEffect(() => { if (disabled) setMenu(null); }, [disabled]);
  useEffect(() => {
    props.onMenuOpenChange?.(!!menu);
    return () => props.onMenuOpenChange?.(false);
  }, [!!menu, props.onMenuOpenChange]);
  const contents = useMemo(() => libraryContents(projects, folders, videos, projectId, folderId, query), [projects, folders, videos, projectId, folderId, query]);
  const project = projects.find(item => item.id === projectId);
  const folder = folders.find(item => item.id === folderId && item.project_id === projectId);
  const projectFolders = folders.filter(item => item.project_id === projectId);
  const projectActions = (item: Project): LibraryAction[] => [
    {label: 'Rename', icon: 'pen', onPress: () => props.onRenameProject(item)},
    {label: 'Delete', icon: 'trash', danger: true, onPress: () => props.onDeleteProject(item)},
  ];
  const folderActions = (item: Folder): LibraryAction[] => [
    {label: 'Rename', icon: 'pen', onPress: () => props.onRenameFolder(item)},
    {label: 'Remove folder', icon: 'trash', danger: true, onPress: () => props.onDeleteFolder(item)},
  ];
  const videoActions = (item: Video): LibraryAction[] => [
    {label: 'Move', icon: 'folder', onPress: () => props.onMoveVideo(item)},
    {label: 'Delete', icon: 'trash', danger: true, onPress: () => props.onDeleteVideo(item)},
  ];
  const dismissMenu = (restoreFocus = false) => {
    const trigger = menu?.trigger;
    setMenu(null);
    if (restoreFocus) requestAnimationFrame(() => trigger?.focus());
  };
  const openMenu = (request: MenuRequest) => {
    if (menu?.id === request.id) { dismissMenu(true); return; }
    root.current?.measureInWindow((rootX, rootY) => request.trigger.measureInWindow((x, y, width, height) => {
      const menuHeight = request.actions.length * 36 + 12;
      const below = y - rootY + height + 6;
      setMenu({...request,
        x: Math.max(8, Math.min(bounds.width - 204, x - rootX + width - 196)),
        y: Math.max(8, below + menuHeight > bounds.height - 8 ? y - rootY - menuHeight - 6 : below),
      });
    }));
  };
  const itemProps = {disabled: disabled || !!menu, onOpenMenu: openMenu, menuId: menu?.id};
  const empty = !contents.projects.length && !contents.folders.length && !contents.videos.length;
  const searching = !!query.trim();
  const emptyTitle = searching ? 'No matches' : !project ? 'No projects yet' : folder ? 'This folder is empty' : 'No videos yet';
  const contentWidth = Math.max(0, Math.min(1040, bounds.width - 64));
  const columns = contentWidth < 560 ? 1 : contentWidth < 900 || contents.projects.length <= 2 ? 2 : 3;
  const tileWidth = (contentWidth - (columns - 1) * 16) / columns;
  const search = <View style={[local.search, compact && local.compactSearch]}>
    <TextField accessibilityLabel={project ? 'Search videos and folders' : 'Search projects'} placeholder={project ? 'Search videos and folders' : 'Search projects'}
      value={query} onChangeText={value => {setQuery(value); setMenu(null);}} style={[local.searchField, {borderColor: c.separator}, !!query && local.searchWithClear]}
      inputStyle={local.searchInput} editable={!disabled && !menu} clearButtonMode="never" />
    {!!query && <View style={local.clearSearch}><Button quiet compact icon="close" label="Clear search" disabled={disabled || !!menu} onPress={() => setQuery('')} /></View>}
  </View>;

  return <View ref={root} style={[local.browser, !compact && local.fullBrowser]}
    onLayout={event => { const {width, height} = event.nativeEvent.layout; setBounds({width, height}); setMenu(null); }}>
    {!compact && <View style={local.widthConstraint}>
      <View style={local.heading}>
        <Text numberOfLines={1} style={[local.headingTitle, {color: c.text}]}>{folder?.title || project?.title || 'Projects'}</Text>
        <View style={local.headingActions}>
          {project ? <>{!folder && <Button quiet icon="folder" disabled={disabled || !!menu} onPress={props.onCreateFolder}>New folder</Button>}{(!empty || searching) && <Button primary icon="plus" shortcut="import" disabled={disabled || !!menu} onPress={props.onImport}>Add video</Button>}</>
            : (!empty || searching) && <Button primary icon="plus" shortcut="newProject" disabled={disabled || !!menu} onPress={props.onNewProject}>New project</Button>}
        </View>
      </View>
      {search}
    </View>}
    <ScrollView style={[local.scroll, !compact && local.widthConstraint]} contentContainerStyle={[local.content, compact && local.compactContent, !compact && empty && local.emptyScroll]}
      keyboardShouldPersistTaps="handled" onScrollBeginDrag={() => dismissMenu()}>
      {compact && <>
        <View style={local.sectionHeader}><Text style={[local.sectionTitle, {color: c.muted}]}>Projects</Text><Button quiet compact icon="plus" label="New project" shortcut="newProject" disabled={disabled || !!menu} onPress={props.onNewProject} /></View>
        {projects.map(item => <LibraryItem key={item.id} {...itemProps} id={item.id} compact title={item.title} icon="folder" selected={projectId === item.id} onPress={() => props.onOpenProject(item)} actions={projectActions(item)} />)}
        {!projects.length && <Button quiet icon="plus" disabled={disabled || !!menu} onPress={props.onNewProject}>New project</Button>}
        {!!project && <>
          <View style={[local.sectionHeader, local.sectionGap]}><Text style={[local.sectionTitle, {color: c.muted}]} numberOfLines={1}>{project.title}</Text><Button quiet compact icon="plus" label="New folder" disabled={disabled || !!menu} onPress={props.onCreateFolder} /></View>
          <LibraryItem {...itemProps} id="root" compact title="Project overview" icon="library" selected={!folderId && !videoId} onPress={props.onOpenRoot} />
          {projectFolders.map(item => <LibraryItem key={item.id} {...itemProps} id={item.id} compact title={item.title} icon="folder" selected={folderId === item.id} onPress={() => props.onOpenFolder(item)} actions={folderActions(item)} />)}
          <View style={local.sectionGap}>{search}</View>
        </>}
      </>}
      {!compact && !project && !!contents.projects.length && <View style={local.grid}>{contents.projects.map(item => <LibraryItem key={item.id} {...itemProps} id={item.id} tileWidth={tileWidth} title={item.title} icon="folder" onPress={() => props.onOpenProject(item)} actions={projectActions(item)} />)}</View>}
      {!compact && !!contents.folders.length && <View style={local.folderList}>{contents.folders.map(item => <LibraryItem key={item.id} {...itemProps} id={item.id} title={item.title} icon="folder" onPress={() => props.onOpenFolder(item)} actions={folderActions(item)} />)}</View>}
      {!!project && !!contents.videos.length && <View style={[local.videoList, !compact && {borderTopColor: c.separator, borderTopWidth: contents.folders.length ? 1 : 0}]}>
        {contents.videos.map(item => <LibraryItem key={item.id} {...itemProps} id={item.id} title={videoTitle(item)} subtitle={searching && !folder ? projectFolders.find(location => location.id === item.folder_id)?.title : undefined}
          compact={compact} icon="video" selected={videoId === item.id} onPress={() => props.onOpenVideo(item)} actions={videoActions(item)} />)}
      </View>}
      {empty && (!compact || !!project) && <View style={[local.empty, compact && local.compactEmpty]}>
        {!compact && <View style={[local.emptyIcon, {backgroundColor: c.inset}]}><Icon name={project ? 'video' : 'folder'} color={c.muted} /></View>}
        <Text style={[local.emptyTitle, compact && local.compactEmptyTitle, {color: c.muted}]}>{emptyTitle}</Text>
        {!searching && (!compact || !!folder) && <Button quiet icon="plus" disabled={disabled || !!menu} onPress={project ? props.onImport : props.onNewProject}>{project ? 'Add video' : 'New project'}</Button>}
      </View>}
    </ScrollView>
    {compact && !!project && <View style={[local.footer, {borderTopColor: c.separator}]}><Button primary icon="plus" shortcut="import" disabled={disabled || !!menu} onPress={props.onImport}>Add video</Button></View>}
    {menu && <LibraryMenu key={menu.id} menu={menu} onDismiss={dismissMenu} />}
  </View>;
}

const local = StyleSheet.create({
  browser: {flex: 1, minHeight: 0},
  fullBrowser: {paddingHorizontal: 32, paddingTop: 38},
  widthConstraint: {width: '100%', maxWidth: 1040, alignSelf: 'center'},
  heading: {flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 24},
  headingTitle: {fontSize: 27, lineHeight: 34, letterSpacing: -0.8, fontWeight: '600', flex: 1, minWidth: 0},
  headingActions: {flexDirection: 'row', alignItems: 'center', gap: 10},
  search: {width: '100%', maxWidth: 360, marginBottom: 26},
  compactSearch: {maxWidth: undefined, marginBottom: 7, paddingHorizontal: 2},
  searchField: {height: 40, minHeight: 40, paddingVertical: 0, borderRadius: 10},
  searchWithClear: {paddingRight: 38},
  searchInput: {fontSize: 13, lineHeight: 20},
  clearSearch: {position: 'absolute', top: 4, right: 4, bottom: 4, justifyContent: 'center'},
  scroll: {flex: 1},
  content: {paddingBottom: 32, gap: 4},
  compactContent: {paddingHorizontal: 10, paddingBottom: 16, gap: 2},
  emptyScroll: {flexGrow: 1},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 16},
  folderList: {gap: 4, marginBottom: 14},
  videoList: {paddingTop: 6},
  item: {borderRadius: 11},
  tile: {height: 154, borderWidth: 1, borderRadius: 15, overflow: 'hidden'},
  itemMain: {minWidth: 0, minHeight: 68, paddingLeft: 14, paddingRight: 52, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 10},
  compactMain: {minHeight: 40, paddingVertical: 8, paddingLeft: 9, paddingRight: 38, gap: 10},
  tileMain: {height: 152, alignItems: 'flex-start', flexDirection: 'column', justifyContent: 'space-between', padding: 22, gap: 18},
  itemIcon: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 11},
  compactIcon: {width: 18, height: 20, borderRadius: 0},
  tileIcon: {width: 40, height: 40},
  itemText: {flex: 1, minWidth: 0, gap: 4},
  tileText: {flex: 0, paddingRight: 4},
  itemTitle: {fontSize: 14, fontWeight: '500', lineHeight: 20, letterSpacing: -0.15},
  tileTitle: {fontSize: 16, lineHeight: 22, letterSpacing: -0.25, fontWeight: '600'},
  compactTitle: {fontSize: 12, lineHeight: 18},
  itemSubtitle: {fontSize: 12, lineHeight: 17},
  rowChevron: {marginRight: 6},
  optionsButton: {position: 'absolute', width: 32, height: 32, right: 8, top: 18, borderRadius: 8, alignItems: 'center', justifyContent: 'center'},
  compactOptions: {width: 28, height: 28, top: 6, right: 4},
  tileOptions: {top: 26, right: 20},
  dots: {flexDirection: 'row', alignItems: 'center', gap: 3},
  dot: {height: 3, width: 3, borderRadius: 1.5},
  sectionHeader: {minHeight: 34, flexDirection: 'row', alignItems: 'center', paddingLeft: 9, gap: 4},
  sectionTitle: {flex: 1, fontSize: 11, fontWeight: '600'},
  sectionGap: {marginTop: 20},
  empty: {flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 16, paddingBottom: 78},
  compactEmpty: {minHeight: 90, padding: 16, paddingBottom: 16, gap: 12},
  emptyIcon: {width: 62, height: 62, borderRadius: 18, alignItems: 'center', justifyContent: 'center'},
  emptyTitle: {fontSize: 17, fontWeight: '500', letterSpacing: -0.3},
  compactEmptyTitle: {fontSize: 12},
  footer: {padding: 12, borderTopWidth: 1},
});
