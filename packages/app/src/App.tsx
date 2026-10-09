import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View, StyleSheet, useWindowDimensions} from 'react-native';
import {anchorLabel, anchorStart, Button, Dialog, Empty, parseTime, ShortcutContext, TextField, Timeline, timeLabel} from './components';
import {chooseVideo, command, configureShortcuts, dataDirectory, GamePackPlayer, listenShortcuts, listenWindowState, setAppearance, setFullScreen} from './native';
import {beginLiveDraft, capturedDraft, expandedAncestors, finalizeCapturedClip, finalizeLiveDraft, liveScene, mergeDrawings} from './review';
import {annotationScene, coloredReview, commentColorMap} from './playback';
import {Icon} from './Icon';
import {VideoNote} from './VideoNote';
import {PointerPulse} from './PointerPulse';
import {adjacentNote, conversationTarget, notesAtTime} from './presentation';
import {SettingsPage} from './SettingsPage';
import {Avatar} from './Avatar';
import {MotionPressable} from './motion';
import {DragHandle, SpatialCard} from './SpatialCard';
import {cardAvailableHeight, contentRect, normalizedPoint, notePosition, type Point} from './spatial';
import {conversationRoot} from './discussion';
import {resumableDraft} from './drafts';
import {LibraryBrowser} from './LibraryBrowser';
import {libraryContents, videoTitle} from './library';
import {ReviewTimeline} from './ReviewTimeline';
import {binding, bindingError, effectiveShortcutChords, migrateReviewBindings, shortcutAction, type ShortcutEvent} from './shortcuts';
import {ThemeContext, useTheme, useThemeChoice} from './theme';
import type {Anchor, Bootstrap, CaptureFinished, Comment, Draft, Drawing, DrawingTool, PlayerTime, Profile, Project, Folder, Settings, ThemeChoice, Video} from './types';

const palette = ['#79BFFD', '#FFFFFF', '#FFD27D', '#9ED8B3'];
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, value => {
  const random = Math.floor(Math.random() * 16);
  return (value === 'x' ? random : (random & 3) | 8).toString(16);
});
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
type CaptureRequest = {token: number; draftId: string; purpose: 'save' | 'leave'; live: boolean; after?: () => void | Promise<void>};

