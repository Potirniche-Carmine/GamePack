import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions} from 'react-native';
import {anchorLabel, anchorStart, Button, Dialog, Empty, parseTime, Timeline, timeLabel} from './components';
import {chooseVideo, command, dataDirectory, GamePackPlayer, setAppearance} from './native';
import {beginLiveDraft, commentThreads, expandedAncestors, finalizeCapturedClip, finalizeLiveDraft, liveScene, mergeDrawings, visibleThreads} from './review';
import {activeCommentIds, annotationScene, coloredReview, commentColorMap} from './playback';
import {ThemeContext, useTheme, useThemeChoice} from './theme';
import type {Anchor, Bootstrap, CaptureFinished, Comment, Draft, Drawing, DrawingTool, PlayerTime, Profile, Project, Settings, ThemeChoice, Video} from './types';

const palette = ['#79BFFD', '#FFFFFF', '#FFD27D', '#9ED8B3'];
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, value => {
  const random = Math.floor(Math.random() * 16);
  return (value === 'x' ? random : (random & 3) | 8).toString(16);
});
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
type CaptureRequest = {token: number; draftId: string; purpose: 'save' | 'preview'; live: boolean};

export default function App() {
  const {width} = useWindowDimensions();
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>('system');
  const theme = useThemeChoice(themeChoice);
  const {colors, styles: s} = theme;
  const [data, setData] = useState<Bootstrap | null>(null);
  const [root, setRoot] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
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
  const [tool, setTool] = useState<DrawingTool>('none');
  const [strokeColor, setStrokeColor] = useState(palette[0]);
  const [preview, setPreview] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [showScene, setShowScene] = useState(true);
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [isolatedReview, setIsolatedReview] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
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
  const threads = useMemo(() => visibleThreads(commentThreads(videoComments), expanded), [videoComments, expanded]);
  const videoDrafts = data?.drafts.filter(item => item.video_id === videoId && item.id !== draftId) ?? [];
  const projectVideos = data?.videos.filter(item => item.project_id === projectId) ?? [];
  const activeScene = draft ?? selected;
  const isLive = !!draft && liveId === draft.id;
  const aggregateScene = useMemo(() => annotationScene(videoComments, duration, theme.dark), [videoComments, duration, theme.dark]);
  const commentColors = useMemo(() => commentColorMap(videoComments, theme.dark), [videoComments, theme.dark]);
  const selectedScene = useMemo(() => selected ? coloredReview(selected, theme.dark, commentColors) : null, [selected, theme.dark, commentColors]);
  const draftStart = draft ? anchorStart(draft.anchor) : 0;
  const draftEnd = draft?.anchor.kind === 'interval' ? (isLive && !preview ? duration : draft.anchor.end_us) : 0;
  const draftKind = draft?.anchor.kind;
  const draftScene = useMemo(() => draft ? (isLive && !preview ? liveScene(draft, duration) :
    {id: draft.id, anchor: draft.anchor, drawings: draft.drawings}) : null,
    [draft?.id, draft?.drawings, draftKind, draftStart, draftEnd, isLive, preview, duration]);
  const sceneJson = useMemo(() => {
    const scene = draft ? (showScene ? draftScene : null) : annotationsVisible ? (isolatedReview ? selectedScene : aggregateScene) : null;
    return scene ? JSON.stringify(scene) : '';
  }, [!!draft, draftScene, showScene, annotationsVisible, isolatedReview, selectedScene, aggregateScene]);
  const activeIds = useMemo(() => activeCommentIds(videoComments, time, duration), [videoComments, time, duration]);
  const activeBranches = useMemo(() => {
    const parents = new Map(videoComments.map(item => [item.comment_id, item.parent_comment_id]));
    const branches = new Map<string, string>();
    for (const id of activeIds) {
      const seen = new Set<string>(); let parent = parents.get(id);
      while (parent && !seen.has(parent)) {
        if (branches.has(parent)) break;
        seen.add(parent); branches.set(parent, id); parent = parents.get(parent);
      }
    }
    return branches;
  }, [videoComments, activeIds]);
  const reviewEnd = !isLive && (reviewing || (!!draft && !preview)) && activeScene?.anchor.kind === 'interval' ? activeScene.anchor.end_us : -1;
  const dialogOpen = profileOpen || projectOpen || discardOpen || commentOpen;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (captureTimer.current) clearTimeout(captureTimer.current); };
  }, []);
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
      if (!mounted.current) return;
      setRoot(directory); setData(state); setThemeChoice(state.settings?.theme ?? 'system');
      draftsRef.current = state.drafts;
      const restored = state.drafts[0];
      const initialVideo = state.videos.find(item => item.id === restored?.video_id) ?? state.videos[0];
      setVideoId(initialVideo?.id ?? null); setProjectId(initialVideo?.project_id ?? state.projects[0]?.id ?? null);
      setDuration(initialVideo?.duration_us ?? 0);
      if (restored && initialVideo?.id === restored.video_id) {
        setDraftId(restored.id); activeDraftRef.current = restored.id; seek(anchorStart(restored.anchor));
      }
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
        setError(`Draft could not be saved: ${message(cause)}. Retry before closing the app.`);
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
    replaceDraft({...current, ...fields}); setPreview(false); setShowScene(true);
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
    setDraftId(null); activeDraftRef.current = null; setLive(null); setPreview(false); setReviewing(false); setTool('none'); setRedo([]); setIsolatedReview(false);
  };
  const openVideo = async (item: Video) => {
    const generation = ++sourceGeneration.current;
    setPaused(true); clearEditing(); setShowScene(true); setVideoId(item.id); setProjectId(item.project_id);
    setCommentId(null); setDuration(item.duration_us); seek(0);
    try {
      const result = await command<{valid: boolean; path: string}>(root, 'verify_video', {video_id: item.id});
      if (generation === sourceGeneration.current && !result.valid)
        setError('This managed video failed its integrity check. Re-add the original video.');
    } catch (cause) { if (generation === sourceGeneration.current) setError(message(cause)); }
  };
  const importVideo = async () => {
    if (!projectId || busy) return;
    setBusy('Adding video…'); setError('');
    try {
      const path = await chooseVideo(); if (!path) return;
      await flushAll();
      const imported = await command<Video>(root, 'import_video', {path, project_id: projectId});
      const refreshed = await command<Bootstrap>(root, 'bootstrap');
      draftsRef.current = refreshed.drafts; setData(refreshed); await openVideo(imported);
    } catch (cause) { setError(`Could not add video: ${message(cause)}`); }
    finally { setBusy(''); }
  };
  const openDraft = (value: Draft) => {
    activeDraftRef.current = value.id; setDraftId(value.id); setCommentId(null); setLive(null);
    setPreview(false); setReviewing(false); setPaused(true); setShowScene(true); setTool('pen'); setRedo([]);
    seek(anchorStart(value.anchor));
  };
  const newDraft = (parent?: Comment) => {
    if (!video || busy) return;
    if (draft && !parent) { setTool('pen'); return; }
    try {
      let value: Draft = {id: uuid(), project_id: video.project_id, video_id: video.id, text: '',
        anchor: parent?.anchor ?? {kind: 'point', at_us: Math.min(time, duration || time)},
        parent_comment_id: parent?.comment_id ?? null, drawings: []};
      const live = !paused && !parent;
      if (live) value = beginLiveDraft(value, duration);
      replaceDraft(value); activeDraftRef.current = value.id; setDraftId(value.id); setCommentId(null);
      setLive(live ? value.id : null); setPreview(false); setReviewing(false); setShowScene(true); setTool('pen'); setRedo([]);
      if (live) furthest.current.set(value.id, time);
      else { setPaused(true); seek(anchorStart(value.anchor)); }
    } catch (cause) { setError(message(cause)); }
  };
  const selectComment = (item: Comment) => {
    clearEditing(); setIsolatedReview(true); setCommentId(item.comment_id); setPaused(true); setShowScene(true); seek(anchorStart(item.anchor));
    setExpanded(previous => expandedAncestors(data?.comments ?? [], item.comment_id, previous));
  };
  const dismissSelection = () => { clearEditing(); setCommentId(null); setShowScene(true); };
  const startLive = () => {
    const current = draftsRef.current.find(item => item.id === activeDraftRef.current);
    if (!current || busy || preview) return;
    try {
      const next = beginLiveDraft(current, duration, time);
      replaceDraft(next); setLive(next.id); setShowScene(true); setTool(tool === 'none' ? 'pen' : tool); setReviewing(false);
      furthest.current.set(next.id, Math.max(furthest.current.get(next.id) ?? anchorStart(next.anchor), next.anchor.kind === 'interval' ? next.anchor.end_us : 0));
      if (time < anchorStart(next.anchor) || time >= duration) seek(anchorStart(next.anchor));
      setPaused(false);
    } catch (cause) { setError(message(cause)); }
  };
  const play = () => {
    if (!video || busy) return;
    if (!paused) { setPaused(true); return; }
    if (!draft) { setIsolatedReview(false); setReviewing(false); setShowScene(true); }
    if (draft && !preview && draft.anchor.kind === 'point') { startLive(); return; }
    if (!draft || preview) setTool('none');
    if (draft && preview && draft.anchor.kind === 'point') setShowScene(false);
    if (isLive && time >= duration) seek(anchorStart(draft!.anchor));
    else if (!isLive && draft?.anchor.kind === 'interval' && (time < draft.anchor.start_us || time >= draft.anchor.end_us)) seek(draft.anchor.start_us);
    else if (duration && time >= duration) seek(0);
    setPaused(false);
  };
  const playReview = (item: Draft | Comment, asPreview = false) => {
    setTool('none'); setShowScene(true); setIsolatedReview(!asPreview); setPreview(asPreview); seek(anchorStart(item.anchor));
    if (item.anchor.kind === 'point') { setPaused(true); setReviewing(false); }
    else { setReviewing(true); setPaused(false); }
  };
  const onTime = (event: PlayerTime) => {
    if (Number.isFinite(event.time_us)) {
      const now = Math.max(0, Math.round(event.time_us)); setTime(now);
      const current = draftsRef.current.find(item => item.id === liveRef.current);
      if (current && !captureRequest.current && !preview) {
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
    if (!current || current.id === discarding.current || (preview && !captureRequest.current)) return;
    try {
      const drawings = mergeDrawings(current.drawings, [parseDrawing(json)]);
      if (drawings.length === current.drawings.length) return;
      let next = {...current, drawings};
      if (!current.drawings.length) furthest.current.set(current.id, time);
      if (liveRef.current === current.id || captureRequest.current?.live)
        next = finalizeLiveDraft(next, time, duration, furthest.current.get(current.id) ?? time);
      else if (savingDraftId.current === current.id && next.anchor.kind === 'interval')
        next = finalizeLiveDraft(next, next.anchor.end_us, duration, next.anchor.end_us);
      replaceDraft(next); setRedo([]);
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
    if (!draft || preview || busy) return;
    setShowScene(true); setTool(tool === value ? 'none' : value);
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
      selectComment(posted);
      setCommentOpen(false);
    } catch (cause) {
      try {
        const refreshed = await command<Bootstrap>(root, 'bootstrap');
        const posted = refreshed.comments.find(item => item.comment_id === id);
        if (posted) { draftsRef.current = refreshed.drafts; setData(refreshed); selectComment(posted); setCommentOpen(false); return; }
      } catch { /* Keep the local draft when storage cannot be reached. */ }
      setError(`Could not save comment: ${message(cause)}. Retry Save.`);
      setCommentOpen(true);
    } finally { setBusy(''); savingDraftId.current = null; }
  };
  const requestCapture = (purpose: CaptureRequest['purpose']) => {
    if (!draft || busy || captureRequest.current) return;
    const token = ++captureSequence.current;
    captureRequest.current = {token, draftId: draft.id, purpose, live: isLive};
    savingDraftId.current = draft.id;
    setBusy(purpose === 'save' ? 'Saving…' : 'Preparing preview…'); setError('');
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
      if (!Number.isSafeInteger(event.time_us) || event.time_us < 0) throw new Error('The player returned an invalid capture time. Retry Save.');
      let next = {...current, drawings: event.drawingJson ? mergeDrawings(current.drawings, [parseDrawing(event.drawingJson)]) : current.drawings};
      if (request.live) next = finalizeCapturedClip(next, event.time_us, duration,
        current.drawings.length ? furthest.current.get(current.id) ?? event.time_us : event.time_us);
      replaceDraft(next); setTime(event.time_us); setPaused(true); setTool('none'); setLive(null); setReviewing(false);
      captureRequest.current = null;
      await flushLatest(next.id);
      if (request.purpose === 'preview') { setBusy(''); savingDraftId.current = null; playReview(next, true); return; }
      if (next.anchor.kind === 'interval') seek(Math.max(next.anchor.start_us, next.anchor.end_us - 1));
      setBusy(''); savingDraftId.current = null; setCommentOpen(true);
    } catch (cause) {
      captureRequest.current = null; savingDraftId.current = null; setPaused(true); setBusy(''); setError(message(cause));
    }
  };
  const discard = async () => {
    if (!draft || busy) return;
    discarding.current = draft.id;
    setBusy('Discarding…'); setDiscardOpen(false); setPaused(true); setTool('none'); setLive(null);
    try {
      const timer = timers.current.get(draft.id); if (timer) clearTimeout(timer); timers.current.delete(draft.id);
      await saveChain.current.catch(() => undefined);
      await command<null>(root, 'discard_draft', {draft_id: draft.id});
      draftsRef.current = draftsRef.current.filter(item => item.id !== draft.id);
      setData(previous => previous ? {...previous, drafts: draftsRef.current} : previous); dismissSelection();
    } catch (cause) { setError(`Could not discard draft: ${message(cause)}`); }
    finally { discarding.current = null; setBusy(''); }
  };
  const saveComment = () => {
    if (!draft || busy) return;
    if (!draft.text.trim() && !draft.drawings.length) { setError('Add a comment before saving.'); return; }
    if (!data?.profile.name.trim()) {
      pendingPublish.current = draft.id; setCommentOpen(false); setProfileName(''); setProfileOpen(true); return;
    }
    void publishDraft(draft.id);
  };
  const backToDrawing = () => {
    if (busy) return;
    setCommentOpen(false); setPreview(false); setTool('pen'); setError('');
    if (draft?.anchor.kind === 'interval') { setLive(draft.id); furthest.current.set(draft.id, draft.anchor.end_us); }
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
    if (pendingPublish.current) setCommentOpen(true);
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
      setProjectId(created.id); setVideoId(null); dismissSelection(); setProjectOpen(false); setProjectTitle('');
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(''); }
  };

  if (loading) return <ThemeContext.Provider value={theme}><View style={[s.root, s.loading]}><ActivityIndicator color={colors.accentText} /><Text style={s.status}>Opening library…</Text></View></ThemeContext.Provider>;
  if (!data) return <ThemeContext.Provider value={theme}><View style={s.root}><Empty title="Library could not open" action={<Button primary onPress={() => void load()}>Retry</Button>}>{error}</Empty></View></ThemeContext.Provider>;

  return <ThemeContext.Provider value={theme}><View style={s.root}>
    {!!error && <View pointerEvents={dialogOpen ? 'none' : 'auto'} accessibilityElementsHidden={dialogOpen} importantForAccessibility={dialogOpen ? 'no-hide-descendants' : 'auto'} style={s.errorBar} accessibilityRole="alert"><Text selectable style={s.errorText}>{error}</Text><Button compact onPress={() => setError('')}>Dismiss</Button></View>}
    <View pointerEvents={dialogOpen ? 'none' : 'auto'} accessibilityElementsHidden={dialogOpen} importantForAccessibility={dialogOpen ? 'no-hide-descendants' : 'auto'} style={s.workspace}>
      <View style={[s.sidebar, width < 1100 && {width: 180}]}>
        <View style={s.sidebarTop}><Text style={s.brand}>GamePack</Text></View>
        <ScrollView style={s.sidebarScroll}>
          <View style={s.sideSection}>
            <View style={s.sectionRow}><Text style={s.sectionTitle}>Projects</Text><Button compact label="Create project" disabled={!!busy} onPress={() => { setError(''); setProjectOpen(true); }}>+</Button></View>
            {data.projects.map(project => <Pressable key={project.id} disabled={!!busy} accessibilityRole="button" accessibilityState={{selected: project.id === projectId, disabled: !!busy}}
              onPress={() => { setProjectId(project.id); const first = data.videos.find(item => item.project_id === project.id); if (first) void openVideo(first); else { setVideoId(null); setPaused(true); dismissSelection(); } }}
              style={({pressed}) => [s.navItem, project.id === projectId && s.navSelected, pressed && s.buttonPressed]}>
              <Text style={s.navIcon}>▤</Text><Text numberOfLines={1} style={s.navText}>{project.title}</Text>
            </Pressable>)}
          </View>
          <View style={s.sideSection}>
            <View style={s.sectionRow}><Text style={s.sectionTitle}>Videos</Text></View>
            {projectVideos.map(item => <Pressable key={item.id} disabled={!!busy} accessibilityRole="button" accessibilityState={{selected: item.id === videoId, disabled: !!busy}} onPress={() => void openVideo(item)}
              style={({pressed}) => [s.navItem, item.id === videoId && s.navSelected, pressed && s.buttonPressed]}>
              <Text style={s.navIcon}>▷</Text><Text numberOfLines={2} style={s.navText}>{item.title}</Text>
            </Pressable>)}
          </View>
        </ScrollView>
        <View style={s.sidebarBottom}>
          <Button primary disabled={!!busy || !projectId} onPress={() => void importVideo()}>{busy === 'Adding video…' ? busy : '+ Add video'}</Button>
          <View style={{flexDirection: 'row', gap: 6}}><Button compact disabled style={{flex: 1}}>Import ZIP</Button><Button compact disabled style={{flex: 1}}>Export ZIP</Button></View>
          <Pressable disabled={!!busy} accessibilityRole="button" accessibilityLabel="Profile and appearance" onPress={() => { pendingPublish.current = null; setProfileName(data.profile.name); setError(''); setProfileOpen(true); }} style={s.profileButton}>
            <View style={s.avatar}><Text style={s.avatarText}>{data.profile.name.trim().slice(0, 1).toUpperCase() || '?'}</Text></View>
            <Text numberOfLines={1} style={s.profileName}>{data.profile.name || 'Profile'}</Text><Text style={s.chevron}>›</Text>
          </Pressable>
        </View>
      </View>
      <View style={s.stage}>
        <View style={s.toolbar}><View style={s.titleBlock}><Text numberOfLines={1} style={s.title}>{video?.title || data.projects.find(item => item.id === projectId)?.title || 'Library'}</Text></View>
          <Button compact disabled={!video || !!busy} onPress={() => setAnnotationsVisible(previous => !previous)}>{annotationsVisible ? 'Hide annotations' : 'Show annotations'}</Button>
          <Button disabled={!video || !!busy} onPress={() => newDraft()} primary>+ Comment</Button></View>
        <View style={[s.playerArea, !video && {backgroundColor: colors.inset}]}>
          {video ? <GamePackPlayer key={video.id} style={s.nativePlayer} source={video.path} paused={paused} rate={rate}
            seekUs={seekState.us} seekToken={seekState.token} reviewEndUs={reviewEnd} sceneJson={sceneJson}
            captureToken={captureToken} onCaptureFinished={event => void onCaptureFinished(event.nativeEvent)}
            tool={draft && !preview && (!busy || !!captureRequest.current) ? tool : 'none'} strokeColor={strokeColor}
            onTime={event => onTime(event.nativeEvent)} onDrawing={event => onDrawing(event.nativeEvent.drawingJson)} /> :
            <Empty action={<Button primary disabled={!!busy} onPress={() => void importVideo()}>Add video</Button>} />}
        </View>
        <View pointerEvents={busy ? 'none' : 'auto'} style={s.transport}>
          <Timeline time={time} duration={duration} comments={videoComments} selectedId={commentId} onSeek={value => seek(value)} />
          <View style={s.transportRow}>
            <Button compact disabled={!video || !!busy} label="Back five seconds" onPress={() => seek(Math.max(0, time - 5000000))}>−5s</Button>
            <Button disabled={!video || !!busy} style={s.playButton} label={paused ? 'Play video' : 'Pause video'} onPress={play}>{paused ? '▶' : 'Ⅱ'}</Button>
            <Button compact disabled={!video || !!busy} label="Forward five seconds" onPress={() => seek(Math.min(duration, time + 5000000))}>+5s</Button>
            <Text style={s.time}>{timeLabel(time)} <Text style={{color: colors.faint}}>/ {timeLabel(duration)}</Text></Text>
            <View style={s.transportSpacer} /><Button compact disabled={!video || !!busy} label="Playback speed" onPress={() => setRate(previous => previous === 0.5 ? 1 : previous === 1 ? 1.5 : previous === 1.5 ? 2 : 0.5)}>{rate}×</Button>
          </View>
        </View>
        {draft && !preview && <View style={s.toolBar}>
          <Button compact active={tool === 'pen'} disabled={!!busy} onPress={() => chooseTool('pen')}>Pen</Button>
          <Button compact active={tool === 'arrow'} disabled={!!busy} onPress={() => chooseTool('arrow')}>Arrow</Button>
          <Button compact active={tool === 'ellipse'} disabled={!!busy} onPress={() => chooseTool('ellipse')}>Ellipse</Button>
          <View style={s.toolDivider} />
          {palette.map(color => <Pressable key={color} disabled={!!busy} accessibilityRole="button" accessibilityLabel={`Drawing color ${color}`} accessibilityState={{selected: strokeColor === color}}
            onPress={() => setStrokeColor(color)} style={[s.swatch, strokeColor === color && s.swatchSelected]}><View style={[s.swatchFill, {backgroundColor: color}]} /></Pressable>)}
          <View style={s.transportSpacer} /><Button compact disabled={!draft.drawings.length || !!busy} onPress={undoDrawing}>Undo</Button><Button compact disabled={!redo.length || !!busy} onPress={redoDrawing}>Redo</Button>
        </View>}
        {(!!busy || selected || preview) && <View style={s.statusRow}>{!!busy && <Text style={s.status}>{busy}</Text>}
          {(selected || preview) && <Button compact disabled={!!busy} onPress={preview ? () => { setPreview(false); setReviewing(false); setPaused(true); if (draft) { seek(anchorStart(draft.anchor)); if (draft.anchor.kind === 'interval') setLive(draft.id); } } : dismissSelection}>{preview ? 'Back to draft' : 'Clear review'}</Button>}</View>}
      </View>
      <View style={[s.rail, width < 1100 && {width: 300}]}>
        <View style={s.railHeader}><Text style={s.railTitle}>Comments</Text></View>
        <ScrollView style={{flex: 1}} contentContainerStyle={s.railContent}>
          {videoDrafts.map(value => <Pressable key={value.id} disabled={!!busy} accessibilityRole="button" onPress={() => openDraft(value)} style={s.draftResume}>
            <Text style={s.commentAuthor}>Draft <Text style={s.commentAnchor}>· {anchorLabel(value.anchor)}</Text></Text>{!!value.text && <Text numberOfLines={2} style={[s.commentText, {marginTop: 5}]}>{value.text}</Text>}
          </Pressable>)}
          {threads.map(({node, depth}) => <View key={node.comment.comment_id} style={depth ? [s.threadRow, {marginLeft: Math.min(depth - 1, 3) * 10}] : undefined}>
            <CommentCard item={node.comment} selected={node.comment.comment_id === commentId} hasReplies={!!node.children.length} expanded={expanded.has(node.comment.comment_id)}
              activeColor={annotationsVisible && activeIds.has(node.comment.comment_id) ? commentColors.get(node.comment.comment_id) : undefined}
              branchColor={annotationsVisible && !expanded.has(node.comment.comment_id) && activeBranches.has(node.comment.comment_id) ? commentColors.get(activeBranches.get(node.comment.comment_id)!) : undefined}
              onToggle={() => setExpanded(previous => { const next = new Set(previous); if (next.has(node.comment.comment_id)) next.delete(node.comment.comment_id); else next.add(node.comment.comment_id); return next; })}
              onSelect={() => selectComment(node.comment)} onPlay={() => { selectComment(node.comment); playReview(node.comment); }} onReply={() => newDraft(node.comment)} disabled={!!busy} />
          </View>)}
          {!videoComments.length && <View style={s.emptyComments}><Text style={s.emptyCommentsText}>No comments</Text></View>}
        </ScrollView>
        {draft && <ScrollView style={{maxHeight: 440, flexGrow: 0}}><View style={s.draft}>
          <View style={s.draftHeader}><Text style={s.draftTitle}>{preview ? 'Preview' : draft.parent_comment_id ? 'Reply' : 'Comment'}</Text><Button compact disabled={!!busy} label="Close draft" onPress={dismissSelection}>×</Button></View>
          <AnchorEditor anchor={draft.anchor} live={isLive} time={time} duration={duration} locked={!!draft.drawings.length} disabled={!!busy || preview} onChange={changeAnchor} onLive={startLive} onError={setError} />
          {!!draft.drawings.length && !preview && !isLive && <VisibilityEditor key={`${draft.id}-${draft.drawings.length}`} draft={draft} disabled={!!busy} onChange={drawings => updateDraft({drawings})} onError={setError} />}
          <View style={s.draftActions}>
            <Button compact disabled={!!busy} onPress={() => { setPaused(true); setDiscardOpen(true); }}>Discard</Button>
            {failedDrafts.has(draft.id) && <Button compact disabled={!!busy} onPress={() => void flushLatest(draft.id).catch(() => undefined)}>Retry</Button>}
            <View style={{flex: 1}} /><Button compact disabled={!!busy} onPress={() => requestCapture('preview')}>{preview ? 'Replay' : 'Preview'}</Button>
            <Button primary disabled={!!busy} onPress={() => requestCapture('save')}>{busy === 'Saving…' ? 'Saving…' : 'Save'}</Button>
          </View>
        </View></ScrollView>}
      </View>
    </View>
    <Dialog visible={commentOpen && !!draft} onDismiss={backToDrawing}>
      <Text style={s.modalTitle}>{draft?.parent_comment_id ? 'Reply' : 'Comment'}</Text>
      <TextInput autoFocus accessibilityLabel="Comment" placeholder="Comment…" placeholderTextColor={colors.faint} multiline editable={!busy} style={[s.input, s.textArea]}
        value={draft?.text ?? ''} onChangeText={text => updateDraft({text})} maxLength={16000} />
      {!!error && <Text accessibilityRole="alert" style={[s.hint, {color: colors.danger}]}>{error}</Text>}
      <View style={s.modalActions}><Button disabled={!!busy} onPress={backToDrawing}>Back to drawing</Button><Button primary disabled={!!busy || (!draft?.text.trim() && !draft?.drawings.length)} onPress={saveComment}>{busy ? 'Saving…' : 'Save'}</Button></View>
    </Dialog>
    <Dialog visible={profileOpen} onDismiss={closeProfile}>
      <Text style={s.modalTitle}>Profile</Text>
      <Text style={s.fieldLabel}>Name</Text><TextInput autoFocus accessibilityLabel="Display name" placeholder="Your name" placeholderTextColor={colors.faint} style={s.input} value={profileName} onChangeText={setProfileName} maxLength={100} onSubmitEditing={() => void saveProfile()} />
      <Text style={s.themeLabel}>Appearance</Text><View style={s.themeOptions}>{(['system', 'light', 'dark'] as const).map(choice => <Button key={choice} active={themeChoice === choice} disabled={!!busy} style={{flex: 1}} onPress={() => void changeTheme(choice)}>{choice[0].toUpperCase() + choice.slice(1)}</Button>)}</View>
      {!!error && <Text accessibilityRole="alert" style={[s.hint, {color: colors.danger}]}>{error}</Text>}
      <View style={s.modalActions}><Button disabled={!!busy} onPress={closeProfile}>Cancel</Button><Button primary disabled={!profileName.trim() || !!busy} onPress={() => void saveProfile()}>Save</Button></View>
    </Dialog>
    <Dialog visible={projectOpen} onDismiss={() => { if (!busy) setProjectOpen(false); }}>
      <Text style={s.modalTitle}>New project</Text><TextInput autoFocus accessibilityLabel="Project name" placeholder="Project name" placeholderTextColor={colors.faint} style={s.input} value={projectTitle} onChangeText={setProjectTitle} maxLength={100} onSubmitEditing={() => void createProject()} />
      {!!error && <Text accessibilityRole="alert" style={[s.hint, {color: colors.danger}]}>{error}</Text>}
      <View style={s.modalActions}><Button disabled={!!busy} onPress={() => setProjectOpen(false)}>Cancel</Button><Button primary disabled={!projectTitle.trim() || !!busy} onPress={() => void createProject()}>Create</Button></View>
    </Dialog>
    <Dialog visible={discardOpen} onDismiss={() => { if (!busy) setDiscardOpen(false); }}>
      <Text style={s.modalTitle}>Discard draft?</Text><View style={s.modalActions}><Button onPress={() => setDiscardOpen(false)}>Keep</Button><Button primary onPress={() => void discard()}>Discard</Button></View>
    </Dialog>
  </View></ThemeContext.Provider>;
}

