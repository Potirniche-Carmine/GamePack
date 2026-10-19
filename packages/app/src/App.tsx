import {Glass, GlassSurface, LibraryBackdrop} from './Glass';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View, StyleSheet, useWindowDimensions} from 'react-native';
import {anchorStart, Button, Dialog, Empty, ShortcutContext, TextField} from './components';
import {chooseVideo, command, configureDrawingHistory, configureShortcuts, dataDirectory, GamePackPlayer, listenShortcuts, listenWindowState, setAppearance, setFullScreen} from './native';
import {expandedAncestors, mergeDrawings} from './review';
import {annotationScene, annotationSceneKey, sameFrame} from './playback';
import {Icon} from './Icon';
import {ReviewWorkspace} from './ReviewWorkspace';
import {TooltipProvider} from './Tooltips';
import {PointerPulse} from './PointerPulse';
import {requestZoom, receiveZoom} from './zoom';
import {adjacentNote, conversationTarget, nextReviewStop, notesAtTime, type ReviewStop} from './presentation';
import {SettingsPage} from './SettingsPage';
import {Avatar} from './Avatar';
import {MotionPressable} from './motion';
import {CommentComposer} from './CommentComposer';
import {drawingEndPosition, type Point} from './spatial';
import {conversationRoot} from './discussion';
import {canPostDraft, extendPlayDraft, playDraftSeek, resumableDraft} from './drafts';
import {LibraryBrowser} from './LibraryBrowser';
import {libraryContents, videoTitle} from './library';
import {ReviewTimeline} from './ReviewTimeline';
import {binding, bindingError, effectiveShortcutChords, migrateReviewBindings, shortcutAction, type ShortcutEvent} from './shortcuts';
import {ThemeContext, useTheme, useThemeChoice} from './theme';
import type {Bootstrap, StrokeFlushFinished, Comment, Draft, Drawing, DrawingTool, PlayerTime, Profile, Project, Folder, Settings, ThemeChoice, Video} from './types';

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, value => {
  const random = Math.floor(Math.random() * 16);
  return (value === 'x' ? random : (random & 3) | 8).toString(16);
});
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
type StrokeFlushRequest = {token: number; draftId: string; purpose: 'save' | 'leave' | 'undo' | 'redo'; after?: () => void | Promise<void>};