export default function App() {
  const {width, height} = useWindowDimensions();
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>('system');
  const theme = useThemeChoice(themeChoice);
  const videoTheme = useThemeChoice('dark');
  const vs = videoTheme.styles;
  const [data, setData] = useState<Bootstrap | null>(null);
  const [root, setRoot] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<'profile' | 'appearance'>('appearance');
  const [folderDialog, setFolderDialog] = useState<{kind: 'create' | 'renameFolder' | 'renameProject'; id?: string} | null>(null);
  const [folderTitle, setFolderTitle] = useState('');
  const [moveTarget, setMoveTarget] = useState<Video | null>(null);
  const [brandFocused, setBrandFocused] = useState(false);
  const [settingsAnimate, setSettingsAnimate] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const focusParent = useRef<string | null>(null);
  const [playerSize, setPlayerSize] = useState({width: 1, height: 1});
  const [lastPointer, setLastPointer] = useState<Point | null>(null);
  const [avatarFocused, setAvatarFocused] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [commentId, setCommentId] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [seekState, setSeekState] = useState({us: 0, token: 0});
  const [captureToken, setCaptureToken] = useState(0);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [tool, setTool] = useState<DrawingTool>('pointer');
  const [strokeColor, setStrokeColor] = useState(palette[0]);
  const [reviewing, setReviewing] = useState(false);
  const [showScene, setShowScene] = useState(true);
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [isolatedReview, setIsolatedReview] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const displayTheme = presenting ? videoTheme : theme;
  const {colors, styles: s} = displayTheme;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [videoMenuAnchor, setVideoMenuAnchor] = useState({x: 24, y: 64});
  const appView = useRef<View>(null);
  const videoMenuTrigger = useRef<View>(null);
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  const setLibraryVisible = setLibraryOpen;
  const [pointerPulse, setPointerPulse] = useState<{x: number; y: number; token: number} | null>(null);
  const [notesVisible, setNotesVisible] = useState(true);
  const [timingOpen, setTimingOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(true);
  const [recording, setRecording] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{kind: 'video' | 'project' | 'folder'; id: string; title: string} | null>(null);
  const [step, setStep] = useState({token: 0, frames: 1});
  const commentInput = useRef<TextInput>(null);
  const shortcutHandler = useRef<(event: ShortcutEvent) => void>(() => {});
  const [failedDrafts, setFailedDrafts] = useState<Set<string>>(new Set());
  const [redo, setRedo] = useState<Drawing[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const draftsRef = useRef<Draft[]>([]);
  const activeDraftRef = useRef<string | null>(null);
  const liveRef = useRef<string | null>(null);
  const furthest = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const captureRequest = useRef<CaptureRequest | null>(null);
  const savingDraftId = useRef<string | null>(null);
  const pendingPublish = useRef<string | null>(null);
  const captureSequence = useRef(0);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const metadataSent = useRef(new Set<string>());
  const sourceGeneration = useRef(0);
  const discarding = useRef<string | null>(null);

  const video = data?.videos.find(item => item.id === videoId) ?? null;
  const draft = data?.drafts.find(item => item.id === draftId) ?? null;
  const selected = data?.comments.find(item => item.comment_id === commentId) ?? null;
  const videoComments = useMemo(() => data?.comments.filter(item => item.video_id === videoId) ?? [], [data?.comments, videoId]);
  const originalComments = useMemo(() => videoComments.filter(item => !item.parent_comment_id), [videoComments]);
  const allRepliesExpanded = originalComments.length > 0 && originalComments.every(item => expanded.has(item.comment_id));
  const projectVideos = data ? libraryContents(data.projects, data.folders, data.videos, projectId, folderId).videos : [];
  const activeScene = draft ?? selected;
  const isLive = !!draft && liveId === draft.id;
  const aggregateScene = useMemo(() => annotationScene(originalComments, duration, true), [originalComments, duration]);
  const commentColors = useMemo(() => commentColorMap(originalComments, true), [originalComments]);
  const railColors = useMemo(() => commentColorMap(originalComments, displayTheme.dark), [originalComments, displayTheme.dark]);
  const selectedScene = useMemo(() => selected ? coloredReview(selected, true, commentColors) : null, [selected, theme.dark, commentColors]);
  const draftStart = draft ? anchorStart(draft.anchor) : 0;
  const draftEnd = draft?.anchor.kind === 'interval' ? (isLive ? duration : draft.anchor.end_us) : 0;
  const draftKind = draft?.anchor.kind;
  const draftScene = useMemo(() => draft ? (isLive ? liveScene(draft, duration) :
    {id: draft.id, anchor: draft.anchor, drawings: draft.drawings}) : null,
    [draft?.id, draft?.drawings, draftKind, draftStart, draftEnd, isLive, duration]);
  const sceneJson = useMemo(() => {
    const scene = draft ? (showScene ? draftScene : null) : annotationsVisible ? (isolatedReview ? selectedScene : aggregateScene) : null;
    return scene ? JSON.stringify(scene) : '';
  }, [!!draft, draftScene, showScene, annotationsVisible, isolatedReview, selectedScene, aggregateScene]);
  const onVideoNotes = useMemo(() => {
    const notes = notesAtTime(videoComments, time, duration);
    const root = draft?.parent_comment_id ? conversationRoot(videoComments, draft.parent_comment_id) : undefined;
    if (root && !notes.some(note => note.comment_id === root.comment_id)) notes.push(root);
    return notes;
  }, [videoComments, time, duration, draft?.parent_comment_id]);
  const videoRect = contentRect(playerSize, video ?? {width: 0, height: 0}, zoom);
  const previousNote = adjacentNote(videoComments, commentId, time, duration, -1);
  const nextNote = adjacentNote(videoComments, commentId, time, duration, 1);
  const reviewEnd = !isLive && (reviewing || (!!draft)) && activeScene?.anchor.kind === 'interval' ? activeScene.anchor.end_us : -1;
  const dialogOpen = profileOpen || projectOpen || discardOpen || !!deleteTarget || !!folderDialog || !!moveTarget;

  useEffect(() => {
    if (!draft || !composerOpen || focusParent.current === null || (draft.parent_comment_id ?? '') !== focusParent.current) return;
    const frame = requestAnimationFrame(() => { commentInput.current?.focus(); focusParent.current = null; });
    return () => cancelAnimationFrame(frame);
  }, [draft?.id, composerOpen, focusRequest]);
  useEffect(() => {
    if (presenting && !video && !loading) { setPresenting(false); setFullScreen(false); }
  }, [presenting, !!video, loading]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (captureTimer.current) clearTimeout(captureTimer.current); };
  }, []);
  useEffect(() => {
    const listener = listenWindowState(event => {
      if (event.fullScreen !== undefined) setPresenting(event.fullScreen);
    });
    return () => listener.remove();
  }, []);
  useEffect(() => { const listener = listenShortcuts(event => shortcutHandler.current(event)); return () => listener.remove(); }, []);
  useEffect(() => {
    const bindings = data?.settings.keybindings ?? {};
    const chords = !data || busy || libraryMenuOpen ? [] : dialogOpen || libraryOpen ? ['Escape'] : settingsOpen ? [binding('settings', bindings), 'Escape'] : [...effectiveShortcutChords(bindings), ...(presenting ? ['PageUp', 'PageDown'] : []), 'Escape'];
    configureShortcuts(chords.filter((chord): chord is string => !!chord), !!recording && !busy, !dialogOpen && !settingsOpen ? binding('submit', bindings) ?? '' : '');
  }, [data?.settings.keybindings, !!data, busy, dialogOpen, settingsOpen, recording, presenting, libraryMenuOpen, libraryOpen]);
  useEffect(() => { if (data) { try { setAppearance(themeChoice); } catch (cause) { setError(message(cause)); } } }, [themeChoice, !!data]);
  const seek = useCallback((us: number) => {
    const target = Math.max(0, Math.round(us));
    setSeekState(previous => ({us: target, token: previous.token + 1}));
    setTime(target);
  }, []);
  const setLive = (id: string | null) => { liveRef.current = id; setLiveId(id); };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const directory = await dataDirectory();
      const state = await command<Bootstrap>(directory, 'bootstrap');
      const keybindings = migrateReviewBindings(state.settings.keybindings);
      if (Object.keys(keybindings).length !== Object.keys(state.settings.keybindings).length)
        state.settings = await command<Settings>(directory, 'set_preferences', {keybindings, pause_after_drawing: state.settings.pause_after_drawing});
      if (!mounted.current) return;
      setRoot(directory); setData(state); setThemeChoice(state.settings?.theme ?? 'system');
      draftsRef.current = state.drafts;
      setVideoId(null); setProjectId(null); setFolderId(null); setDuration(0);
    } catch (cause) { setError(message(cause)); }
    finally { setLoading(false); }
  }, [seek]);
  useEffect(() => { void load(); }, [load]);

  const persist = useCallback((value: Draft): Promise<Draft> => {
    const live = liveRef.current === value.id;
    const extent = furthest.current.get(value.id) ?? (value.anchor.kind === 'interval' ? value.anchor.end_us : value.anchor.at_us);
    const pending = saveChain.current.catch(() => undefined).then(() => {
      // Store a recovery snapshot with the first-stroke origin. Keep the live
      // player's provisional origin stable until the capture acknowledgment.
      const snapshot = live ? finalizeCapturedClip(value, extent, duration, extent) : value;
      return command<Draft>(root, 'save_draft', {draft: snapshot});
    });
    saveChain.current = pending;
    return pending.then(saved => {
      if (mounted.current && draftsRef.current.find(item => item.id === value.id) === value)
        setFailedDrafts(previous => { const next = new Set(previous); next.delete(value.id); return next; });
      return saved;
    }).catch(cause => {
      if (mounted.current) {
        setFailedDrafts(previous => new Set(previous).add(value.id));
        setError(`Comment could not be saved: ${message(cause)}. Retry before closing the app.`);
      }
      throw cause;
    });
  }, [root, duration]);
  const scheduleSave = (id: string, streaming = false) => {
    const previous = timers.current.get(id);
    if (previous && streaming) return; // Throttle clock updates; never debounce them forever.
    if (previous) clearTimeout(previous);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      const latest = draftsRef.current.find(item => item.id === id);
      if (latest) void persist(latest).catch(() => undefined);
    }, streaming ? 750 : 300));
  };
  const replaceDraft = (value: Draft, streaming = false) => {
    draftsRef.current = [...draftsRef.current.filter(item => item.id !== value.id), value];
    setData(previous => previous ? {...previous, drafts: draftsRef.current} : previous);
    scheduleSave(value.id, streaming);
  };
  const updateDraft = (fields: Partial<Draft>) => {
    const current = draftsRef.current.find(item => item.id === activeDraftRef.current);
    if (!current || busy) return;
    replaceDraft({...current, ...fields}); setShowScene(true);
  };
  const flushDraft = async (value: Draft) => {
    const timer = timers.current.get(value.id); if (timer) clearTimeout(timer); timers.current.delete(value.id);
    return persist(value);
  };
  const flushLatest = async (id: string) => {
    let value = draftsRef.current.find(item => item.id === id);
    if (!value) throw new Error('The draft is no longer available.');
    while (true) {
      await flushDraft(value);
      const latest = draftsRef.current.find(item => item.id === id);
      if (!latest) throw new Error('The draft is no longer available.');
      if (latest === value) return latest;
      value = latest;
    }
  };
  const flushAll = async () => {
    for (const id of [...timers.current.keys()]) await flushLatest(id);
    await saveChain.current;
  };

  const clearEditing = () => {
    setDraftId(null); activeDraftRef.current = null; setLive(null); setReviewing(false); setTool('pointer'); setRedo([]); setIsolatedReview(false);
  };
  const leaveDraft = (after: () => void | Promise<void>) => {
    if (busy || captureRequest.current) return;
    if (draftsRef.current.some(item => item.id === activeDraftRef.current)) requestCapture('leave', after);
    else void after();
  };
  const restoreDraftNow = (pending: Draft) => {
    activeDraftRef.current = pending.id; setDraftId(pending.id); setCommentId(null); setLive(null);
    setComposerOpen(true); setLibraryVisible(false); setTimingOpen(false);
    setPaused(true); setReviewing(false); setIsolatedReview(false); setShowScene(true); setTool('pointer'); setRedo([]);
    const parent = data?.comments.find(item => item.comment_id === pending.parent_comment_id);
    const pendingDuration = data?.videos.find(item => item.id === pending.video_id)?.duration_us || duration;
    seek(parent ? conversationTarget(data?.comments ?? [], parent, pendingDuration).time : anchorStart(pending.anchor));
  };
  const openVideoNow = async (item: Video) => {
    const generation = ++sourceGeneration.current;
    setPaused(true); setRate(1); clearEditing(); setShowScene(true); setLastPointer(null); setZoomOpen(false); setSpeedOpen(false); setZoom(1); setVideoId(item.id); setProjectId(item.project_id); setFolderId(item.folder_id ?? null); setLibraryOpen(false);
    setCommentId(null); setExpanded(new Set()); setDuration(item.duration_us); seek(0);
    const pending = resumableDraft(draftsRef.current, item.id);
    if (pending) restoreDraftNow(pending);
    try {
      const result = await command<{valid: boolean; path: string}>(root, 'verify_video', {video_id: item.id});
      if (generation === sourceGeneration.current && !result.valid)
        setError('This managed video failed its integrity check. Re-add the original video.');
    } catch (cause) { if (generation === sourceGeneration.current) setError(message(cause)); }
  };
  const openVideo = (item: Video) => leaveDraft(() => { setLibraryOpen(false); return openVideoNow(item); });
  const importVideoNow = async () => {
    if (!projectId || busy) return;
    setBusy('Adding video…'); setError('');
    try {
      const path = await chooseVideo(); if (!path) return;
      await flushAll();
      let imported = await command<Video>(root, 'import_video', {path, project_id: projectId});
      if (folderId) imported = await command<Video>(root, 'move_video', {video_id: imported.id, folder_id: folderId});
      const refreshed = await command<Bootstrap>(root, 'bootstrap');
      draftsRef.current = refreshed.drafts; setData(refreshed); await openVideoNow(imported);
    } catch (cause) { setError(`Could not add video: ${message(cause)}`); }
    finally { setBusy(''); }
  };
  const importVideo = () => leaveDraft(importVideoNow);
  const newDraftNow = (parent?: Comment, revealComposer = true, position?: Point) => {
    if (!video || busy) return;
    if (revealComposer) { setComposerOpen(true); setLibraryVisible(false); }
    if (draft && !parent) return draft;
    const pending = resumableDraft(draftsRef.current, video.id, parent?.comment_id ?? null);
    if (pending) { restoreDraftNow(pending); return pending; }
    setTimingOpen(false);
    try {
      let value: Draft = {id: uuid(), project_id: video.project_id, video_id: video.id, text: '',
        anchor: parent?.anchor ?? {kind: 'point', at_us: Math.min(time, duration || time)},
        parent_comment_id: parent?.comment_id ?? null, drawings: [], position: parent?.position ?? position ?? (revealComposer ? {x: .4, y: .26} : undefined)};
      const live = !paused && !parent;
      if (live) value = beginLiveDraft(value, duration);
      replaceDraft(value); activeDraftRef.current = value.id; setDraftId(value.id); setCommentId(null);
      setLive(live ? value.id : null); setReviewing(false); setShowScene(true); setTool('pointer'); setRedo([]);
      if (live) furthest.current.set(value.id, time);
      else { setPaused(true); seek(parent ? conversationTarget(data?.comments ?? [], parent, duration).time : anchorStart(value.anchor)); }
      return value;
    } catch (cause) { setError(message(cause)); }
  };
  const newDraft = (parent?: Comment) => {
    if (parent) leaveDraft(() => { newDraftNow(parent); });
    else newDraftNow();
  };
  const selectCommentNow = (item: Comment) => {
    const target = conversationTarget(data?.comments ?? [], item, duration);
    clearEditing(); setIsolatedReview(false); setCommentId(target.comment.comment_id); setPaused(true); setShowScene(true); seek(target.time);
    setExpanded(previous => new Set(expandedAncestors(data?.comments ?? [], item.comment_id, previous)).add(target.comment.comment_id));
  };
  const selectComment = (item: Comment) => leaveDraft(() => selectCommentNow(item));
  const dismissSelectionNow = () => { clearEditing(); setCommentId(null); setShowScene(true); };
  const startLive = () => {
    const current = draftsRef.current.find(item => item.id === activeDraftRef.current);
    if (!current || busy) return;
    try {
      const next = beginLiveDraft(current, duration, time);
      replaceDraft(next); setLive(next.id); setShowScene(true); setReviewing(false);
      furthest.current.set(next.id, Math.max(furthest.current.get(next.id) ?? anchorStart(next.anchor), next.anchor.kind === 'interval' ? next.anchor.end_us : 0));
      if (time < anchorStart(next.anchor) || time >= duration) seek(anchorStart(next.anchor));
      setPaused(false);
    } catch (cause) { setError(message(cause)); }
  };
  const play = () => {
    if (!video || busy) return;
    if (!paused) { setPaused(true); return; }
    setLibraryOpen(false);
    if (!draft) { setCommentId(null); setIsolatedReview(false); setReviewing(false); setShowScene(true); }
    if (draft && draft.anchor.kind === 'point') { startLive(); return; }
    if (!draft) setTool(previous => previous === 'laser' ? 'laser' : 'pointer');
    if (isLive && time >= duration) seek(anchorStart(draft!.anchor));
    else if (!isLive && draft?.anchor.kind === 'interval' && (time < draft.anchor.start_us || time >= draft.anchor.end_us)) seek(draft.anchor.start_us);
    else if (duration && time >= duration) seek(0);
    setPaused(false);
  };
  const playReview = (item: Comment) => {
    setTool('pointer'); setShowScene(true); setIsolatedReview(false); seek(anchorStart(item.anchor));
    if (item.anchor.kind === 'point') { setPaused(true); setReviewing(false); }
    else { setReviewing(true); setPaused(false); }
  };
  const onTime = (event: PlayerTime) => {
    if (Number.isFinite(event.time_us)) {
      const now = Math.max(0, Math.round(event.time_us)); setTime(now);
      const current = draftsRef.current.find(item => item.id === liveRef.current);
      if (current && !captureRequest.current) {
        const extent = current.drawings.length ? Math.max(furthest.current.get(current.id) ?? 0, now) : now;
        furthest.current.set(current.id, extent);
        if (current.anchor.kind === 'interval') {
          const end = Math.min(event.duration_us || duration, Math.max(current.anchor.end_us, extent));
          if (end > current.anchor.end_us) replaceDraft({...current, anchor: {...current.anchor, end_us: end}}, true);
        }
      }
    }
    if (event.duration_us > 0) setDuration(Math.round(event.duration_us));
    if (event.error) { setError(`Playback failed: ${event.error}`); setPaused(true); }
    if (event.ended) { setPaused(true); setReviewing(false); }
    if (video && event.duration_us > 0 && event.width > 0 && !metadataSent.current.has(video.id)) {
      metadataSent.current.add(video.id);
      void command<Video>(root, 'update_video_metadata', {video_id: video.id,
        duration_us: Math.round(event.duration_us), width: Math.round(event.width), height: Math.round(event.height)})
        .then(updated => setData(previous => previous ? {...previous, videos: previous.videos.map(item => item.id === updated.id ? updated : item)} : previous))
        .catch(cause => { metadataSent.current.delete(video.id); setError(`Video details could not be saved: ${message(cause)}`); });
    }
  };
  const parseDrawing = (json: string): Drawing => {
    const drawing = JSON.parse(json) as Drawing;
    if (!drawing.id || !Array.isArray(drawing.samples) || !drawing.samples.length) throw new Error('The drawing was incomplete. Try the stroke again.');
    return drawing;
  };
  const onDrawing = (json: string) => {
    const id = captureRequest.current?.draftId ?? savingDraftId.current ?? activeDraftRef.current;
    const current = draftsRef.current.find(item => item.id === id);
    if (!current || current.id === discarding.current) return;
    try {
      const drawings = mergeDrawings(current.drawings, [parseDrawing(json)]);
      if (drawings.length === current.drawings.length) return;
      let next: Draft = {...current, drawings, position: current.position ?? notePosition({drawings})};
      if (!current.drawings.length) furthest.current.set(current.id, time);
      if (liveRef.current === current.id || captureRequest.current?.live)
        next = finalizeLiveDraft(next, time, duration, furthest.current.get(current.id) ?? time);
      else if (savingDraftId.current === current.id && next.anchor.kind === 'interval')
        next = finalizeLiveDraft(next, next.anchor.end_us, duration, next.anchor.end_us);
      replaceDraft(next); setRedo([]); setComposerOpen(true); setTool('pointer'); setNotesVisible(true);
      if (data?.settings.pause_after_drawing) setPaused(true);
    } catch (cause) { setError(message(cause)); }
  };
  const changeAnchor = (anchor: Anchor) => {
    if (!draft || busy) return;
    if (draft.drawings.length) { setError('Undo the drawings before changing this time range.'); return; }
    if (anchor.kind === 'point' ? anchor.at_us > duration : anchor.end_us > duration || anchor.end_us <= anchor.start_us) {
      setError('Choose a time within the video and an end after the start.'); return;
    }
    setLive(null); updateDraft({anchor}); setPaused(true); setReviewing(false); setTool('pen'); seek(anchorStart(anchor));
  };
  const chooseTool = (value: DrawingTool) => {
    if (!video || busy) return;
    setZoomOpen(false); setSpeedOpen(false);
    if (value === 'pointer' || value === 'laser' || tool === value) { setTool(tool === value ? 'pointer' : value); return; }
    if (!draft) { newDraftNow(undefined, false); setTool(value); setComposerOpen(false); return; }
    setComposerOpen(false);
    setShowScene(true); setTool(value);
    if (draft.anchor.kind === 'point') { setPaused(true); seek(draft.anchor.at_us); }
    else if (time < draft.anchor.start_us || (!isLive && time >= draft.anchor.end_us)) { setPaused(true); seek(draft.anchor.start_us); }
  };
  const undoDrawing = () => {
    if (!draft?.drawings.length || busy) return;
    setRedo(previous => [...previous, draft.drawings[draft.drawings.length - 1]]); updateDraft({drawings: draft.drawings.slice(0, -1)});
  };
  const redoDrawing = () => {
    if (!draft || !redo.length || busy) return;
    updateDraft({drawings: [...draft.drawings, redo[redo.length - 1]]}); setRedo(previous => previous.slice(0, -1));
  };

  const publishDraft = async (id: string) => {
    setBusy('Saving…'); savingDraftId.current = id; setError('');
    try {
      const latest = await flushLatest(id);
      if (!latest.text.trim() && !latest.drawings.length) throw new Error('Add a comment or drawing before saving.');
      const posted = await command<Comment>(root, 'post_draft', {draft_id: id});
      draftsRef.current = draftsRef.current.filter(item => item.id !== id);
      setExpanded(current => expandedAncestors([...(data?.comments ?? []), posted], posted.comment_id, current));
      setData(previous => {
        if (!previous) return previous;
        const comments = [...previous.comments.filter(item => item.comment_id !== posted.comment_id), posted];
        return {...previous, drafts: draftsRef.current, comments};
      });
      selectCommentNow(posted);

    } catch (cause) {
      try {
        const refreshed = await command<Bootstrap>(root, 'bootstrap');
        const posted = refreshed.comments.find(item => item.comment_id === id);
        if (posted) { draftsRef.current = refreshed.drafts; setData(refreshed); selectCommentNow(posted); return; }
      } catch { /* Keep the local draft when storage cannot be reached. */ }
      setError(`Could not save comment: ${message(cause)}. Retry Post.`);

    } finally { setBusy(''); savingDraftId.current = null; }
  };
  const requestCapture = (purpose: CaptureRequest['purpose'], after?: CaptureRequest['after']) => {
    if (!draft || busy || captureRequest.current) return;
    const token = ++captureSequence.current;
    captureRequest.current = {token, draftId: draft.id, purpose, live: isLive, after};
    savingDraftId.current = draft.id;
    setBusy('Saving…'); setError('');
    // The native acknowledgment pauses and finishes a held stroke atomically.
    setCaptureToken(token);
    captureTimer.current = setTimeout(() => {
      if (captureRequest.current?.token !== token) return;
      captureRequest.current = null; savingDraftId.current = null; setPaused(true); setBusy('');
      setError('The player did not finish capturing. Pause playback and retry.');
    }, 10000);
  };
  const onCaptureFinished = async (event: CaptureFinished) => {
    const request = captureRequest.current;
    if (!request || request.token !== event.captureToken) return;
    if (captureTimer.current) clearTimeout(captureTimer.current); captureTimer.current = null;
    try {
      const current = draftsRef.current.find(item => item.id === request.draftId);
      if (!current) throw new Error('The draft is no longer available.');
      if (!Number.isSafeInteger(event.time_us) || event.time_us < 0) throw new Error('The player returned an invalid capture time. Retry Post.');
      const next = capturedDraft(current, event.drawingJson ? parseDrawing(event.drawingJson) : undefined,
        event.time_us, duration, current.drawings.length ? furthest.current.get(current.id) ?? event.time_us : event.time_us, request.live);
      replaceDraft(next); setTime(event.time_us); setPaused(true); setTool('pointer'); setLive(null); setReviewing(false);
      captureRequest.current = null;
      await flushLatest(next.id);
      if (request.purpose === 'leave') { setBusy(''); savingDraftId.current = null; await request.after?.(); return; }
      if (next.anchor.kind === 'interval') seek(Math.max(next.anchor.start_us, next.anchor.end_us - 1));
      setBusy(''); savingDraftId.current = null;
      if (!data?.profile.name.trim()) { pendingPublish.current = next.id; setProfileName(''); setProfileOpen(true); }
      else await publishDraft(next.id);
    } catch (cause) {
      captureRequest.current = null; savingDraftId.current = null; setPaused(true); setBusy(''); setError(message(cause));
    }
  };
  const discard = async () => {
    if (!draft || busy) return;
    discarding.current = draft.id;
    setBusy('Discarding…'); setDiscardOpen(false); setPaused(true); setTool('pointer'); setLive(null);
    try {
      const timer = timers.current.get(draft.id); if (timer) clearTimeout(timer); timers.current.delete(draft.id);
      await saveChain.current.catch(() => undefined);
      await command<null>(root, 'discard_draft', {draft_id: draft.id});
      draftsRef.current = draftsRef.current.filter(item => item.id !== draft.id);
      setData(previous => previous ? {...previous, drafts: draftsRef.current} : previous); dismissSelectionNow();
    } catch (cause) { setError(`Could not discard comment: ${message(cause)}`); }
    finally { discarding.current = null; setBusy(''); }
  };
  const saveProfile = async () => {
    if (!profileName.trim() || busy) return;
    setBusy('Saving…');
    try {
      const profile = await command<Profile>(root, 'set_profile', {name: profileName.trim()});
      setData(previous => previous ? {...previous, profile} : previous); setProfileOpen(false);
      const id = pendingPublish.current; pendingPublish.current = null;
      if (id) await publishDraft(id);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(''); }
  };
  const closeProfile = () => {
    if (busy) return;
    pendingPublish.current = null; setProfileOpen(false);
  };
  const changeTheme = async (choice: ThemeChoice) => {
    if (busy || choice === themeChoice) return;
    const previous = themeChoice; setThemeChoice(choice); setBusy('Saving…');
    try {
      const settings = await command<Settings>(root, 'set_theme', {theme: choice});
      setData(current => current ? {...current, settings} : current);
    } catch (cause) { setThemeChoice(previous); setError(`Could not save appearance: ${message(cause)}`); }
    finally { setBusy(''); }
  };
  const createProject = async () => {
    if (!projectTitle.trim() || busy) return;
    setBusy('Creating project…');
    try {
      const created = await command<Project>(root, 'create_project', {title: projectTitle.trim()});
      setData(previous => previous ? {...previous, projects: [...previous.projects, created]} : previous);
      setProjectId(created.id); setFolderId(null); setVideoId(null); dismissSelectionNow(); setProjectOpen(false); setProjectTitle('');
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(''); }
  };

  const browse = (nextProjectId: string | null, nextFolderId: string | null = null) => leaveDraft(() => {
    ++sourceGeneration.current; setProjectId(nextProjectId); setFolderId(nextFolderId); setVideoId(null);
    setPaused(true); setDuration(0); seek(0); dismissSelectionNow(); setLibraryOpen(false);
    if (presenting) { setPresenting(false); setFullScreen(false); }
  });
  const openProject = (project: Project) => browse(project.id);
  const openSettings = (tab: 'profile' | 'appearance' = 'appearance', animate = true) => leaveDraft(() => {
    setPaused(true); setSettingsError(''); setSettingsTab(tab); setSettingsAnimate(animate); setLibraryOpen(false); setZoomOpen(false); setSpeedOpen(false);
    if (presenting) { setPresenting(false); setFullScreen(false); }
    setSettingsOpen(true);
  });
  const saveSettingsProfile = async (name: string) => {
    if (busy || !name.trim()) return;
    setBusy('Saving…'); setSettingsError('');
    try {
      const profile = await command<Profile>(root, 'set_profile', {name: name.trim()});
      setData(previous => previous ? {...previous, profile} : previous);
    } catch (cause) { setSettingsError(message(cause)); }
    finally { setBusy(''); }
  };
  const editFolder = (kind: 'create' | 'renameFolder' | 'renameProject', item?: {id: string; title: string}) => leaveDraft(() => {
    setFolderTitle(item?.title ?? ''); setFolderDialog({kind, id: item?.id}); setError(''); setPaused(true);
  });
  const saveFolder = async () => {
    if (!folderDialog || !folderTitle.trim() || busy) return;
    setBusy('Saving…'); setError('');
    try {
      const title = folderTitle.trim();
      if (folderDialog.kind === 'create') {
        const created = await command<Folder>(root, 'create_folder', {project_id: projectId, title});
        setFolderId(created.id); setVideoId(null); clearEditing(); setDuration(0); seek(0);
      } else if (folderDialog.kind === 'renameFolder') await command(root, 'rename_folder', {folder_id: folderDialog.id, title});
      else await command(root, 'rename_project', {project_id: folderDialog.id, title});
      setData(await command<Bootstrap>(root, 'bootstrap')); setFolderDialog(null);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(''); }
  };
  const moveVideo = async (target: string | null) => {
    if (!moveTarget || busy) return;
    setBusy('Moving video…'); setError('');
    try {
      const moved = await command<Video>(root, 'move_video', {video_id: moveTarget.id, folder_id: target});
      setData(previous => previous ? {...previous, videos: previous.videos.map(item => item.id === moved.id ? moved : item)} : previous);
      if (videoId === moved.id) setFolderId(target);
      setMoveTarget(null);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(''); }
  };
  const savePreferences = async (settings: Settings) => {
    if (busy) return;
    setBusy('Saving settings…'); setSettingsError('');
    try {
      const saved = await command<Settings>(root, 'set_preferences', {keybindings: settings.keybindings, pause_after_drawing: settings.pause_after_drawing});
      setData(current => current ? {...current, settings: saved} : current);
    } catch (cause) { setSettingsError(message(cause)); }
    finally { setBusy(''); }
  };
  const askDelete = (kind: 'video' | 'project' | 'folder', item: {id: string; title: string}) => {
    leaveDraft(() => { setPaused(true); setError(''); setDeleteTarget({kind, ...item}); });
  };
  const deleteItem = async () => {
    if (!deleteTarget || busy) return;
    setBusy('Deleting…'); setPaused(true); setError('');
    try {
      await flushAll();
      await command(root, deleteTarget.kind === 'video' ? 'delete_video' : deleteTarget.kind === 'folder' ? 'delete_folder' : 'delete_project', {[`${deleteTarget.kind}_id`]: deleteTarget.id});
      const refreshed = await command<Bootstrap>(root, 'bootstrap');
      const nextProject = refreshed.projects.find(item => item.id === projectId);
      const nextVideo = refreshed.videos.find(item => item.id === videoId);
      if (!refreshed.folders.some(item => item.id === folderId)) setFolderId(null);
      draftsRef.current = refreshed.drafts; setData(refreshed); setDeleteTarget(null);
      setProjectId(nextProject?.id ?? null);
      if (!nextVideo) { clearEditing(); setCommentId(null); setVideoId(null); setDuration(0); seek(0); }
    } catch (cause) { setError(`Could not delete: ${message(cause)}`); }
    finally { setBusy(''); }
  };
  const focusComment = () => { if (busy) return; focusParent.current = ''; setFocusRequest(value => value + 1); setZoomOpen(false); setSpeedOpen(false); setComposerOpen(true); setLibraryVisible(false); newDraftNow(undefined, true, lastPointer ?? undefined); setTool('pointer'); setNotesVisible(true); setPaused(true); };
  const toggleAllReplies = () => setExpanded(allRepliesExpanded ? new Set() : new Set(originalComments.map(item => item.comment_id)));
  const togglePresentation = () => leaveDraft(() => {
     setLibraryOpen(false); setPresenting(!presenting); setFullScreen(!presenting);
  });
  const replyToNote = (item: Comment) => {
    focusParent.current = item.comment_id; setFocusRequest(value => value + 1); setNotesVisible(true); setPaused(true); newDraft(item); setComposerOpen(true);
  };
  const navigateNote = (direction: -1 | 1) => {
    const item = direction === 1 ? nextNote : previousNote;
    if (item) selectComment(item);
  };
  const markTime = (end: boolean) => {
    const value = draft ?? newDraftNow();
    if (!value) return;
    if (value.drawings.length) { setError('Undo the drawings before changing comment timing.'); return; }
    const start = anchorStart(value.anchor);
    if (end && time <= start) { setError('The end must be after the comment start.'); return; }
    setLive(null); setPaused(true);
    replaceDraft({...value, anchor: end ? {kind: 'interval', start_us: start, end_us: time} : {kind: 'point', at_us: time}});
  };
  shortcutHandler.current = event => {
    if (busy || !data) return;
    if (recording) {
      if (event.chord === 'Escape') { setRecording(null); setSettingsError(''); return; }
      if (event.repeat) return;
      const problem = bindingError(recording, event.chord, data.settings.keybindings);
      if (problem) { setSettingsError(problem); return; }
      void savePreferences({...data.settings, keybindings: {...data.settings.keybindings, [recording]: event.chord}}); setRecording(null); return;
    }
    if (event.chord === 'Escape') {
      if (deleteTarget) setDeleteTarget(null);
      else if (discardOpen) setDiscardOpen(false);
      else if (folderDialog) setFolderDialog(null);
      else if (moveTarget) setMoveTarget(null);
      else if (profileOpen) closeProfile();
      else if (projectOpen) setProjectOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (commentInput.current?.isFocused()) { commentInput.current.blur(); }
      else if (libraryOpen || zoomOpen || speedOpen) { setLibraryOpen(false); setZoomOpen(false); setSpeedOpen(false); }
      else if (presenting) { setPresenting(false); setFullScreen(false); }
      else { setTool('pointer'); commentInput.current?.blur(); }
      return;
    }
    if (dialogOpen) return;
    const action = shortcutAction(event, data.settings.keybindings);
    if (action === 'settings') { if (settingsOpen) setSettingsOpen(false); else openSettings('appearance', false); return; }
    if (settingsOpen) return;
    if (action?.startsWith('project') && /^project[1-9]$/.test(action)) { const item = data.projects[Number(action.slice(-1)) - 1]; if (item) openProject(item); return; }
    if (action === 'nextProject' || action === 'previousProject') { const index = data.projects.findIndex(item => item.id === projectId); const item = data.projects[index + (action === 'nextProject' ? 1 : -1)]; if (item) openProject(item); return; }
    if (action === 'nextVideo' || action === 'previousVideo') { const index = projectVideos.findIndex(item => item.id === videoId); const item = projectVideos[index + (action === 'nextVideo' ? 1 : -1)]; if (item) openVideo(item); return; }
    if (action === 'import') { importVideo(); return; }
    if (action === 'newProject') { leaveDraft(() => { setPaused(true); setProjectOpen(true); }); return; }
    if (action === 'deleteProject') { const item = data.projects.find(item => item.id === projectId); if (item) askDelete('project', item); return; }
    if (!video) return;
    if (presenting && (event.chord === 'PageDown' || event.chord === 'PageUp')) { navigateNote(event.chord === 'PageDown' ? 1 : -1); return; }
    switch (action) {
      case 'present': togglePresentation(); break;
      case 'onVideoNotes': setNotesVisible(value => !value); break;
      case 'allReplies': setNotesVisible(true); setPaused(true); toggleAllReplies(); break;
      case 'play': play(); break;
      case 'pause': setPaused(true); break;
      case 'forward': setTool('pointer'); setRate(!paused && rate > 0 ? Math.min(4, rate * 2) : 1); setPaused(false); break;
      case 'reverse': setTool('pointer'); setRate(!paused && rate < 0 ? Math.max(-4, rate * 2) : -1); setPaused(false); break;
      case 'previousFrame': case 'nextFrame': setPaused(true); setTool('pointer'); setStep(previous => ({token: previous.token + 1, frames: action === 'nextFrame' ? 1 : -1})); break;
      case 'back': seek(Math.max(0, time - 5000000)); break;
      case 'ahead': seek(Math.min(duration, time + 5000000)); break;
      case 'start': seek(0); break;
      case 'end': seek(duration); break;
      case 'comment': focusComment(); break;
      case 'markIn': markTime(false); break;
      case 'markOut': markTime(true); break;
      case 'submit':
        if (draft) {
          const text = commentInput.current?.isFocused() ? event.text : undefined;
          if (text !== undefined) updateDraft({text: text.slice(0, 16000)});
          if ((text ?? draft.text).trim() || draft.drawings.length) requestCapture('save');
        }
        break;
      case 'pen': case 'arrow': case 'ellipse': chooseTool(action); break;
      case 'pointer': chooseTool('pointer'); break;
      case 'laser': chooseTool('laser'); break;
      case 'zoomIn': setZoom(value => Math.min(4, value + .25)); break;
      case 'zoomOut': setZoom(value => Math.max(1, value - .25)); break;
      case 'zoomReset': setZoom(1); break;
      case 'undo': undoDrawing(); break;
      case 'redo': redoDrawing(); break;
      case 'annotations': setAnnotationsVisible(value => !value); break;
      case 'deleteVideo': askDelete('video', video); break;
      case 'nextComment': case 'previousComment': navigateNote(action === 'nextComment' ? 1 : -1); break;
    }
  };

  if (loading) return <ThemeContext.Provider value={displayTheme}><View style={[s.root, s.loading]}><ActivityIndicator color={colors.accentText} /><Text style={s.status}>Opening library…</Text></View></ThemeContext.Provider>;
  if (!data) return <ThemeContext.Provider value={displayTheme}><View style={s.root}><Empty title="Library could not open" action={<Button primary onPress={() => void load()}>Retry</Button>}>{error}</Empty></View></ThemeContext.Provider>;

  const composer = draft ? <View style={{padding: 13, backgroundColor: colors.panel, borderRadius: 13}}>
    <DragHandle style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9}}>
      <Avatar name={data.profile.name} size={26} />
      <Button quiet compact icon="clock" expanded={timingOpen} disabled={!!busy || dialogOpen} onPress={() => setTimingOpen(value => !value)}>{anchorLabel(draft.anchor)}</Button>
      <View style={{flex: 1}} />
      <Button quiet compact disabled={!!busy || dialogOpen} label="Close comment" icon="close" onPress={() => { setPaused(true); if (draft.text.trim() || draft.drawings.length) setDiscardOpen(true); else void discard(); }} />
    </DragHandle>
    <TextField ref={commentInput} accessibilityLabel={draft.parent_comment_id ? 'Write reply' : 'Write comment'} placeholder={draft.parent_comment_id ? 'Add a reply…' : 'Add a comment…'}
      multiline editable={!busy && !dialogOpen} style={{minHeight: 76, maxHeight: 130, borderWidth: 0, backgroundColor: colors.panel, paddingHorizontal: 0, paddingVertical: 0, fontSize: 13, lineHeight: 19}}
      value={draft.text} onFocus={() => setPaused(true)} onChangeText={text => updateDraft({text})} maxLength={16000} />
    {timingOpen && <><AnchorEditor anchor={draft.anchor} live={isLive} time={time} duration={duration} locked={!!draft.drawings.length} disabled={!!busy || dialogOpen} onChange={changeAnchor} onError={setError} />
      {!!draft.drawings.length && !isLive && <VisibilityEditor key={`${draft.id}-${draft.drawings.length}`} draft={draft} disabled={!!busy || dialogOpen} onChange={drawings => updateDraft({drawings})} onError={setError} />}</>}
    <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 8}}>
      {failedDrafts.has(draft.id) && <Button compact disabled={!!busy || dialogOpen} onPress={() => void flushLatest(draft.id).catch(() => undefined)}>Retry</Button>}
      <View style={{flex: 1}} /><Button primary compact shortcut="submit" disabled={!!busy || (!draft.text.trim() && !draft.drawings.length)} onPress={() => requestCapture('save')}>{busy === 'Saving…' ? 'Saving…' : 'Post'}</Button>
    </View>
  </View> : null;
  const currentProject = data.projects.find(item => item.id === projectId);
  const currentFolder = data.folders?.find(item => item.id === folderId);
  const startProject = () => leaveDraft(() => { setPaused(true); setProjectTitle(''); setError(''); setProjectOpen(true); });
  const toggleVideoMenu = () => {
    if (libraryOpen) { setLibraryOpen(false); return; }
    setPaused(true);
    videoMenuTrigger.current?.measureInWindow((x, y, _triggerWidth, triggerHeight) => {
      appView.current?.measureInWindow((rootX, rootY) => {
        setVideoMenuAnchor({x: Math.max(12, Math.min(x - rootX, width - 332)), y: y - rootY + triggerHeight + 8});
        setLibraryOpen(true);
      });
    });
  };
  const header = <View style={presenting ? vs.videoHeader : s.workspaceHeader}>
    <MotionPressable accessibilityRole="button" accessibilityLabel="All projects" onFocus={() => setBrandFocused(true)} onBlur={() => setBrandFocused(false)} onPress={() => browse(null)} disabled={!!busy || dialogOpen}
      style={({pressed}) => [s.brandButton, pressed && {opacity: .65}, brandFocused && {backgroundColor: colors.selected}]}>
      <View style={s.brandMark}><Icon name="play" color={colors.primaryText} /></View>
      {width > 820 && <Text style={s.brand}>GamePack</Text>}
    </MotionPressable>
    <View style={s.breadcrumb}>
      {!!currentProject && <><Text style={s.breadcrumbSlash}>/</Text><Button quiet compact disabled={!!busy || dialogOpen} style={s.breadcrumbPart} label={`Browse project ${currentProject.title}`} onPress={() => browse(projectId)}>{currentProject.title}</Button></>}
      {!!currentFolder && width > 850 && <><Text style={s.breadcrumbSlash}>/</Text><Button quiet compact disabled={!!busy || dialogOpen} style={s.breadcrumbPart} label={`Browse folder ${currentFolder.title}`} onPress={() => browse(projectId, folderId)}>{currentFolder.title}</Button></>}
      {!!video && <><Text style={s.breadcrumbSlash}>/</Text><View ref={videoMenuTrigger} collapsable={false}><Button quiet compact icon="chevronDown" label={`Choose video: ${videoTitle(video)}`} expanded={libraryOpen} disabled={!!busy || dialogOpen} onPress={toggleVideoMenu}>{videoTitle(video)}</Button></View></>}
    </View>
    <Button quiet compact shortcut="settings" icon="settings" label="Settings" disabled={!!busy || dialogOpen} onPress={() => openSettings()} />
    <MotionPressable accessibilityRole="button" accessibilityLabel={data.profile.name ? `Profile: ${data.profile.name}` : 'Set your name'} onFocus={() => setAvatarFocused(true)} onBlur={() => setAvatarFocused(false)} disabled={!!busy || dialogOpen} onPress={() => openSettings('profile')}
      style={({pressed}) => [s.avatarButton, pressed && {opacity: .65}, avatarFocused && {borderColor: colors.text}]}><Avatar name={data.profile.name} size={30} /></MotionPressable>
  </View>;
  const libraryProps = {
    onMenuOpenChange: setLibraryMenuOpen, projects: data.projects, folders: data.folders ?? [], videos: data.videos, projectId, folderId, videoId, disabled: !!busy || dialogOpen,
    onOpenProject: openProject, onOpenFolder: (folder: Folder) => browse(folder.project_id, folder.id), onOpenRoot: () => browse(projectId), onOpenVideo: openVideo,
    onNewProject: startProject, onImport: () => { void importVideo(); }, onCreateFolder: () => editFolder('create'),
    onRenameProject: (project: Project) => editFolder('renameProject', project), onDeleteProject: (project: Project) => askDelete('project', project),
    onRenameFolder: (folder: Folder) => editFolder('renameFolder', folder), onDeleteFolder: (folder: Folder) => askDelete('folder', folder),
    onMoveVideo: (item: Video) => leaveDraft(() => { setMoveTarget(item); setError(''); setPaused(true); }), onDeleteVideo: (item: Video) => askDelete('video', item),
  };
  const libraryPanel = <VideoPickerMenu videos={projectVideos} currentId={videoId} anchor={videoMenuAnchor}
    availableHeight={height - videoMenuAnchor.y - 16} folder={!!currentFolder}
    onDismiss={() => setLibraryOpen(false)} onSelect={item => { setLibraryOpen(false); if (item.id !== videoId) openVideo(item); }}
    onBrowse={() => browse(projectId, folderId)} onImport={() => { setLibraryOpen(false); void importVideo(); }} />;
  const moveComment = (item: Comment, position: Point) => {
    setData(previous => previous ? {...previous, comments: previous.comments.map(comment => comment.comment_id === item.comment_id ? {...comment, position} : comment)} : previous);
    void command<Comment>(root, 'move_comment', {comment_id: item.comment_id, position}).catch(cause => {
      setData(previous => previous ? {...previous, comments: previous.comments.map(comment =>
        comment.comment_id === item.comment_id && comment.position?.x === position.x && comment.position?.y === position.y
          ? {...comment, position: item.position} : comment)} : previous);
      setError(`Could not move comment: ${message(cause)}`);
    });
  };

  return <ThemeContext.Provider value={displayTheme}><ShortcutContext.Provider value={data.settings.keybindings}><View ref={appView} collapsable={false} style={s.root}>
    {!!error && <View pointerEvents={dialogOpen || settingsOpen ? 'none' : 'auto'} accessibilityElementsHidden={dialogOpen || settingsOpen} importantForAccessibility={dialogOpen || settingsOpen ? 'no-hide-descendants' : 'auto'} style={s.errorBar} accessibilityRole="alert"><Text selectable style={s.errorText}>{error}</Text><Button compact onPress={() => setError('')}>Dismiss</Button></View>}
    {!presenting && <View pointerEvents={dialogOpen || settingsOpen ? 'none' : 'auto'} accessibilityElementsHidden={dialogOpen || settingsOpen} importantForAccessibility={dialogOpen || settingsOpen ? 'no-hide-descendants' : 'auto'}>{header}</View>}
    <View pointerEvents={dialogOpen || settingsOpen ? 'none' : 'auto'} accessibilityElementsHidden={dialogOpen || settingsOpen} importantForAccessibility={dialogOpen || settingsOpen ? 'no-hide-descendants' : 'auto'} style={[s.workspace, presenting && {paddingHorizontal: 0, paddingBottom: 0, gap: 0}]}>
      <View style={s.stage}>
        {!video ? <LibraryBrowser {...libraryProps} /> : <>
        <ThemeContext.Provider value={videoTheme}>
          <View onLayout={event => setPlayerSize(event.nativeEvent.layout)} style={[vs.playerArea, s.playerFrame, presenting && vs.playerPresent]}>
            {video ? <GamePackPlayer key={video.id} style={vs.nativePlayer} source={video.path} zoom={zoom} onZoom={event => setZoom(event.nativeEvent.zoom)} paused={paused} pauseOnDrawing={data.settings.pause_after_drawing} rate={rate}
              seekUs={seekState.us} seekToken={seekState.token} reviewEndUs={reviewEnd} sceneJson={sceneJson}
              captureToken={captureToken} stepToken={step.token} stepFrames={step.frames} onCaptureFinished={event => void onCaptureFinished(event.nativeEvent)}
              tool={(!busy || !!captureRequest.current) && (draft || tool === 'pointer' || tool === 'laser') ? tool : 'none'} strokeColor={strokeColor}
              onDrawingStart={event => { setTime(event.nativeEvent.time_us); if (event.nativeEvent.paused) setPaused(true); if (presenting) setComposerOpen(false); }}
              onPointer={event => { setLastPointer(normalizedPoint({x: event.nativeEvent.x * playerSize.width, y: event.nativeEvent.y * playerSize.height}, videoRect)); setZoomOpen(false); setSpeedOpen(false); if (tool === 'laser') setPointerPulse({...event.nativeEvent, token: Date.now()}); else { commentInput.current?.blur(); play(); } }}
              onTime={event => onTime(event.nativeEvent)} onDrawing={event => onDrawing(event.nativeEvent.drawingJson)} /> :
              <ThemeContext.Provider value={displayTheme}><Empty title="No videos" action={<Button primary disabled={!!busy || dialogOpen} onPress={() => projectId ? importVideo() : setProjectOpen(true)}>{projectId ? 'Add video' : 'New project'}</Button>} /></ThemeContext.Provider>}
            {presenting && header}
            {!!video && <>
              <ThemeContext.Provider value={displayTheme}>
                {notesVisible && <VideoNote notes={onVideoNotes} comments={videoComments} profileName={data.profile.name} colors={railColors} expanded={expanded}
                  viewport={playerSize} rect={videoRect} topInset={presenting ? 76 : 16} disabled={!!busy || dialogOpen || settingsOpen}
                  replyParent={draft?.parent_comment_id} composer={draft?.parent_comment_id ? composer : null}
                  onPause={() => setPaused(true)} onReply={replyToNote} onMove={moveComment}
                  onToggle={item => { setPaused(true); setExpanded(previous => previous.has(item.comment_id) ? new Set() : new Set([item.comment_id])); }} />}
                {!!draft && !draft.parent_comment_id && composerOpen && <SpatialCard position={notePosition(draft)} viewport={playerSize} rect={videoRect} width={Math.min(320, playerSize.width - 100)} topInset={presenting ? 76 : 16} active disabled={!!busy || dialogOpen}
                  onGrab={() => { setPaused(true); commentInput.current?.blur(); }} onMove={position => updateDraft({position})}>
                  <View style={{borderRadius: 14, borderWidth: 1, borderColor: colors.line, overflow: 'hidden'}}><ScrollView keyboardShouldPersistTaps="handled" style={{maxHeight: cardAvailableHeight(playerSize, videoRect, presenting ? 76 : 16, 98)}}>{composer}</ScrollView></View>
                </SpatialCard>}
              </ThemeContext.Provider>
              {tool === 'laser' && <PointerPulse point={pointerPulse} />}
              <View style={vs.videoControls}>
                <View pointerEvents={busy ? 'none' : 'auto'} style={vs.transport}>
                  <View style={vs.transportRow}>
                    <Button compact shortcut="play" disabled={!!busy || dialogOpen} style={vs.playButton} label={paused ? 'Play video' : 'Pause video'} icon={paused ? 'play' : 'pause'} onPress={play} />
                    <Text style={vs.time}>{timeLabel(time)}<Text style={{color: videoTheme.colors.faint}}> / {timeLabel(duration)}</Text></Text>
                    <View style={{flex: 1, marginHorizontal: 12}}><Timeline time={time} duration={duration} comments={[]} selectedId={commentId} onSeek={value => { if (!draft) { setIsolatedReview(false); setCommentId(null); } seek(value); }} /></View>
                    <Button quiet compact disabled={!!busy || dialogOpen} label="Playback speed" expanded={speedOpen} onPress={() => { setSpeedOpen(value => !value); setZoomOpen(false); }}>{rate}×</Button>
                    <Button quiet compact label="Video zoom" expanded={zoomOpen} disabled={!!busy || dialogOpen} onPress={() => { setZoomOpen(value => !value); setSpeedOpen(false); }}>{Math.round(zoom * 100)}%</Button>
                    <Button quiet compact icon={presenting ? 'minimize' : 'maximize'} label={presenting ? 'Exit full screen' : 'Enter full screen'} shortcut="present" disabled={!!busy || dialogOpen} onPress={togglePresentation} />
                  </View>
                </View>
              </View>
              {speedOpen && <View style={[vs.drawingPalette, {zIndex: 40, left: undefined, top: undefined, right: 74, bottom: 66, flexDirection: 'column', gap: 2}]}>
                {[.5, 1, 1.5, 2].map(value => <Button quiet compact key={value} active={rate === value} label={`Playback speed ${value}×`} onPress={() => { setRate(value); setSpeedOpen(false); }}>{value}×</Button>)}
              </View>}
              {zoomOpen && <View style={[vs.drawingPalette, {zIndex: 40, left: undefined, top: undefined, right: 18, bottom: 66, flexDirection: 'column', gap: 2}]}>
                {[1, 1.5, 2, 3, 4].map(value => <Button quiet compact key={value} active={zoom === value} label={`Zoom ${value * 100}%`} onPress={() => { setZoom(value); setZoomOpen(false); }}>{value === 1 ? 'Fit' : `${value * 100}%`}</Button>)}
              </View>}
              <ThemeContext.Provider value={displayTheme}>
                <View style={[s.toolBar, presenting && {top: 76}]}>
                  <Button quiet compact shortcut="pointer" icon="pointer" label="Pointer" active={tool === 'pointer'} disabled={!!busy || dialogOpen} onPress={() => { chooseTool('pointer'); setPaletteOpen(false); }} />
                  {(['pen', 'arrow', 'ellipse'] as const).map(value => <Button key={value} quiet compact shortcut={value} icon={value} label={value === 'pen' ? 'Pen' : value === 'arrow' ? 'Arrow' : 'Ellipse'} active={tool === value} disabled={!!busy || dialogOpen} onPress={() => chooseTool(value)} />)}
                  <Button quiet compact shortcut="laser" icon="target" label="Laser pointer" active={tool === 'laser'} disabled={!!busy || dialogOpen} onPress={() => chooseTool('laser')} />
                  <View style={{height: 1, width: 22, backgroundColor: colors.separator, marginVertical: 3}} />
                  <Button quiet compact shortcut="comment" icon="comment" label="Add comment" disabled={!!busy || dialogOpen} onPress={focusComment} />
                  {tool !== 'pointer' && tool !== 'laser' && <Pressable accessibilityRole="button" accessibilityLabel="Drawing colors" accessibilityState={{expanded: paletteOpen}} onPress={() => setPaletteOpen(value => !value)} style={[s.swatch, {marginVertical: 3}]}><View style={[s.swatchFill, {backgroundColor: strokeColor}]} /></Pressable>}
                  {!!draft && (!!draft.drawings.length || !!redo.length) && <><View style={{height: 1, width: 22, backgroundColor: colors.separator, marginVertical: 3}} /><Button quiet compact shortcut="undo" label="Undo drawing" disabled={!draft.drawings.length || !!busy || dialogOpen} icon="undo" onPress={undoDrawing} /><Button quiet compact shortcut="redo" label="Redo drawing" disabled={!redo.length || !!busy || dialogOpen} icon="redo" onPress={redoDrawing} /></>}
                </View>
                {paletteOpen && tool !== 'pointer' && tool !== 'laser' && <View style={[s.drawingPalette, presenting && {top: 76}]}>{palette.map((color, index) => <Pressable key={color} disabled={!!busy || dialogOpen} accessibilityRole="button" accessibilityLabel={`Drawing color ${['Blue', 'White', 'Amber', 'Green'][index]}`} accessibilityState={{selected: strokeColor === color}}
                  onPress={() => { setStrokeColor(color); setPaletteOpen(false); }} style={[s.swatch, strokeColor === color && s.swatchSelected]}><View style={[s.swatchFill, {backgroundColor: color}]} /></Pressable>)}</View>}
              </ThemeContext.Provider>
            </>}
          </View>
        </ThemeContext.Provider>
        {!presenting && <ReviewTimeline video={video} time={time} duration={duration} comments={originalComments} selectedId={commentId} disabled={!!busy || dialogOpen} onSelect={selectComment} onCluster={items => leaveDraft(() => { setNotesVisible(true); const next = items[(items.findIndex(item => item.comment_id === commentId) + 1) % items.length]; selectCommentNow(next); setIsolatedReview(false); setExpanded(new Set([next.comment_id])); })} onSeek={value => { if (!draft) { setIsolatedReview(false); setCommentId(null); } seek(value); }} />}
        </>}
        {!!busy && <View style={s.statusRow}><Text style={s.status}>{busy}</Text></View>}
      </View>
    </View>
    {libraryOpen && !settingsOpen && <><Pressable accessible={false} focusable={false} style={[StyleSheet.absoluteFill, {zIndex: 3}]} onPress={() => setLibraryOpen(false)} />{libraryPanel}</>}
    {settingsOpen && <View style={[StyleSheet.absoluteFill, {zIndex: 100, alignItems: 'center', justifyContent: 'center', padding: 24}]} accessibilityViewIsModal>
      <Pressable accessible={false} style={[StyleSheet.absoluteFill, {backgroundColor: '#00000045'}]} onPress={() => { setRecording(null); setSettingsOpen(false); }} />
      <SettingsPage animateEntrance={settingsAnimate} profile={data.profile} initialTab={settingsTab} onProfileSave={saveSettingsProfile} settings={data.settings} recording={recording} error={settingsError || error} busy={!!busy} onRecord={id => { setRecording(id); setSettingsError(''); }} onChange={settings => void savePreferences(settings)} onTheme={choice => void changeTheme(choice)} onClose={() => { setRecording(null); setSettingsOpen(false); }} />
    </View>}
    <Dialog visible={!!deleteTarget} onDismiss={() => { if (!busy) setDeleteTarget(null); }}>
      <Text style={s.modalTitle}>Delete {deleteTarget?.kind}?</Text>
      <Text style={s.modalBody}>{deleteTarget?.kind === 'folder' ? `Remove “${deleteTarget.title}”? Its videos will return to the project.` : `“${deleteTarget?.title}” and its comments will be removed from your library.`}</Text>
      {!!error && <Text accessibilityRole="alert" style={{color: colors.danger}}>{error}</Text>}
      <View style={s.modalActions}><Button autoFocus disabled={!!busy} onPress={() => setDeleteTarget(null)}>Cancel</Button><Button danger disabled={!!busy} onPress={() => void deleteItem()}>Delete</Button></View>
    </Dialog>
    <Dialog visible={!!folderDialog} onDismiss={() => { if (!busy) setFolderDialog(null); }}>
      <Text style={s.modalTitle}>{folderDialog?.kind === 'create' ? 'New folder' : folderDialog?.kind === 'renameProject' ? 'Rename project' : 'Rename folder'}</Text>
      <TextField autoFocus accessibilityLabel={folderDialog?.kind === 'renameProject' ? 'Project name' : 'Folder name'} placeholder={folderDialog?.kind === 'renameProject' ? 'Project name' : 'Folder name'} placeholderTextColor={colors.faint} style={s.input} value={folderTitle} onChangeText={setFolderTitle} maxLength={100} onSubmitEditing={() => void saveFolder()} />
      {!!error && <Text accessibilityRole="alert" style={[s.hint, {color: colors.danger}]}>{error}</Text>}
      <View style={s.modalActions}><Button disabled={!!busy} onPress={() => setFolderDialog(null)}>Cancel</Button><Button primary disabled={!folderTitle.trim() || !!busy} onPress={() => void saveFolder()}>{folderDialog?.kind === 'create' ? 'Create' : 'Save'}</Button></View>
    </Dialog>
    <Dialog visible={!!moveTarget} onDismiss={() => { if (!busy) setMoveTarget(null); }}>
      <Text style={s.modalTitle}>Move video</Text>
      <ScrollView style={{maxHeight: 320}} keyboardShouldPersistTaps="handled">
        <Button quiet icon="folder" disabled={!!busy || !moveTarget?.folder_id} onPress={() => void moveVideo(null)} style={{justifyContent: 'flex-start', marginBottom: 6}}>Project videos</Button>
        {data.folders.filter(item => item.project_id === moveTarget?.project_id).map(item => <Button key={item.id} quiet icon="folder" disabled={!!busy || moveTarget?.folder_id === item.id} onPress={() => void moveVideo(item.id)} style={{justifyContent: 'flex-start', marginBottom: 6}}>{item.title}</Button>)}
      </ScrollView>
      {!!error && <Text accessibilityRole="alert" style={[s.hint, {color: colors.danger}]}>{error}</Text>}
      <View style={s.modalActions}><Button autoFocus disabled={!!busy} onPress={() => setMoveTarget(null)}>Cancel</Button></View>
    </Dialog>
    <Dialog visible={profileOpen} onDismiss={closeProfile}>
      <Text style={s.modalTitle}>Your name</Text>
      <Text style={s.fieldLabel}>Name</Text><TextField autoFocus accessibilityLabel="Display name" placeholder="Your name" placeholderTextColor={colors.faint} style={s.input} value={profileName} onChangeText={setProfileName} maxLength={100} onSubmitEditing={() => void saveProfile()} />

      {!!error && <Text accessibilityRole="alert" style={[s.hint, {color: colors.danger}]}>{error}</Text>}
      <View style={s.modalActions}><Button disabled={!!busy} onPress={closeProfile}>Cancel</Button><Button primary disabled={!profileName.trim() || !!busy} onPress={() => void saveProfile()}>Save</Button></View>
    </Dialog>
    <Dialog visible={projectOpen} onDismiss={() => { if (!busy) setProjectOpen(false); }}>
      <Text style={s.modalTitle}>New project</Text><TextField autoFocus accessibilityLabel="Project name" placeholder="Project name" placeholderTextColor={colors.faint} style={s.input} value={projectTitle} onChangeText={setProjectTitle} maxLength={100} onSubmitEditing={() => void createProject()} />
      {!!error && <Text accessibilityRole="alert" style={[s.hint, {color: colors.danger}]}>{error}</Text>}
      <View style={s.modalActions}><Button disabled={!!busy} onPress={() => setProjectOpen(false)}>Cancel</Button><Button primary disabled={!projectTitle.trim() || !!busy} onPress={() => void createProject()}>Create</Button></View>
    </Dialog>
    <Dialog visible={discardOpen} onDismiss={() => { if (!busy) setDiscardOpen(false); }}>
      <Text style={s.modalTitle}>Discard comment?</Text><View style={s.modalActions}><Button autoFocus onPress={() => setDiscardOpen(false)}>Keep editing</Button><Button primary onPress={() => void discard()}>Discard</Button></View>
    </Dialog>
  </View></ShortcutContext.Provider></ThemeContext.Provider>;
}