function CommentCard({item, selected, onSelect, onPlay, onReply, disabled, hasReplies, expanded, onToggle, activeColor, branchColor}: {
  item: Comment; selected: boolean; onSelect: () => void; onPlay: () => void; onReply: () => void; disabled: boolean;
  hasReplies: boolean; expanded: boolean; onToggle: () => void;
  activeColor?: string; branchColor?: string;
}) {
  const {styles: s} = useTheme();
  const date = new Date(item.created_at_reported / 1000);
  return <View style={[s.commentCard, selected && s.commentSelected, !!activeColor && {borderColor: activeColor, borderLeftWidth: 3}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Comment by ${item.name_at_posting} at ${anchorLabel(item.anchor)}`} onPress={onSelect} disabled={disabled}>
      <View style={s.commentHeader}><View style={[s.avatar, {width: 23, height: 23}]}><Text style={[s.avatarText, {fontSize: 10}]}>{item.name_at_posting.slice(0, 1).toUpperCase()}</Text></View>
        <Text style={s.commentAuthor}>{item.name_at_posting}</Text><Text style={s.commentDate}>{Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</Text></View>
      {!!item.text && <Text style={s.commentText}>{item.text}</Text>}
      <View style={s.commentMeta}><Text style={s.commentAnchor}>{anchorLabel(item.anchor)}</Text></View>
    </Pressable>
    <View style={s.commentActions}><Button compact disabled={disabled} onPress={onPlay}>{item.anchor.kind === 'interval' ? '▶ Play' : 'View'}</Button><Button compact disabled={disabled} onPress={onReply}>Reply</Button></View>
    {hasReplies && <Pressable accessibilityRole="button" accessibilityState={{expanded}} disabled={disabled} onPress={onToggle} style={s.replyToggle}><Text style={[s.replyToggleText, !!branchColor && {color: branchColor}]}>{expanded ? '▾ Hide replies' : '▸ Replies'}{branchColor ? ' ●' : ''}</Text></Pressable>}
  </View>;
}

function AnchorEditor({anchor, live, time, duration, locked, disabled, onChange, onLive, onError}: {
  anchor: Anchor; live: boolean; time: number; duration: number; locked: boolean; disabled: boolean;
  onChange: (anchor: Anchor) => void; onLive: () => void; onError: (error: string) => void;
}) {
  const {styles: s} = useTheme();
  return <View>
    <View style={s.segment}><Button compact style={s.segmentButton} active={!live && anchor.kind === 'point'} disabled={disabled || locked} onPress={() => onChange({kind: 'point', at_us: anchorStart(anchor)})}>Moment</Button>
      <Button compact style={s.segmentButton} active={live} disabled={disabled || duration <= 0} onPress={onLive}>Clip</Button>
      <Button compact style={s.segmentButton} active={!live && anchor.kind === 'interval'} disabled={disabled || locked || duration <= 0} onPress={() => { const start = Math.min(anchorStart(anchor), Math.max(0, duration - 1000000)); onChange({kind: 'interval', start_us: start, end_us: Math.min(duration, start + 30000000)}); }}>Range</Button></View>
    {live ? <View style={s.anchorRow}><Text style={[s.commentAnchor, {paddingVertical: 7}]}>{anchorLabel(anchor)}</Text></View> : anchor.kind === 'point' ?
      <View style={s.anchorRow}><TimeField label="At" value={anchor.at_us} disabled={locked || disabled} onChange={value => onChange({kind: 'point', at_us: value})} onError={onError} />
        <Button compact disabled={locked || disabled} onPress={() => onChange({kind: 'point', at_us: time})}>Use playhead</Button></View> :
      <View><View style={s.anchorRow}><TimeField label="Start" value={anchor.start_us} disabled={locked || disabled} onChange={value => onChange({...anchor, start_us: value})} onError={onError} />
        <TimeField label="End" value={anchor.end_us} disabled={locked || disabled} onChange={value => onChange({...anchor, end_us: value})} onError={onError} /></View>
        <View style={s.anchorRow}><Button compact style={{flex: 1}} disabled={locked || disabled} onPress={() => onChange({...anchor, start_us: time})}>Start here</Button>
          <Button compact style={{flex: 1}} disabled={locked || disabled} onPress={() => onChange({...anchor, end_us: time})}>End here</Button></View></View>}
  </View>;
}
function TimeField({label, value, disabled, onChange, onError}: {
  label: string; value: number; disabled: boolean; onChange: (value: number) => void; onError: (error: string) => void;
}) {
  const {colors, styles: s} = useTheme();
  const [text, setText] = useState(timeLabel(value, true));
  useEffect(() => setText(timeLabel(value, true)), [value]);
  const commit = () => { const parsed = parseTime(text); if (parsed === null) onError('Enter a time such as 01:30 or 01:30.250.'); else if (parsed !== value) onChange(parsed); setText(timeLabel(value, true)); };
  return <View style={s.anchorField}><Text style={s.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} style={[s.input, s.anchorInput, disabled && {color: colors.muted}]} editable={!disabled}
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