export default function App() {
  const {width, height} = useWindowDimensions();
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>('system');
  const theme = useThemeChoice(themeChoice);
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
  const [zoomState, setZoomState] = useState({value: 1, token: 0});
  const zoom = zoomState.value;
  const setZoom = (value: number | ((previous: number) => number)) => setZoomState(previous => requestZoom(previous, value));
  const [zoomOpen, setZoomOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const focusParent = useRef<string | null>(null);
  const [avatarFocused, setAvatarFocused] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [commentId, setCommentId] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [annotationMode, setAnnotationMode] = useState<'point' | 'play'>('point');
  const captureRate = useRef<number | null>(null);
  const [reviewMode, setReviewMode] = useState<'watch' | 'review'>('review');
  const [reviewStop, setReviewStop] = useState<ReviewStop | null>(null);
  const lastReviewStop = useRef<number | null>(null);
  const playbackContext = useRef({comments: [] as Comment[], duration: 0, rate: 1, editing: false});
  const [seekState, setSeekState] = useState({us: 0, token: 0});
  const seekRequest = useRef(seekState);
  const [flushToken, setFlushToken] = useState(0);
  const [acknowledgedFlushToken, setAcknowledgedFlushToken] = useState(0);
  const [drawingActive, setDrawingActive] = useState(false);
  const [tool, setTool] = useState<DrawingTool>('pointer');
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const displayTheme = theme;
  const {colors, styles: s} = displayTheme;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [videoMenuAnchor, setVideoMenuAnchor] = useState({x: 24, y: 64});
  const appView = useRef<View>(null);
  const videoMenuTrigger = useRef<View>(null);
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  const setLibraryVisible = setLibraryOpen;
  const [pointerPulse, setPointerPulse] = useState<{x: number; y: number; token: number} | null>(null);
  const [readyScene, setReadyScene] = useState('');
  const [activityToken, setActivityToken] = useState(0);
  const scrubTarget = useRef(0);
  const [composerOpen, setComposerOpen] = useState(false);
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
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const flushRequest = useRef<StrokeFlushRequest | null>(null);
  const savingDraftId = useRef<string | null>(null);
  const pendingPublish = useRef<string | null>(null);
  const flushSequence = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const metadataSent = useRef(new Set<string>());
  const sourceGeneration = useRef(0);
  const discarding = useRef<string | null>(null);

  const video = data?.videos.find(item => item.id === videoId) ?? null;
  const draft = data?.drafts.find(item => item.id === draftId) ?? null;
  const videoComments = useMemo(() => data?.comments.filter(item => item.video_id === videoId) ?? [], [data?.comments, videoId]);
  const originalComments = useMemo(() => videoComments.filter(item => !item.parent_comment_id), [videoComments]);
  const allRepliesExpanded = originalComments.length > 0 && originalComments.every(item => expanded.has(item.comment_id));
  const projectVideos = data ? libraryContents(data.projects, data.folders, data.videos, projectId, folderId).videos : [];
  const sceneTime = paused ? time : -1;
  const sceneJson = useMemo(() => {
    if (reviewMode !== 'review' || !annotationsVisible) return '';
    if (draft) {
      const root = draft.parent_comment_id ? conversationRoot(videoComments, draft.parent_comment_id) : undefined;
      const context = root ? annotationScene(videoComments.filter(item => conversationRoot(videoComments, item.comment_id)?.comment_id === root.comment_id), draft.anchor.at_us, true) : null;
      return JSON.stringify({id: draft.id, anchor: draft.anchor, capture: true, flushed: acknowledgedFlushToken, captureEndUs: draft.anchor.kind === 'play' ? draft.parent_comment_id ? draft.anchor.end_us : duration : undefined, drawings: [...(context?.drawings ?? []), ...draft.drawings]});
    }
    const scene = annotationScene(videoComments, sceneTime, paused, commentId, reviewStop?.time);
    return scene ? JSON.stringify(scene) : '';
  }, [draft, videoComments, sceneTime, paused, commentId, annotationsVisible, reviewMode, reviewStop?.time, duration, acknowledgedFlushToken]);
  const onVideoNotes = useMemo(() => {
    const notes = notesAtTime(videoComments, time).filter(note => paused || note.anchor.kind === 'play');
    const root = draft?.parent_comment_id ? conversationRoot(videoComments, draft.parent_comment_id) : undefined;
    if (root && !notes.some(note => note.comment_id === root.comment_id)) notes.push(root);
    return notes;
  }, [videoComments, time, paused, draft?.parent_comment_id]);
  const sceneKey = useMemo(() => annotationSceneKey(sceneJson, seekState.token, step.token), [sceneJson, seekState.token, step.token]);
  const presentedSceneKey = sceneKey === readyScene ? sceneKey : '';
  const previousNote = adjacentNote(videoComments, commentId, time, duration, -1);
  const nextNote = adjacentNote(videoComments, commentId, time, duration, 1);
  playbackContext.current = {comments: originalComments, duration, rate, editing: !!draft || reviewMode !== 'review'};
  const reviewEnd = draft?.anchor.kind === 'play' && draft.parent_comment_id ? draft.anchor.end_us : !draft && reviewMode === 'review' ? reviewStop?.time ?? -1 : -1;
  const dialogOpen = profileOpen || projectOpen || discardOpen || !!deleteTarget || !!folderDialog || !!moveTarget;
  const historyEnabled = !!video && reviewMode === 'review' && !busy && !dialogOpen && !settingsOpen && !libraryOpen;
  useEffect(() => {
    configureDrawingHistory(historyEnabled && (!!draft?.drawings.length || drawingActive), historyEnabled && !!redo.length);
  }, [historyEnabled, draft?.drawings.length, redo.length, drawingActive]);

  useEffect(() => {
    if (!draft || !composerOpen || focusParent.current === null || (draft.parent_comment_id ?? '') !== focusParent.current) return;
    const frame = requestAnimationFrame(() => { commentInput.current?.focus(); focusParent.current = null; });
    return () => cancelAnimationFrame(frame);
  }, [draft?.id, composerOpen, focusRequest]);
  useEffect(() => {
    if (presenting && !video && !loading) setFullScreen(false);
  }, [presenting, !!video, loading]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (flushTimer.current) clearTimeout(flushTimer.current); };
  }, []);
  useEffect(() => {
    const listener = listenWindowState(event => {
      // Restore the header only after the native window has its final bounds.
      // Mounting it during macOS's fullscreen exit can retain the wider layout.
      if (event.fullScreen !== undefined) setPresenting(event.fullScreen);
    });
    return () => listener.remove();
  }, []);
  useEffect(() => { const listener = listenShortcuts(event => shortcutHandler.current(event)); return () => listener.remove(); }, []);
  useEffect(() => {
    const bindings = data?.settings.keybindings ?? {};
    const chords = !data || busy || libraryMenuOpen ? [] : dialogOpen || libraryOpen ? ['Escape'] : settingsOpen ? [binding('settings', bindings), 'Escape'] : [...effectiveShortcutChords(bindings, reviewMode), ...(presenting && reviewMode === 'review' ? ['PageUp', 'PageDown'] : []), 'Escape'];
    configureShortcuts(chords.filter((chord): chord is string => !!chord), !!recording && !busy, !dialogOpen && !settingsOpen && reviewMode === 'review' ? binding('submit', bindings) ?? '' : '');
  }, [data?.settings.keybindings, !!data, busy, dialogOpen, settingsOpen, recording, presenting, libraryMenuOpen, libraryOpen, reviewMode]);
  useEffect(() => { if (data) { try { setAppearance(themeChoice); } catch (cause) { setError(message(cause)); } } }, [themeChoice, !!data]);
  const seek = useCallback((us: number) => {
    const target = Math.max(0, Math.round(us));
    seekRequest.current = {us: target, token: seekRequest.current.token + 1};
    setReadyScene('');
    setSeekState(seekRequest.current);
    setTime(target);
    lastReviewStop.current = null;
    const context = playbackContext.current;
    setReviewStop(context.editing ? null : nextReviewStop(context.comments, target, context.duration, context.rate < 0 ? -1 : 1));
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const directory = await dataDirectory();
      const state = await command<Bootstrap>(directory, 'bootstrap');
      const keybindings = migrateReviewBindings(state.settings.keybindings);
      if (Object.keys(keybindings).length !== Object.keys(state.settings.keybindings).length)
        state.settings = await command<Settings>(directory, 'set_preferences', {keybindings});
      if (!mounted.current) return;
      setRoot(directory); setData(state); setThemeChoice(state.settings?.theme ?? 'system');
      draftsRef.current = state.drafts;
      setVideoId(null); setProjectId(null); setFolderId(null); setDuration(0);
    } catch (cause) { setError(message(cause)); }
    finally { setLoading(false); }
  }, [seek]);
  useEffect(() => { void load(); }, [load]);

  const persist = useCallback((value: Draft): Promise<Draft> => {
    const pending = saveChain.current.catch(() => undefined).then(() => command<Draft>(root, 'save_draft', {draft: value}));
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
  }, [root]);
  const scheduleSave = (id: string) => {
    const previous = timers.current.get(id);
    if (previous) clearTimeout(previous);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      const latest = draftsRef.current.find(item => item.id === id);
      if (latest) void persist(latest).catch(() => undefined);
    }, 300));
  };
  const replaceDraft = (value: Draft) => {
    draftsRef.current = [...draftsRef.current.filter(item => item.id !== value.id), value];
    setData(previous => previous ? {...previous, drafts: draftsRef.current} : previous);
    scheduleSave(value.id);
  };
  const updateDraft = (fields: Partial<Draft>) => {
    const current = draftsRef.current.find(item => item.id === activeDraftRef.current);
    if (!current || busy) return;
    replaceDraft({...current, ...fields});
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
    if (captureRate.current !== null) { setRate(captureRate.current); captureRate.current = null; }
    setAnnotationMode('point'); setDrawingActive(false);
    setDraftId(null); activeDraftRef.current = null; setTool('pointer'); setRedo([]);
  };
  const leaveDraft = (after: () => void | Promise<void>) => {
    if (busy || flushRequest.current) return;
    if (draftsRef.current.some(item => item.id === activeDraftRef.current)) requestStrokeFlush('leave', after);
    else void after();
  };
  const restoreDraftNow = (pending: Draft) => {
    if (pending.anchor.kind === 'play' && captureRate.current === null) captureRate.current = rate;
    if (pending.anchor.kind === 'point' && captureRate.current !== null) { setRate(captureRate.current); captureRate.current = null; }
    setAnnotationMode(pending.anchor.kind);
    activeDraftRef.current = pending.id; setDraftId(pending.id); setCommentId(null);
    setComposerOpen(true); setLibraryVisible(false);
    setPaused(true); setTool('pointer'); setRedo([]);
    const parent = data?.comments.find(item => item.comment_id === pending.parent_comment_id);
    const pendingDuration = data?.videos.find(item => item.id === pending.video_id)?.duration_us || duration;
    seek(pending.anchor.kind === 'play' ? pending.anchor.end_us : parent ? conversationTarget(data?.comments ?? [], parent, pendingDuration).time : anchorStart(pending.anchor));
  };
  const openVideoNow = async (item: Video) => {
    const generation = ++sourceGeneration.current;
    setPaused(true); clearEditing(); setRate(1); setZoomOpen(false); setSpeedOpen(false); setZoom(1); setVideoId(item.id); setProjectId(item.project_id); setFolderId(item.folder_id ?? null); setLibraryOpen(false);
    setCommentId(null); setExpanded(new Set()); setDuration(item.duration_us); seek(0);
    setComposerOpen(false);
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
  const newDraftNow = (parent?: Comment, timing = annotationMode) => {
    if (!video || busy || reviewMode !== 'review') return;
    setComposerOpen(!!parent); setLibraryVisible(false);
    if (draft && !parent) return draft;
    const pending = parent ? resumableDraft(draftsRef.current, video.id, parent.comment_id) : undefined;
    if (pending) { restoreDraftNow(pending); return pending; }

    try {
      const value: Draft = {id: uuid(), project_id: video.project_id, video_id: video.id, text: '',
        anchor: parent?.anchor ?? (timing === 'play' ? {kind: 'play', at_us: Math.min(time, duration || time), end_us: Math.min(time, duration || time)} : {kind: 'point', at_us: Math.min(time, duration || time)}),
        parent_comment_id: parent?.comment_id ?? null, drawings: [], position: parent?.position};
      if (value.anchor.kind === 'play' && captureRate.current === null) captureRate.current = rate;
      if (value.anchor.kind === 'point' && captureRate.current !== null) { setRate(captureRate.current); captureRate.current = null; }
      setAnnotationMode(value.anchor.kind);
      replaceDraft(value); activeDraftRef.current = value.id; setDraftId(value.id); setCommentId(null);
      setTool('pointer'); setRedo([]);
      setPaused(true); seek(parent && value.anchor.kind === 'play' ? value.anchor.end_us : anchorStart(value.anchor));
      return value;
    } catch (cause) { setError(message(cause)); }
  };
  const selectCommentNow = (item: Comment) => {
    const target = conversationTarget(data?.comments ?? [], item, duration);
    clearEditing(); setCommentId(target.comment.comment_id); setPaused(true);
    if (!paused || !sameFrame(time, target.time)) seek(target.time);
    lastReviewStop.current = target.time;
    setExpanded(previous => new Set(expandedAncestors(data?.comments ?? [], item.comment_id, previous)).add(target.comment.comment_id));
  };
  const selectComment = (item: Comment) => leaveDraft(() => selectCommentNow(item));
  const dismissSelectionNow = () => { clearEditing(); setCommentId(null); };
  const armReview = (at: number, nextRate = rate, skipCurrent = paused || (lastReviewStop.current !== null && sameFrame(lastReviewStop.current, at))) => setReviewStop(reviewMode === 'review'
    ? nextReviewStop(originalComments, at, duration, nextRate < 0 ? -1 : 1, skipCurrent) : null);
  const startPlayback = (nextRate = captureRate.current ?? rate) => {
    const at = duration && time >= duration && nextRate > 0 ? 0 : time;
    clearEditing(); setComposerOpen(false); setCommentId(null); setLibraryOpen(false);
    setRate(nextRate);
    if (at !== time) seek(at);
    // Play leaves the frame already available to read, including the opening
    // frame and frames reached by scrubbing rather than an automatic stop.
    setReadyScene(''); armReview(at, nextRate, true); setPaused(false);
  };
  const shuttle = (direction: -1 | 1) => {
    const nextRate = !paused && Math.sign(rate) === direction ? direction * Math.min(4, Math.abs(rate) * 2) : direction;
    leaveDraft(() => startPlayback(nextRate));
  };
  const play = () => {
    if (!video || busy) return;
    if (!paused) { setPaused(true); if (draft?.anchor.kind === 'play' && draft.drawings.length) setComposerOpen(true); return; }
    if (draft?.anchor.kind === 'play') {
      commentInput.current?.blur(); setComposerOpen(false); setReviewStop(null);
      if (rate < 0) setRate(Math.abs(rate));
      if (time >= (draft.parent_comment_id ? draft.anchor.end_us : duration)) seek(draft.anchor.at_us);
      setPaused(false); return;
    }
    leaveDraft(() => startPlayback());
  };
  const scrubTo = (us: number) => {
    scrubTarget.current = us;
    if (flushRequest.current) return;
    if (draft?.anchor.kind === 'play') {
      setPaused(true); seek(playDraftSeek(draft, us, duration)); return;
    }
    leaveDraft(() => {
      clearEditing(); setComposerOpen(false); setCommentId(null); setPaused(true); seek(scrubTarget.current);
    });
  };
  const changeReviewMode = (mode: 'watch' | 'review') => {
    if (mode === reviewMode) return;
    leaveDraft(() => {
      clearEditing(); setComposerOpen(false); setCommentId(null); setPointerPulse(null);
      commentInput.current?.blur(); focusParent.current = null;
      setReviewMode(mode);
      setReviewStop(mode === 'review' ? nextReviewStop(originalComments, time, duration, rate < 0 ? -1 : 1, paused || (lastReviewStop.current !== null && sameFrame(lastReviewStop.current, time))) : null);
    });
  };
  const onTime = (event: PlayerTime) => {
    if (event.seekToken !== undefined && event.seekToken !== seekRequest.current.token) return;
    if (Number.isFinite(event.time_us)) {
      const now = Math.max(0, Math.round(event.time_us));
      const current = draftsRef.current.find(item => item.id === activeDraftRef.current);
      if (current?.anchor.kind === 'play') {
        const bounded = playDraftSeek(current, now, duration);
        if (!sameFrame(now, bounded)) { setPaused(true); seek(bounded); return; }
      }
      setTime(now);
      if (current?.anchor.kind === 'play' && !current.parent_comment_id && !flushRequest.current && !savingDraftId.current
        && (now > current.anchor.end_us + 1000000 || (!event.playing && now > current.anchor.end_us)))
        replaceDraft(extendPlayDraft(current, now));

    }
    if (event.duration_us > 0) setDuration(Math.round(event.duration_us));
    if (event.error) { setError(`Playback failed: ${event.error}`); setPaused(true); }
    if (event.ended) {
      setPaused(true);
      if (draft?.anchor.kind === 'play' && draft.drawings.length) setComposerOpen(true);
      if (reviewMode === 'review' && !draft && reviewStop && (rate < 0 ? event.time_us <= reviewStop.time : event.time_us >= reviewStop.time)) {
        if (!sameFrame(event.time_us, reviewStop.time)) seek(reviewStop.time);
        lastReviewStop.current = reviewStop.time;
        setExpanded(new Set(reviewStop.commentIds)); setCommentId(reviewStop.commentIds[0]);
      }
    }
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
    setDrawingActive(false);
    const id = flushRequest.current?.draftId ?? savingDraftId.current ?? activeDraftRef.current;
    const current = draftsRef.current.find(item => item.id === id);
    if (!current || current.id === discarding.current) return;
    try {
      const drawings = mergeDrawings(current.drawings, [parseDrawing(json)]);
      if (drawings.length === current.drawings.length) return;
      const next: Draft = {...extendPlayDraft(current, time, drawings), position: drawingEndPosition(drawings[drawings.length - 1].samples)};
      replaceDraft(next); setRedo([]);
      if (current.anchor.kind === 'point') {
        setComposerOpen(true); setPaused(true);
        focusParent.current = current.parent_comment_id ?? ''; setFocusRequest(value => value + 1);
      } else if (paused) setComposerOpen(true);
    } catch (cause) { setError(message(cause)); }
  };
  const chooseTool = (value: DrawingTool) => {
    if (!video || busy || reviewMode !== 'review') return;
    setZoomOpen(false); setSpeedOpen(false);
    if (value === 'pointer' || value === 'laser' || tool === value) { setTool(tool === value ? 'pointer' : value); return; }
    if (!draft) { newDraftNow(); setTool(value); setComposerOpen(false); return; }
    setComposerOpen(false);
    setTool(value);
    if (draft.anchor.kind === 'point') { setPaused(true); seek(draft.anchor.at_us); }
  };
  const changeAnnotationMode = () => {
    if (busy || draft?.parent_comment_id || draft?.drawings.length) return;
    const mode = annotationMode === 'point' ? 'play' : 'point';
    setAnnotationMode(mode); setPaused(true); setRedo([]);
    if (!draft && mode === 'play') newDraftNow(undefined, mode);
    if (draft) {
      if (mode === 'play' && captureRate.current === null) captureRate.current = rate;
      updateDraft({anchor: mode === 'play' ? {...draft.anchor, kind: 'play', end_us: draft.anchor.at_us} : {kind: 'point', at_us: draft.anchor.at_us}});
      if (mode === 'point') { seek(draft.anchor.at_us); if (captureRate.current !== null) { setRate(captureRate.current); captureRate.current = null; } }
    }
  };
  const undoDrawing = () => {
    if (!draft || busy) return;
    requestStrokeFlush('undo');
  };
  const redoDrawing = () => {
    if (!draft || !redo.length || busy) return;
    requestStrokeFlush('redo');
  };

  const publishDraft = async (id: string) => {
    setBusy('Saving…'); savingDraftId.current = id; setError('');
    try {
      const latest = await flushLatest(id);
      if (!canPostDraft(latest)) throw new Error(latest.parent_comment_id ? 'Add a reply or drawing before saving.' : 'Add a drawing before saving.');
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
  const requestStrokeFlush = (purpose: StrokeFlushRequest['purpose'], after?: StrokeFlushRequest['after']) => {
    if (!draft || busy || flushRequest.current) return;
    const token = ++flushSequence.current;
    flushRequest.current = {token, draftId: draft.id, purpose, after};
    savingDraftId.current = draft.id;
    setBusy('Saving…'); setError('');
    // The native acknowledgment pauses and finishes a held stroke atomically.
    setFlushToken(token);
    flushTimer.current = setTimeout(() => {
      if (flushRequest.current?.token !== token) return;
      flushRequest.current = null; savingDraftId.current = null; setPaused(true); setBusy('');
      setError('The player did not finish the drawing. Retry Post.');
    }, 10000);
  };
  const onStrokeFlushFinished = async (event: StrokeFlushFinished) => {
    const request = flushRequest.current;
    if (!request || request.token !== event.flushToken) return;
    if (flushTimer.current) clearTimeout(flushTimer.current); flushTimer.current = null;
    try {
      const current = draftsRef.current.find(item => item.id === request.draftId);
      if (!current) throw new Error('The draft is no longer available.');
      if (!Number.isSafeInteger(event.time_us) || event.time_us < 0) throw new Error('The player returned an invalid frame time. Retry Post.');
      const next = extendPlayDraft(current, event.time_us, event.drawingJson ? mergeDrawings(current.drawings, [parseDrawing(event.drawingJson)]) : current.drawings);
      replaceDraft(next); setTime(event.time_us); setPaused(true);
      setDrawingActive(false); setAcknowledgedFlushToken(event.flushToken);
      if (request.purpose === 'save' || request.purpose === 'leave') setTool('pointer');
      flushRequest.current = null;
      if (request.purpose === 'undo' || request.purpose === 'redo') {
        if (request.purpose === 'undo' && next.drawings.length) {
          const removed = next.drawings[next.drawings.length - 1];
          setRedo(previous => [...(event.drawingJson ? [] : previous), removed]);
          replaceDraft({...next, drawings: next.drawings.slice(0, -1)});
        } else if (request.purpose === 'redo' && !event.drawingJson && redo.length) {
          replaceDraft({...next, drawings: [...next.drawings, redo[redo.length - 1]]}); setRedo(previous => previous.slice(0, -1));
        } else if (event.drawingJson) setRedo([]);
        setBusy(''); savingDraftId.current = null; return;
      }
      await flushLatest(next.id);
      if (request.purpose === 'leave') { setBusy(''); savingDraftId.current = null; await request.after?.(); return; }
      setBusy(''); savingDraftId.current = null;
      if (!data?.profile.name.trim()) { pendingPublish.current = next.id; setProfileName(''); setProfileOpen(true); }
      else await publishDraft(next.id);
    } catch (cause) {
      flushRequest.current = null; savingDraftId.current = null; setPaused(true); setBusy(''); setError(message(cause));
    }
  };
  const discard = async () => {
    if (!draft || busy) return;
    discarding.current = draft.id;
    setBusy('Discarding…'); setDiscardOpen(false); setPaused(true); setTool('pointer');
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
    if (presenting) setFullScreen(false);
  });
  const openProject = (project: Project) => browse(project.id);
  const openSettings = (tab: 'profile' | 'appearance' = 'appearance', animate = true) => leaveDraft(() => {
    setPaused(true); setSettingsError(''); setSettingsTab(tab); setSettingsAnimate(animate); setLibraryOpen(false); setZoomOpen(false); setSpeedOpen(false);
    if (presenting) setFullScreen(false);
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
      const saved = await command<Settings>(root, 'set_preferences', {keybindings: settings.keybindings});
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
  const toggleAllReplies = () => setExpanded(allRepliesExpanded ? new Set() : new Set(originalComments.map(item => item.comment_id)));
  const togglePresentation = () => leaveDraft(() => {
     setLibraryOpen(false); setFullScreen(!presenting);
  });
  const replyToNote = (item: Comment) => {
    leaveDraft(() => {
      focusParent.current = item.comment_id; setFocusRequest(value => value + 1); newDraftNow(item);
    });
  };
  const navigateNote = (direction: -1 | 1) => {
    const item = direction === 1 ? nextNote : previousNote;
    if (item) selectComment(item);
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
      else if (presenting) setFullScreen(false);
      else { setTool('pointer'); commentInput.current?.blur(); if (draft?.anchor.kind === 'play') { setPaused(true); setComposerOpen(true); } }
      return;
    }
    if (dialogOpen) return;
    const action = event.action ?? shortcutAction(event, data.settings.keybindings, reviewMode);
    // A bridged shortcut can arrive after the editor takes native focus.
    if (commentInput.current?.isFocused() && action !== 'submit') return;
    if (action === 'settings') { if (settingsOpen) setSettingsOpen(false); else openSettings('appearance', false); return; }
    if (settingsOpen) return;
    if (action?.startsWith('project') && /^project[1-9]$/.test(action)) { const item = data.projects[Number(action.slice(-1)) - 1]; if (item) openProject(item); return; }
    if (action === 'nextProject' || action === 'previousProject') { const index = data.projects.findIndex(item => item.id === projectId); const item = data.projects[index + (action === 'nextProject' ? 1 : -1)]; if (item) openProject(item); return; }
    if (action === 'nextVideo' || action === 'previousVideo') { const index = projectVideos.findIndex(item => item.id === videoId); const item = projectVideos[index + (action === 'nextVideo' ? 1 : -1)]; if (item) openVideo(item); return; }
    if (action === 'import') { importVideo(); return; }
    if (action === 'newProject') { leaveDraft(() => { setPaused(true); setProjectOpen(true); }); return; }
    if (action === 'deleteProject') { const item = data.projects.find(item => item.id === projectId); if (item) askDelete('project', item); return; }
    if (!video) return;
    if (presenting && reviewMode === 'review' && (event.chord === 'PageDown' || event.chord === 'PageUp')) { navigateNote(event.chord === 'PageDown' ? 1 : -1); return; }
    switch (action) {
      case 'present': togglePresentation(); break;
      case 'reviewMode': changeReviewMode(reviewMode === 'watch' ? 'review' : 'watch'); break;
      case 'allReplies': setPaused(true); toggleAllReplies(); break;
      case 'play': play(); break;
      case 'pause': setPaused(true); if (draft?.anchor.kind === 'play' && draft.drawings.length) setComposerOpen(true); break;
      case 'forward': shuttle(1); break;
      case 'reverse': shuttle(-1); break;
      case 'previousFrame': case 'nextFrame': {
        const stepFrame = () => { setReadyScene(''); setPaused(true); lastReviewStop.current = null; setStep(previous => ({token: previous.token + 1, frames: action === 'nextFrame' ? 1 : -1})); };
        if (draft?.anchor.kind === 'play') stepFrame();
        else leaveDraft(() => { clearEditing(); setCommentId(null); stepFrame(); });
        break;
      }
      case 'back': scrubTo(Math.max(0, time - 5000000)); break;
      case 'ahead': scrubTo(Math.min(duration, time + 5000000)); break;
      case 'start': scrubTo(0); break;
      case 'end': scrubTo(duration); break;
      case 'submit':
        if (draft) {
          const text = commentInput.current?.isFocused() ? event.text : undefined;
          if (text !== undefined) updateDraft({text: text.slice(0, 16000)});
          if (canPostDraft({...draft, text: text ?? draft.text})) requestStrokeFlush('save');
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

  const composer = draft ? <CommentComposer key={draft.id} draft={draft} name={data.profile.name} input={commentInput}
    disabled={!!busy || dialogOpen} saving={busy === 'Saving…'} failed={failedDrafts.has(draft.id)}
    onText={text => updateDraft({text})} onFocus={() => setPaused(true)} onHide={() => leaveDraft(() => { clearEditing(); setComposerOpen(false); commentInput.current?.blur(); })}
    onDiscard={() => { setPaused(true); if (draft.text.trim() || draft.drawings.length) setDiscardOpen(true); else void discard(); }}
    onRetry={() => void flushLatest(draft.id).catch(() => undefined)} onPost={() => requestStrokeFlush('save')} /> : null;
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
  const header = <View style={[s.workspaceHeader, {height: 48, paddingHorizontal: 14, backgroundColor: 'transparent'}]}>
    <MotionPressable accessibilityRole="button" accessibilityLabel="All projects" onFocus={() => setBrandFocused(true)} onBlur={() => setBrandFocused(false)} onPress={() => browse(null)} disabled={!!busy || dialogOpen}
      style={({pressed}) => [s.brandButton, pressed && {opacity: .65}, brandFocused && {backgroundColor: colors.selected}]}>
      <View style={s.brandMark}><Icon name="play" color={colors.primaryText} /></View>
      <Text style={s.brand}>GamePack</Text>
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

  return <ThemeContext.Provider value={displayTheme}><ShortcutContext.Provider value={data.settings.keybindings}><TooltipProvider><View ref={appView} collapsable={false} style={[s.root, !video && {backgroundColor: 'transparent'}]}>
    {!video && <LibraryBackdrop />}
    {!!error && <View pointerEvents={dialogOpen || settingsOpen ? 'none' : 'auto'} accessibilityElementsHidden={dialogOpen || settingsOpen} importantForAccessibility={dialogOpen || settingsOpen ? 'no-hide-descendants' : 'auto'} style={s.errorBar} accessibilityRole="alert"><Text selectable style={s.errorText}>{error}</Text><Button compact onPress={() => setError('')}>Dismiss</Button></View>}
    {!video && <View pointerEvents={dialogOpen || settingsOpen ? 'none' : 'auto'} accessibilityElementsHidden={dialogOpen || settingsOpen} importantForAccessibility={dialogOpen || settingsOpen ? 'no-hide-descendants' : 'auto'} style={{marginHorizontal: 16, marginTop: 12}}><Glass style={{borderRadius: 20}}>{header}</Glass></View>}
    <View pointerEvents={dialogOpen || settingsOpen ? 'none' : 'auto'} accessibilityElementsHidden={dialogOpen || settingsOpen} importantForAccessibility={dialogOpen || settingsOpen ? 'no-hide-descendants' : 'auto'} style={[s.workspace, !!video && {paddingHorizontal: 0, paddingBottom: 0, gap: 0}]}>
      <View style={s.stage}>
        {!video ? <LibraryBrowser {...libraryProps} /> : <>
        <ReviewWorkspace header={header} video={video} time={time} duration={duration} paused={paused} reviewMode={reviewMode} onMode={changeReviewMode}
          comments={videoComments} activityToken={activityToken} sceneReady={!!presentedSceneKey} notes={onVideoNotes} selectedId={commentId} draft={draft}
          composer={composerOpen ? composer : null} expanded={expanded} disabled={!!busy || dialogOpen}
          onSelect={selectComment} onReplay={item => leaveDraft(() => { selectCommentNow(item); seek(item.anchor.at_us); setRate(1); setComposerOpen(false); armReview(item.anchor.at_us, 1, true); setPaused(false); })} onReply={replyToNote} onExpand={item => setExpanded(previous => { const next = new Set(previous); if (next.has(item.comment_id)) next.delete(item.comment_id); else next.add(item.comment_id); return next; })}
          onPlay={play} rate={rate} zoom={zoom} presenting={presenting}
          onSpeed={() => { setSpeedOpen(value => !value); setZoomOpen(false); }} onZoom={() => { setZoomOpen(value => !value); setSpeedOpen(false); }} onPresent={togglePresentation}
          toolbar={<>
            <Button quiet compact icon="cycle" style={{flexDirection: 'column', gap: 2, paddingHorizontal: 6, paddingVertical: 6}} label={`Annotation timing: ${annotationMode === 'play' ? 'Play' : 'Moment'}`} active={annotationMode === 'play'} disabled={!!busy || dialogOpen || !!draft?.parent_comment_id || !!draft?.drawings.length} onPress={changeAnnotationMode}>{annotationMode === 'play' ? 'Play' : 'Moment'}</Button>
            {!draft && resumableDraft(data.drafts, video.id, null) && <Button quiet compact label="Resume comment" disabled={!!busy || dialogOpen} onPress={() => restoreDraftNow(resumableDraft(data.drafts, video.id, null)!)}>Resume</Button>}
            {draft?.anchor.kind === 'play' && !draft.drawings.length && <Button quiet compact icon="close" label="Cancel play comment" disabled={!!busy || dialogOpen} onPress={() => void discard()} />}
            <Button toolbar quiet compact shortcut="pointer" icon="pointer" label="Pointer" active={tool === 'pointer'} disabled={!!busy || dialogOpen} onPress={() => chooseTool('pointer')} />
            {(['pen', 'arrow', 'ellipse'] as const).map(value => <Button key={value} toolbar quiet compact shortcut={value} icon={value} label={value === 'pen' ? 'Pen' : value === 'arrow' ? 'Arrow' : 'Ellipse'} active={tool === value} disabled={!!busy || dialogOpen} onPress={() => chooseTool(value)} />)}
            <Button toolbar quiet compact shortcut="laser" icon="target" label="Laser pointer" active={tool === 'laser'} disabled={!!busy || dialogOpen} onPress={() => chooseTool('laser')} />
          </>}
          timeline={<ReviewTimeline reviewEnd={reviewEnd} paused={paused} rate={rate} seekToken={seekState.token} mode={reviewMode} video={video} time={time} duration={duration} comments={originalComments} draftAnchor={draft?.anchor} selectedId={commentId} disabled={!!busy || dialogOpen} onSelect={selectComment} onCluster={items => { const next = items[(items.findIndex(item => item.comment_id === commentId) + 1) % items.length]; selectComment(next); }} onSeek={scrubTo} />}
          popoverKind={speedOpen ? 'speed' : 'zoom'}
          popover={speedOpen || zoomOpen ? <View style={{gap: 2}}>{(speedOpen ? [.5, 1, 1.5, 2] : [1, 1.5, 2, 3, 4]).map(value => <Button quiet compact key={value} shortcut={!speedOpen && value === 1 ? 'zoomReset' : undefined} active={(speedOpen ? rate : zoom) === value} label={speedOpen ? `Playback speed ${value}×` : `Zoom ${value * 100}%`} onPress={() => { if (speedOpen) { setRate(value); armReview(time, value); } else setZoom(value); setSpeedOpen(false); setZoomOpen(false); }}>{speedOpen ? `${value}×` : value === 1 ? 'Fit' : `${value * 100}%`}</Button>)}</View> : null}
          >
          <GamePackPlayer key={video.id} style={StyleSheet.absoluteFill} source={video.path} zoom={zoom} zoomToken={zoomState.token} onZoom={({nativeEvent}) => setZoomState(previous => receiveZoom(previous, nativeEvent))} paused={paused} rate={rate}
            seekUs={seekState.us} seekToken={seekState.token} reviewEndUs={reviewEnd} sceneJson={sceneJson} presentedSceneKey={presentedSceneKey}
            flushToken={flushToken} stepToken={step.token} stepFrames={step.frames} onStrokeFlushFinished={event => void onStrokeFlushFinished(event.nativeEvent)}
            tool={reviewMode === 'watch' ? busy ? 'none' : 'pointer' : (!busy || !!flushRequest.current) && (draft || tool === 'pointer' || tool === 'laser') ? tool : 'none'}
            onDrawingStart={event => { setDrawingActive(true); setTime(event.nativeEvent.time_us); if (event.nativeEvent.paused) setPaused(true); }}
            onPointer={event => {
              setZoomOpen(false); setSpeedOpen(false);
              if (reviewMode === 'review' && tool === 'laser') setPointerPulse({...event.nativeEvent, token: Date.now()});
              else { commentInput.current?.blur(); play(); }
            }}
            onSceneReady={event => setReadyScene(event.nativeEvent.key)} onActivity={() => setActivityToken(value => value + 1)}
            onTime={event => onTime(event.nativeEvent)} onDrawing={event => onDrawing(event.nativeEvent.drawingJson)} />
          {reviewMode === 'review' && tool === 'laser' && <PointerPulse point={pointerPulse} />}
        </ReviewWorkspace>
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
  </View></TooltipProvider></ShortcutContext.Provider></ThemeContext.Provider>;
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
      borderRadius: 16}}>
    <GlassSurface radius={16} />
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