function VideoPickerMenu({videos, currentId, anchor, availableHeight, folder, onSelect, onBrowse, onImport, onDismiss}: {
  videos: Video[]; currentId: string | null; anchor: Point; availableHeight: number; folder: boolean;
  onSelect: (video: Video) => void; onBrowse: () => void; onImport: () => void; onDismiss: () => void;
}) {
  const {colors} = useTheme();
  const currentIndex = Math.max(0, videos.findIndex(item => item.id === currentId));
  const [focused, setFocused] = useState(currentIndex);
  const rows = useRef<(View | null)[]>([]);
  const list = useRef<ScrollView>(null);
  const listHeight = Math.min(videos.length * 38, Math.max(38, Math.min(304, availableHeight - 96)));
  const focusRow = (index: number) => {
    const next = (index + videos.length + 2) % (videos.length + 2);
    setFocused(next); rows.current[next]?.focus();
    if (next < videos.length) list.current?.scrollTo({y: Math.max(0, next * 38 - listHeight / 2 + 19), animated: false});
  };
  useEffect(() => {
    const frame = requestAnimationFrame(() => focusRow(currentIndex));
    return () => cancelAnimationFrame(frame);
  }, []);
  const keyboardProps = Platform.OS === 'macos' || Platform.OS === 'windows' ? {
    keyDownEvents: ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab'].map(key => ({key})),
    onKeyDown: (event: {nativeEvent: {key: string}; stopPropagation: () => void}) => {
      switch (event.nativeEvent.key) {
        case 'ArrowDown': event.stopPropagation(); focusRow(focused + 1); break;
        case 'ArrowUp': event.stopPropagation(); focusRow(focused - 1); break;
        case 'Home': event.stopPropagation(); focusRow(0); break;
        case 'End': event.stopPropagation(); focusRow(videos.length + 1); break;
        case 'Escape': case 'Tab': event.stopPropagation(); onDismiss(); break;
      }
    },
  } : {};
  const rowStyle = (index: number) => ({height: 36, marginVertical: 1, paddingHorizontal: 11, flexDirection: 'row' as const,
    gap: 9, alignItems: 'center' as const, borderRadius: 7, backgroundColor: focused === index ? colors.inset : 'transparent'});
  return <View {...keyboardProps} accessibilityRole="menu" accessibilityLabel="Choose video" accessibilityViewIsModal
    style={{position: 'absolute', zIndex: 4, left: anchor.x, top: anchor.y, width: 320, padding: 6,
      backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12}}>
    <ScrollView ref={list} style={{height: listHeight, flexGrow: 0}} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={videos.length * 38 > listHeight}>
      {videos.map((item, index) => <MotionPressable key={item.id} ref={node => { rows.current[index] = node; }} focusable
        accessibilityRole="menuitem" accessibilityLabel={videoTitle(item)} accessibilityState={{selected: item.id === currentId}}
        onFocus={() => setFocused(index)} onHoverIn={() => { setFocused(index); rows.current[index]?.focus(); }} onPress={() => onSelect(item)} style={rowStyle(index)}>
        <Text numberOfLines={1} style={{flex: 1, fontSize: 13, lineHeight: 18, color: colors.text, fontWeight: item.id === currentId ? '600' : '400'}}>{videoTitle(item)}</Text>
        {item.id === currentId && <Icon name="check" color={colors.text} />}
      </MotionPressable>)}
    </ScrollView>
    <View style={{height: 1, backgroundColor: colors.separator, marginVertical: 5, marginHorizontal: 5}} />
    {[{label: folder ? 'Browse folder' : 'Browse project', icon: 'folder' as const, action: onBrowse},
      {label: 'Add video', icon: 'plus' as const, action: onImport}].map((item, offset) => {
      const index = videos.length + offset;
      return <MotionPressable key={item.label} ref={node => { rows.current[index] = node; }} focusable accessibilityRole="menuitem"
        onFocus={() => setFocused(index)} onHoverIn={() => { setFocused(index); rows.current[index]?.focus(); }} onPress={item.action} style={rowStyle(index)}>
        <Icon name={item.icon} color={colors.muted} /><Text style={{fontSize: 13, lineHeight: 18, color: colors.text}}>{item.label}</Text>
      </MotionPressable>;
    })}
  </View>;
}

