import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions} from 'react-native';
import {anchorLabel, anchorStart, Button, bytesLabel, Dialog, Empty, parseTime, Timeline, timeLabel} from './components';
import {chooseVideo, command, dataDirectory, GamePackPlayer} from './native';
import {colors, styles as s} from './styles';
import type {Anchor, Bootstrap, Comment, Draft, Drawing, DrawingTool, PlayerTime, Profile, Project, Video} from './types';

type SaveState = 'Saving…' | 'Saved' | 'Not saved';
const palette = ['#F09A77', '#FFFFFF', '#79C6F2', '#B7DB8F'];
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, value => {
  const random = Math.floor(Math.random() * 16);
  return (value === 'x' ? random : (random & 3) | 8).toString(16);
});
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function App() {
  const {width} = useWindowDimensions();
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
  const [tool, setTool] = useState<DrawingTool>('none');
  const [strokeColor, setStrokeColor] = useState(palette[0]);
  const [preview, setPreview] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [showScene, setShowScene] = useState(true);
  const [status, setStatus] = useState('');
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [redo, setRedo] = useState<Drawing[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const draftsRef = useRef<Draft[]>([]);
  const activeDraftRef = useRef<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const metadataSent = useRef(new Set<string>());
  const sourceGeneration = useRef(0);

  const video = data?.videos.find(item => item.id === videoId) ?? null;
  const draft = data?.drafts.find(item => item.id === draftId) ?? null;
  const selected = data?.comments.find(item => item.comment_id === commentId) ?? null;
  const videoComments = data?.comments.filter(item => item.video_id === videoId) ?? [];
  const videoDrafts = data?.drafts.filter(item => item.video_id === videoId && item.id !== draftId) ?? [];
  const projectVideos = data?.videos.filter(item => item.project_id === projectId) ?? [];
  const activeScene = draft ?? selected;
  const sceneJson = activeScene && showScene ? JSON.stringify({anchor: activeScene.anchor, drawings: activeScene.drawings}) : '';
  const reviewEnd = (reviewing || (!!draft && !preview)) && activeScene?.anchor.kind === 'interval' ? activeScene.anchor.end_us : -1;
  const canPost = !!draft && (!!draft.text.trim() || draft.drawings.length > 0);
  const dialogOpen = profileOpen || projectOpen || discardOpen;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const seek = useCallback((us: number) => {
    const target = Math.max(0, Math.round(us));
    setSeekState(previous => ({us: target, token: previous.token + 1}));
    setTime(target);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const directory = await dataDirectory();
      const state = await command<Bootstrap>(directory, 'bootstrap');
      if (!mounted.current) return;
      setRoot(directory);
      setData(state);
      draftsRef.current = state.drafts;
      const restored = state.drafts[0];
      const initialVideo = state.videos.find(item => item.id === restored?.video_id) ?? state.videos[0];
      setVideoId(initialVideo?.id ?? null);
      setProjectId(initialVideo?.project_id ?? state.projects[0]?.id ?? null);
      setDuration(initialVideo?.duration_us ?? 0);
      if (restored && initialVideo?.id === restored.video_id) {
        setDraftId(restored.id);
        activeDraftRef.current = restored.id;
        setSaveStates({[restored.id]: 'Saved'});
        seek(anchorStart(restored.anchor));
        setStatus('Your saved draft is ready to continue.');
      }
    } catch (cause) { setError(message(cause)); }
    finally { setLoading(false); }
  }, [seek]);
  useEffect(() => { void load(); }, [load]);

  const persist = useCallback((value: Draft): Promise<Draft> => {
    setSaveStates(previous => ({...previous, [value.id]: 'Saving…'}));
    const pending = saveChain.current.catch(() => undefined).then(() => command<Draft>(root, 'save_draft', {draft: value}));
    saveChain.current = pending;
    return pending.then(saved => {
      if (mounted.current && draftsRef.current.find(item => item.id === value.id) === value)
        setSaveStates(previous => ({...previous, [value.id]: 'Saved'}));
      return saved;
    }).catch(cause => {
      if (mounted.current) {
        setSaveStates(previous => ({...previous, [value.id]: 'Not saved'}));
        setError(`Draft could not be saved: ${message(cause)}. Use Save again before closing the app.`);
      }
      throw cause;
    });
  }, [root]);

  const scheduleSave = (value: Draft) => {
    const previous = timers.current.get(value.id);
    if (previous) clearTimeout(previous);
    setSaveStates(states => ({...states, [value.id]: 'Saving…'}));
    timers.current.set(value.id, setTimeout(() => {
      timers.current.delete(value.id);
      void persist(value).catch(() => undefined);
    }, 300));
  };

  const replaceDraft = (value: Draft) => {
    draftsRef.current = [...draftsRef.current.filter(item => item.id !== value.id), value];
    setData(previous => previous ? {...previous, drafts: draftsRef.current} : previous);
    scheduleSave(value);
  };
  const updateDraft = (fields: Partial<Draft>) => {
    const current = draftsRef.current.find(item => item.id === activeDraftRef.current);
    if (!current || busy) return;
    replaceDraft({...current, ...fields});
    setPreview(false);
    setShowScene(true);
  };
  const flushDraft = async (value: Draft) => {
    const timer = timers.current.get(value.id);
    if (timer) clearTimeout(timer);
    timers.current.delete(value.id);
    return persist(value);
  };
  const flushAll = async () => {
    const pendingIds = [...timers.current.keys()];
    for (const id of pendingIds) {
      const value = draftsRef.current.find(item => item.id === id);
      if (value) await flushDraft(value);
    }
    await saveChain.current;
  };

  const openVideo = async (item: Video) => {
    const generation = ++sourceGeneration.current;
    setPaused(true); setReviewing(false); setPreview(false); setTool('none'); setShowScene(true);
    setVideoId(item.id); setProjectId(item.project_id); setCommentId(null); setDraftId(null);
    activeDraftRef.current = null; setRedo([]); setDuration(item.duration_us); seek(0); setStatus('');
    try {
      const result = await command<{valid: boolean; path: string}>(root, 'verify_video', {video_id: item.id});
      if (generation !== sourceGeneration.current) return;
      if (!result.valid) setError('This managed video failed its integrity check. Re-add the original video before reviewing it.');
    } catch (cause) { if (generation === sourceGeneration.current) setError(message(cause)); }
  };

  const importVideo = async () => {
    if (!projectId || busy) return;
    setBusy('Adding video…'); setError('');
    try {
      const path = await chooseVideo();
      if (!path) return;
      await flushAll();
      const imported = await command<Video>(root, 'import_video', {path, project_id: projectId});
      const refreshed = await command<Bootstrap>(root, 'bootstrap');
      draftsRef.current = refreshed.drafts; setData(refreshed);
      await openVideo(imported);
      setStatus('Video added to your managed library.');
    } catch (cause) { setError(`Could not add video: ${message(cause)}`); }
    finally { setBusy(''); }
  };

  const openDraft = (value: Draft) => {
    activeDraftRef.current = value.id; setDraftId(value.id); setCommentId(null);
    setPreview(false); setReviewing(false); setPaused(true); setShowScene(true); setTool('none'); setRedo([]);
    seek(anchorStart(value.anchor)); setStatus('');
  };
  const newDraft = (parent?: Comment) => {
    if (!video || busy) return;
    if (draft && !parent) { openDraft(draft); return; }
    const value: Draft = {id: uuid(), project_id: video.project_id, video_id: video.id, text: '',
      anchor: parent?.anchor ?? {kind: 'point', at_us: Math.min(time, duration || time)},
      parent_comment_id: parent?.comment_id ?? null, drawings: []};
    replaceDraft(value); openDraft(value);
  };
  const selectComment = (item: Comment) => {
    setCommentId(item.comment_id); setDraftId(null); activeDraftRef.current = null;
    setPaused(true); setPreview(false); setReviewing(false); setShowScene(true); setTool('none'); setRedo([]);
    seek(anchorStart(item.anchor)); setStatus('');
  };
  const dismissSelection = () => {
    setCommentId(null); setDraftId(null); activeDraftRef.current = null;
    setPreview(false); setReviewing(false); setTool('none'); setShowScene(false); setStatus('');
  };
  const play = () => {
    if (!video) return;
    if (!draft || preview || draft.anchor.kind === 'point') setTool('none');
    if (!paused) { setPaused(true); return; }
    if (activeScene?.anchor.kind === 'point') setShowScene(false);
    if (draft?.anchor.kind === 'interval' && (time < draft.anchor.start_us || time >= draft.anchor.end_us)) seek(draft.anchor.start_us);
    else if (duration && time >= duration) seek(0);
    setStatus(''); setPaused(false);
  };
  const playReview = (item: Draft | Comment, asPreview = false) => {
    setTool('none'); setShowScene(true); setPreview(asPreview); setStatus('');
    seek(anchorStart(item.anchor));
    if (item.anchor.kind === 'point') {
      setPaused(true); setReviewing(false);
      setStatus(asPreview ? 'Preview · moment drawings appear together on this frame.' : 'Moment review · press Play to continue the video.');
    } else { setReviewing(true); setPaused(false); }
  };

  const onTime = (event: PlayerTime) => {
    if (Number.isFinite(event.time_us)) setTime(Math.max(0, Math.round(event.time_us)));
    if (event.duration_us > 0) setDuration(Math.round(event.duration_us));
    if (event.error) { setError(`Playback failed: ${event.error}`); setPaused(true); }
    // Native completion is authoritative. Ordinary callbacks may still describe
    // the old playhead while a newly requested seek is reaching its target.
    if (event.ended) {
      setPaused(true); setReviewing(false);
      if (reviewing) setStatus('Review complete');
    }
    if (video && event.duration_us > 0 && event.width > 0 && !metadataSent.current.has(video.id)) {
      metadataSent.current.add(video.id);
      void command<Video>(root, 'update_video_metadata', {video_id: video.id,
        duration_us: Math.round(event.duration_us), width: Math.round(event.width), height: Math.round(event.height)})
        .then(updated => setData(previous => previous ? {...previous, videos: previous.videos.map(item => item.id === updated.id ? updated : item)} : previous))
        .catch(cause => { metadataSent.current.delete(video.id); setError(`Video details could not be saved: ${message(cause)}`); });
    }
  };
  const onDrawing = (json: string) => {
    const current = draftsRef.current.find(item => item.id === activeDraftRef.current);
    if (!current || preview || busy) return;
    try {
      const drawing = JSON.parse(json) as Drawing;
      if (!drawing.id || !Array.isArray(drawing.samples) || !drawing.samples.length) throw new Error('The native drawing was incomplete. Try the stroke again.');
      replaceDraft({...current, drawings: [...current.drawings, drawing]}); setRedo([]);
    } catch (cause) { setError(message(cause)); }
  };
  const changeAnchor = (anchor: Anchor) => {
    if (!draft) return;
    if (draft.drawings.length) { setError('Undo the draft drawings before changing its time range. This keeps every mark on the frame where it was drawn.'); return; }
    if (anchor.kind === 'point' ? anchor.at_us > duration : anchor.end_us > duration || anchor.end_us <= anchor.start_us) {
      setError('Choose a time within the video and an end after the start.'); return;
    }
    updateDraft({anchor}); setPaused(true); setReviewing(false); setTool('none'); seek(anchorStart(anchor));
  };
  const chooseTool = (value: DrawingTool) => {
    if (!draft || preview) return;
    setShowScene(true); setTool(tool === value ? 'none' : value);
    if (draft.anchor.kind === 'point') { setPaused(true); seek(draft.anchor.at_us); }
    else if (time < draft.anchor.start_us || time >= draft.anchor.end_us) { setPaused(true); seek(draft.anchor.start_us); }
  };
  const undoDrawing = () => {
    if (!draft?.drawings.length) return;
    const removed = draft.drawings[draft.drawings.length - 1];
    setRedo(previous => [...previous, removed]); updateDraft({drawings: draft.drawings.slice(0, -1)});
  };
  const redoDrawing = () => {
    if (!draft || !redo.length) return;
    updateDraft({drawings: [...draft.drawings, redo[redo.length - 1]]}); setRedo(previous => previous.slice(0, -1));
  };
  const post = async () => {
    if (!draft || !canPost || busy) return;
    if (!data?.profile.name.trim()) { setProfileName(''); setError(''); setProfileOpen(true); return; }
    setBusy('Posting…'); setPaused(true); setTool('none'); setError('');
    try {
      await flushDraft(draft);
      const posted = await command<Comment>(root, 'post_draft', {draft_id: draft.id});
      draftsRef.current = draftsRef.current.filter(item => item.id !== draft.id);
      setData(previous => previous ? {...previous, drafts: draftsRef.current,
        comments: [...previous.comments.filter(item => item.comment_id !== posted.comment_id), posted]} : previous);
      selectComment(posted); setStatus('Comment posted.');
    } catch (cause) {
      // A durable post can succeed even if its acknowledgment is interrupted.
      // Reconcile its stable ID before offering a retry.
      try {
        const refreshed = await command<Bootstrap>(root, 'bootstrap');
        const posted = refreshed.comments.find(item => item.comment_id === draft.id);
        if (posted) {
          draftsRef.current = refreshed.drafts; setData(refreshed); selectComment(posted); setStatus('Comment posted.'); return;
        }
      } catch { /* Keep the local draft when storage cannot be reached. */ }
      setError(`Comment was not acknowledged: ${message(cause)}. Your draft remains available. Retry Post comment to reconcile it safely.`);
    }
    finally { setBusy(''); }
  };
  const discard = async () => {
    if (!draft || busy) return;
    setBusy('Discarding…'); setDiscardOpen(false);
    try {
      const timer = timers.current.get(draft.id); if (timer) clearTimeout(timer); timers.current.delete(draft.id);
      await saveChain.current.catch(() => undefined);
      await command<null>(root, 'discard_draft', {draft_id: draft.id});
      draftsRef.current = draftsRef.current.filter(item => item.id !== draft.id);
      setData(previous => previous ? {...previous, drafts: draftsRef.current} : previous); dismissSelection();
    } catch (cause) { setError(`Could not discard draft: ${message(cause)}`); }
    finally { setBusy(''); }
  };
  const saveProfile = async () => {
    if (!profileName.trim() || busy) return;
    setBusy('Saving name…');
    try {
      const profile = await command<Profile>(root, 'set_profile', {name: profileName.trim()});
      setData(previous => previous ? {...previous, profile} : previous); setProfileOpen(false);
    } catch (cause) { setError(message(cause)); }
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

  if (loading) return <View style={[s.root, s.loading]}><ActivityIndicator color={colors.accent} /><Text style={s.status}>Opening your library…</Text></View>;
  if (!data) return <View style={s.root}><Empty title="Your library could not open" action={<Button primary onPress={() => void load()}>Try again</Button>}>{error || 'Check the native app installation and storage folder.'}</Empty></View>;

  return <View style={s.root}>
    {!!error && <View pointerEvents={dialogOpen ? 'none' : 'auto'} accessibilityElementsHidden={dialogOpen} importantForAccessibility={dialogOpen ? 'no-hide-descendants' : 'auto'} style={s.errorBar} accessibilityRole="alert"><Text selectable style={s.errorText}>{error}</Text><Button compact onPress={() => setError('')}>Dismiss</Button></View>}
    <View pointerEvents={dialogOpen ? 'none' : 'auto'} accessibilityElementsHidden={dialogOpen} importantForAccessibility={dialogOpen ? 'no-hide-descendants' : 'auto'} style={s.workspace}>
      <View style={[s.sidebar, width < 1100 && {width: 180}]}>
        <View style={s.sidebarTop}><Text style={s.brand}>GamePack</Text></View>
        <ScrollView style={s.sidebarScroll}>
          <View style={s.sideSection}>
            <View style={s.sectionRow}><Text style={s.sectionTitle}>Projects</Text><Button compact label="Create project" disabled={!!busy} onPress={() => { setError(''); setProjectOpen(true); }}>+</Button></View>
            {data.projects.map(project => <Pressable key={project.id} accessibilityRole="button" accessibilityState={{selected: project.id === projectId}}
              onPress={() => { setProjectId(project.id); const first = data.videos.find(item => item.project_id === project.id); if (first) void openVideo(first); else { setVideoId(null); dismissSelection(); } }}
              style={({pressed}) => [s.navItem, project.id === projectId && s.navSelected, pressed && s.buttonPressed]}>
              <Text style={s.navIcon}>▤</Text><Text numberOfLines={1} style={s.navText}>{project.title}</Text><Text style={s.navCount}>{data.videos.filter(item => item.project_id === project.id).length}</Text>
            </Pressable>)}
          </View>
          <View style={s.sideSection}>
            <View style={s.sectionRow}><Text style={s.sectionTitle}>Videos</Text></View>
            {projectVideos.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{selected: item.id === videoId}} onPress={() => void openVideo(item)}
              style={({pressed}) => [s.navItem, item.id === videoId && s.navSelected, pressed && s.buttonPressed]}>
              <Text style={s.navIcon}>▷</Text><View style={{flex: 1}}><Text numberOfLines={2} style={[s.navText, {flex: 0}]}>{item.title}</Text><Text style={s.caption}>{item.duration_us ? timeLabel(item.duration_us) : bytesLabel(item.byte_size)}{data.drafts.some(value => value.video_id === item.id) ? ' · Draft' : ''}</Text></View>
            </Pressable>)}
            {!projectVideos.length && <Text style={[s.storageText, {padding: 8}]}>Add a video to start reviewing.</Text>}
          </View>
        </ScrollView>
        <View style={s.sidebarBottom}>
          <Button primary disabled={!!busy || !projectId} onPress={() => void importVideo()}>{busy === 'Adding video…' ? busy : '+ Add video'}</Button>
          <View style={{flexDirection: 'row', gap: 6}}><Button compact disabled style={{flex: 1}}>Import ZIP</Button><Button compact disabled style={{flex: 1}}>Export ZIP</Button></View>
          <Text style={s.storageText}>ZIP sharing is coming in a later release.</Text>
          <Text style={s.storageText}>{bytesLabel(data.storage.managed_bytes)} media · {bytesLabel(data.storage.database_bytes)} database</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit display name" onPress={() => { setProfileName(data.profile.name); setError(''); setProfileOpen(true); }} style={s.profileButton}>
            <View style={s.avatar}><Text style={s.avatarText}>{data.profile.name.trim().slice(0, 1).toUpperCase() || '?'}</Text></View>
            <Text numberOfLines={1} style={s.profileName}>{data.profile.name || 'Set your name'}</Text><Text style={s.mutedText}>›</Text>
          </Pressable>
        </View>
      </View>

      <View style={s.stage}>
        <View style={s.toolbar}><View style={s.titleBlock}><Text numberOfLines={1} style={s.title}>{video?.title || data.projects.find(item => item.id === projectId)?.title || 'Review library'}</Text>
          {video && <Text style={s.caption}>{video.width ? `${video.width} × ${video.height} · ` : ''}{bytesLabel(video.byte_size)}</Text>}</View>
          <Button disabled={!video || !!busy} onPress={() => newDraft()} primary>+ Comment</Button></View>
        <View style={s.playerArea}>
          {video ? <GamePackPlayer key={video.id} style={s.nativePlayer} source={video.path} paused={paused} rate={rate}
            seekUs={seekState.us} seekToken={seekState.token} reviewEndUs={reviewEnd} sceneJson={sceneJson}
            tool={draft && !preview && !busy ? tool : 'none'} strokeColor={strokeColor}
            onTime={event => onTime(event.nativeEvent)} onDrawing={event => onDrawing(event.nativeEvent.drawingJson)} /> :
            <Empty title="A closer look starts here" action={<Button primary disabled={!!busy} onPress={() => void importVideo()}>Add a video</Button>}>Bring in a video, leave precise feedback, and draw directly on the moments that matter.</Empty>}
        </View>
        <View style={s.transport}>
          <Timeline time={time} duration={duration} comments={videoComments} selectedId={commentId} onSeek={value => { setTool('none'); seek(value); }} />
          <View style={s.transportRow}>
            <Button compact disabled={!video} label="Back five seconds" onPress={() => { setTool('none'); seek(Math.max(0, time - 5000000)); }}>−5s</Button>
            <Button disabled={!video} style={s.playButton} label={paused ? 'Play video' : 'Pause video'} onPress={play}>{paused ? '▶' : 'Ⅱ'}</Button>
            <Button compact disabled={!video} label="Forward five seconds" onPress={() => { setTool('none'); seek(Math.min(duration, time + 5000000)); }}>+5s</Button>
            <Text style={s.time}>{timeLabel(time)} <Text style={{color: colors.faint}}>/ {timeLabel(duration)}</Text></Text>
            <View style={s.transportSpacer} /><Button compact disabled={!video} label="Change playback speed" onPress={() => setRate(previous => previous === 0.5 ? 1 : previous === 1 ? 1.5 : previous === 1.5 ? 2 : 0.5)}>{rate}×</Button>
          </View>
        </View>
        {draft && !preview && <View style={s.toolBar}>
          <Button compact active={tool === 'pen'} disabled={!!busy} onPress={() => chooseTool('pen')}>Pen</Button>
          <Button compact active={tool === 'arrow'} disabled={!!busy} onPress={() => chooseTool('arrow')}>Arrow</Button>
          <Button compact active={tool === 'ellipse'} disabled={!!busy} onPress={() => chooseTool('ellipse')}>Ellipse</Button>
          <View style={s.toolDivider} />
          {palette.map(color => <Pressable key={color} accessibilityRole="button" accessibilityLabel={`Drawing color ${color}`} accessibilityState={{selected: strokeColor === color}}
            onPress={() => setStrokeColor(color)} style={[s.swatch, strokeColor === color && s.swatchSelected]}><View style={[s.swatchFill, {backgroundColor: color}]} /></Pressable>)}
          <View style={s.transportSpacer} /><Button compact disabled={!draft.drawings.length || !!busy} onPress={undoDrawing}>Undo</Button><Button compact disabled={!redo.length || !!busy} onPress={redoDrawing}>Redo</Button>
        </View>}
        <View style={s.statusRow}><Text numberOfLines={2} style={s.status}>{busy || status || (draft && tool !== 'none' ? `${tool === 'pen' ? 'Draw' : `Place an ${tool}`} on the video${draft.anchor.kind === 'interval' ? ' while paused or playing.' : '.'}` : selected ? `${anchorLabel(selected.anchor)} · ${selected.drawings.length} ${selected.drawings.length === 1 ? 'drawing' : 'drawings'}` : video ? 'Your original video stays unchanged.' : '')}</Text>
          {(selected || preview) && <Button compact onPress={preview ? () => { setPreview(false); setReviewing(false); setPaused(true); setStatus(''); if (draft) seek(anchorStart(draft.anchor)); } : dismissSelection}>{preview ? 'Back to draft' : 'Clear review'}</Button>}</View>
      </View>

      <View style={[s.rail, width < 1100 && {width: 300}]}>
        <View style={s.railHeader}><View style={{flexDirection: 'row', alignItems: 'center'}}><Text style={s.railTitle}>Comments</Text><Text style={s.countBadge}>{videoComments.length}</Text></View>
          <Text style={s.storageText}>{draft ? 'Draft open' : selected ? 'Review selected' : ''}</Text></View>
        <ScrollView style={{flex: 1}} contentContainerStyle={s.railContent}>
          {videoDrafts.map(value => <Pressable key={value.id} accessibilityRole="button" onPress={() => openDraft(value)} style={s.draftResume}>
            <Text style={s.commentAuthor}>Continue draft <Text style={s.commentAnchor}>· {anchorLabel(value.anchor)}</Text></Text><Text numberOfLines={2} style={[s.hint, {marginTop: 5}]}>{value.text || `${value.drawings.length} drawings · Unposted`}</Text>
          </Pressable>)}
          {videoComments.map(item => <CommentCard key={item.comment_id} item={item} selected={item.comment_id === commentId} parent={data.comments.find(value => value.comment_id === item.parent_comment_id)}
            onSelect={() => selectComment(item)} onPlay={() => { selectComment(item); playReview(item); }} onReply={() => newDraft(item)} disabled={!!busy} />)}
          {!videoComments.length && <View style={s.emptyComments}><Text style={s.emptyCommentsTitle}>{video ? 'Leave the first comment' : 'Every detail, in context'}</Text>
            <Text style={s.emptyCommentsText}>{video ? 'Pause on a moment or choose a time range. Add a note, a drawing, or both.' : 'Comments and drawing reviews will appear beside your video.'}</Text></View>}
        </ScrollView>
        {draft && <ScrollView style={{maxHeight: 495, flexGrow: 0}}><View style={s.draft}>
          <View style={s.draftHeader}><Text style={s.draftTitle}>{preview ? 'Preview' : draft.parent_comment_id ? 'Reply' : 'New comment'}</Text><Text style={s.draftSave}>{saveStates[draft.id] || 'Saved'}</Text></View>
          {!!draft.parent_comment_id && <Text numberOfLines={2} style={s.replyContext}>Replying to {data.comments.find(item => item.comment_id === draft.parent_comment_id)?.name_at_posting || 'a comment'}</Text>}
          <TextInput accessibilityLabel="Comment text" placeholder="What do you notice?" placeholderTextColor={colors.faint} multiline editable={!busy && !preview} style={[s.input, s.textArea]}
            value={draft.text} onChangeText={text => updateDraft({text})} onEndEditing={() => { const latest = draftsRef.current.find(item => item.id === draft.id); if (latest && !busy) void flushDraft(latest).catch(() => undefined); }} maxLength={100000} />
          <AnchorEditor anchor={draft.anchor} time={time} duration={duration} locked={!!draft.drawings.length || !!busy || preview} onChange={changeAnchor} onError={setError} />
          <Text style={s.hint}>{draft.drawings.length ? `${draft.drawings.length} ${draft.drawings.length === 1 ? 'drawing attached. Undo drawings to change the time range.' : 'drawings attached. Undo drawings to change the time range.'}` : 'Use Pen, Arrow, or Ellipse below the player to add drawings.'}</Text>
          {draft.anchor.kind === 'interval' && <Text style={s.hint}>Drawings follow video time. Marks drawn while paused appear together on that frame.</Text>}
          {!!draft.drawings.length && !preview && <VisibilityEditor key={`${draft.id}-${draft.drawings.length}`} draft={draft} disabled={!!busy} onChange={drawings => updateDraft({drawings})} onError={setError} />}
          <View style={s.draftActions}>
            <Button compact disabled={!!busy} onPress={() => setDiscardOpen(true)}>Discard</Button>
            {saveStates[draft.id] === 'Not saved' && <Button compact onPress={() => void flushDraft(draft).catch(() => undefined)}>Save again</Button>}
            <View style={{flex: 1}} />
            <Button compact disabled={!!busy || !canPost} onPress={() => playReview(draft, true)}>{preview ? 'Replay' : 'Preview'}</Button>
            <Button primary disabled={!!busy || !canPost} onPress={() => void post()}>{busy === 'Posting…' ? 'Posting…' : 'Post comment'}</Button>
          </View>
          <Text style={s.draftFooter}>{data.profile.name ? `Commenting as ${data.profile.name}` : 'Set your name before posting.'} · Posted comments are permanent.</Text>
        </View></ScrollView>}
      </View>
    </View>

    <Dialog visible={profileOpen} onDismiss={() => { if (!busy) setProfileOpen(false); }}>
      <Text style={s.modalTitle}>Your display name</Text><Text style={s.modalBody}>What name should appear on your comments? Changing it applies to future posts.</Text>
      <TextInput autoFocus accessibilityLabel="Display name" placeholder="Your name" placeholderTextColor={colors.faint} style={s.input} value={profileName} onChangeText={setProfileName} maxLength={100} onSubmitEditing={() => void saveProfile()} />
      {!!error && <Text accessibilityRole="alert" style={[s.hint, {color: colors.danger}]}>{error}</Text>}
      <View style={s.modalActions}><Button disabled={!!busy} onPress={() => setProfileOpen(false)}>Cancel</Button><Button primary disabled={!profileName.trim() || !!busy} onPress={() => void saveProfile()}>Save name</Button></View>
    </Dialog>
    <Dialog visible={projectOpen} onDismiss={() => { if (!busy) setProjectOpen(false); }}>
      <Text style={s.modalTitle}>New project</Text><Text style={s.modalBody}>Keep related videos and their reviews together.</Text>
      <TextInput autoFocus accessibilityLabel="Project name" placeholder="Project name" placeholderTextColor={colors.faint} style={s.input} value={projectTitle} onChangeText={setProjectTitle} maxLength={200} onSubmitEditing={() => void createProject()} />
      {!!error && <Text accessibilityRole="alert" style={[s.hint, {color: colors.danger}]}>{error}</Text>}
      <View style={s.modalActions}><Button disabled={!!busy} onPress={() => setProjectOpen(false)}>Cancel</Button><Button primary disabled={!projectTitle.trim() || !!busy} onPress={() => void createProject()}>Create project</Button></View>
    </Dialog>
    <Dialog visible={discardOpen} onDismiss={() => { if (!busy) setDiscardOpen(false); }}>
      <Text style={s.modalTitle}>Discard this draft?</Text><Text style={s.modalBody}>Its text and drawings will be removed from this device.</Text><View style={s.modalActions}><Button onPress={() => setDiscardOpen(false)}>Keep draft</Button><Button primary onPress={() => void discard()}>Discard draft</Button></View>
    </Dialog>
  </View>;
}