function AnchorEditor({anchor, live, time, duration, locked, disabled, onChange, onError}: {
  anchor: Anchor; live: boolean; time: number; duration: number; locked: boolean; disabled: boolean;
  onChange: (anchor: Anchor) => void; onError: (error: string) => void;
}) {
  const {styles: s} = useTheme();
  return <View>
    {live ? <View style={s.anchorRow}><Text style={[s.commentAnchor, {paddingVertical: 7}]}>{anchorLabel(anchor)}</Text></View> : anchor.kind === 'point' ?
      <View style={s.anchorRow}><TimeField label="At" value={anchor.at_us} disabled={locked || disabled} onChange={value => onChange({kind: 'point', at_us: value})} onError={onError} />
        <Button compact disabled={locked || disabled} onPress={() => onChange({kind: 'point', at_us: time})}>Now</Button>
        <Button compact disabled={locked || disabled || duration <= anchor.at_us} onPress={() => onChange({kind: 'interval', start_us: anchor.at_us, end_us: Math.min(duration, anchor.at_us + 5000000)})}>Add end</Button></View> :
      <View><View style={s.anchorRow}><TimeField label="Start" value={anchor.start_us} disabled={locked || disabled} onChange={value => onChange({...anchor, start_us: value})} onError={onError} />
        <TimeField label="End" value={anchor.end_us} disabled={locked || disabled} onChange={value => onChange({...anchor, end_us: value})} onError={onError} /></View>
        <View style={s.anchorRow}><Button compact style={{flex: 1}} disabled={locked || disabled} onPress={() => onChange({...anchor, start_us: time})}>Start here</Button>
          <Button compact style={{flex: 1}} disabled={locked || disabled} onPress={() => onChange({...anchor, end_us: time})}>End here</Button><Button compact disabled={locked || disabled} onPress={() => onChange({kind: 'point', at_us: anchor.start_us})}>Remove end</Button></View></View>}
  </View>;
}
function TimeField({label, value, disabled, onChange, onError}: {
  label: string; value: number; disabled: boolean; onChange: (value: number) => void; onError: (error: string) => void;
}) {
  const {colors, styles: s} = useTheme();
  const [text, setText] = useState(timeLabel(value, true));
  useEffect(() => setText(timeLabel(value, true)), [value]);
  const commit = () => { const parsed = parseTime(text); if (parsed === null) onError('Enter a time such as 01:30 or 01:30.250.'); else if (parsed !== value) onChange(parsed); setText(timeLabel(value, true)); };
  return <View style={s.anchorField}><Text style={s.fieldLabel}>{label}</Text><TextField accessibilityLabel={label} style={[s.input, s.anchorInput, disabled && {color: colors.muted}]} editable={!disabled}
    value={text} onChangeText={setText} onEndEditing={commit} selectTextOnFocus /></View>;
}
function VisibilityEditor({draft, disabled, onChange, onError}: {
  draft: Draft; disabled: boolean; onChange: (drawings: Drawing[]) => void; onError: (error: string) => void;
}) {
  const {styles: s} = useTheme();
  if (draft.anchor.kind !== 'interval') return null;
  const start = draft.anchor.start_us, end = draft.anchor.end_us, last = draft.drawings[draft.drawings.length - 1];
  return <View style={s.anchorRow}><TimeField label="Show last mark until" value={start + last.visible_until_us} disabled={disabled} onError={onError} onChange={value => {
    if (value > end || value <= start + last.visible_from_us || value <= start + last.samples[last.samples.length - 1].t_us) { onError('Choose an end after the last drawing sample and within the range.'); return; }
    onChange(draft.drawings.map(item => item.id === last.id ? {...item, visible_until_us: value - start} : item));
  }} /></View>;
}