function CommentCard({item, selected, parent, onSelect, onPlay, onReply, disabled}: {
  item: Comment; selected: boolean; parent?: Comment; onSelect: () => void; onPlay: () => void; onReply: () => void; disabled: boolean;
}) {
  const date = new Date(item.created_at_reported / 1000);
  return <View style={[s.commentCard, selected && s.commentSelected]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Review comment by ${item.name_at_posting} at ${anchorLabel(item.anchor)}`} onPress={onSelect} disabled={disabled}>
      <View style={s.commentHeader}><View style={[s.avatar, {width: 23, height: 23}]}><Text style={[s.avatarText, {fontSize: 10}]}>{item.name_at_posting.slice(0, 1).toUpperCase()}</Text></View>
        <Text style={s.commentAuthor}>{item.name_at_posting}</Text><Text style={s.commentDate}>{Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</Text></View>
      {!!item.parent_comment_id && <Text style={s.replyContext}>↳ Reply to {parent?.name_at_posting || 'another comment'}</Text>}
      {!!item.text && <Text style={s.commentText}>{item.text}</Text>}
      <View style={s.commentMeta}><Text style={s.commentAnchor}>{anchorLabel(item.anchor)}</Text>{!!item.drawings.length && <Text style={s.storageText}>{item.drawings.length} {item.drawings.length === 1 ? 'drawing' : 'drawings'}</Text>}</View>
    </Pressable>
    <View style={s.commentActions}><Button compact disabled={disabled} onPress={onPlay}>{item.anchor.kind === 'interval' ? '▶ Play review' : 'View moment'}</Button><Button compact disabled={disabled} onPress={onReply}>Reply</Button></View>
  </View>;
}

function AnchorEditor({anchor, time, duration, locked, onChange, onError}: {
  anchor: Anchor; time: number; duration: number; locked: boolean; onChange: (anchor: Anchor) => void; onError: (error: string) => void;
}) {
  return <View>
    <View style={s.segment}><Button compact style={s.segmentButton} active={anchor.kind === 'point'} disabled={locked} onPress={() => onChange({kind: 'point', at_us: anchorStart(anchor)})}>Moment</Button>
      <Button compact style={s.segmentButton} active={anchor.kind === 'interval'} disabled={locked || duration <= 0} onPress={() => { const start = Math.min(anchorStart(anchor), Math.max(0, duration - 1000000)); onChange({kind: 'interval', start_us: start, end_us: Math.min(duration, start + 30000000)}); }}>Time range</Button></View>
    {anchor.kind === 'point' ? <View style={s.anchorRow}><TimeField label="At" value={anchor.at_us} disabled={locked} onChange={value => onChange({kind: 'point', at_us: value})} onError={onError} />
      <Button compact disabled={locked} onPress={() => onChange({kind: 'point', at_us: time})}>Use playhead</Button></View> :
      <View style={s.anchorRow}><TimeField label="Start" value={anchor.start_us} disabled={locked} onChange={value => onChange({...anchor, start_us: value})} onError={onError} />
        <TimeField label="End" value={anchor.end_us} disabled={locked} onChange={value => onChange({...anchor, end_us: value})} onError={onError} /></View>}
    {anchor.kind === 'interval' && <View style={s.anchorRow}><Button compact style={{flex: 1}} disabled={locked} onPress={() => onChange({...anchor, start_us: time})}>Start here</Button>
      <Button compact style={{flex: 1}} disabled={locked} onPress={() => onChange({...anchor, end_us: time})}>End here</Button></View>}
  </View>;
}

function TimeField({label, value, disabled, onChange, onError}: {
  label: string; value: number; disabled: boolean; onChange: (value: number) => void; onError: (error: string) => void;
}) {
  const [text, setText] = useState(timeLabel(value, true));
  useEffect(() => setText(timeLabel(value, true)), [value]);
  const commit = () => {
    const parsed = parseTime(text);
    if (parsed === null) onError('Enter a video time such as 01:30 or 01:30.250.');
    else if (parsed !== value) onChange(parsed);
    setText(timeLabel(value, true));
  };
  return <View style={s.anchorField}><Text style={s.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} style={[s.input, s.anchorInput, disabled && {color: colors.muted}]} editable={!disabled}
    value={text} onChangeText={setText} onEndEditing={commit} selectTextOnFocus /></View>;
}

function VisibilityEditor({draft, disabled, onChange, onError}: {
  draft: Draft; disabled: boolean; onChange: (drawings: Drawing[]) => void; onError: (error: string) => void;
}) {
  if (draft.anchor.kind !== 'interval') return null;
  const start = draft.anchor.start_us;
  const end = draft.anchor.end_us;
  const last = draft.drawings[draft.drawings.length - 1];
  return <View style={s.anchorRow}><TimeField label="Last drawing · show until" value={start + last.visible_until_us} disabled={disabled}
    onError={onError} onChange={value => {
      if (value > end || value <= start + last.visible_from_us || value <= start + last.samples[last.samples.length - 1].t_us) {
        onError('Choose an end after the drawing’s final sample and within the review range.'); return;
      }
      onChange(draft.drawings.map(item => item.id === last.id ? {...item, visible_until_us: value - start} : item));
    }} /></View>;
}
