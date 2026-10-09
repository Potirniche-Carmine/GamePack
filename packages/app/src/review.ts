import type {Comment, Draft, Drawing} from './types';

export function mergeDrawings(existing: Drawing[], incoming: Drawing[]): Drawing[] {
  const ids = new Set(existing.map(item => item.id));
  return [...existing, ...incoming.filter(item => { if (ids.has(item.id)) return false; ids.add(item.id); return true; })];
}

export function beginLiveDraft(draft: Draft, durationUs: number, nativeUs?: number): Draft {
  const start = draft.anchor.kind === 'point' ? draft.anchor.at_us : draft.anchor.start_us;
  if (start >= durationUs) throw new Error('Move the playhead before the end of the video to record a clip.');
  let end = Math.max(start + 1, nativeUs ?? start);
  for (const drawing of draft.drawings) for (const sample of drawing.samples)
    end = Math.max(end, start + sample.t_us + 1);
  end = Math.min(durationUs, end);
  const drawings = draft.anchor.kind === 'point' ? draft.drawings.map(item => ({...item,
    visible_from_us: 0, visible_until_us: end - start,
    samples: item.samples.map(sample => ({...sample, t_us: 0})),
  })) : draft.drawings.map(item => ({...item, visible_until_us: end - start}));
  return {...draft, anchor: {kind: 'interval', start_us: start, end_us: end}, drawings};
}

/** Preserve source-anchored samples when the playhead moves backward. The end is
 * exclusive, so even a stroke at the native stop time needs one extra µs. */
export function finalizeLiveDraft(draft: Draft, nativeUs: number, durationUs: number, furthestUs = nativeUs): Draft {
  if (draft.anchor.kind === 'point') return draft;
  const start = draft.anchor.start_us;
  let requiredEnd = start + 1;
  for (const drawing of draft.drawings) for (const sample of drawing.samples)
    requiredEnd = Math.max(requiredEnd, start + sample.t_us + 1);
  if (requiredEnd > durationUs) throw new Error('A drawing extends beyond the video. Undo that drawing before saving.');
  const end = Math.min(durationUs, Math.max(requiredEnd, Math.round(nativeUs), Math.round(furthestUs), draft.anchor.end_us));
  if (end <= start) throw new Error('The captured clip must end after it starts.');
  const length = end - start;
  return {...draft, anchor: {...draft.anchor, end_us: end}, drawings: draft.drawings.map(item => ({...item, visible_until_us: length}))};
}

/** The native first sample defines the clip start, independent of when the
 * drawing controls were opened. Preserve all geometry while changing origin. */
export function finalizeCapturedClip(draft: Draft, nativeUs: number, durationUs: number, furthestUs = nativeUs): Draft {
  if (draft.anchor.kind === 'point') return draft;
  if (!draft.drawings.length) return {...draft, anchor: {kind: 'point', at_us: Math.min(durationUs, Math.max(0, nativeUs))}};
  let firstOffset = Number.MAX_SAFE_INTEGER;
  for (const drawing of draft.drawings) for (const sample of drawing.samples) firstOffset = Math.min(firstOffset, sample.t_us);
  const start = draft.anchor.start_us + firstOffset;
  // Native clocks can settle a fraction of a millisecond after Pause. Use the
  // same 2 ms tolerance as moment playback so a frozen frame stays visible.
  const frozenFrameToleranceUs = 2000;
  if (nativeUs <= start + frozenFrameToleranceUs && furthestUs <= start + frozenFrameToleranceUs &&
      draft.drawings.every(drawing => drawing.samples.every(sample => sample.t_us - firstOffset <= frozenFrameToleranceUs))) {
    return {...draft, anchor: {kind: 'point', at_us: start}, drawings: draft.drawings.map(drawing => ({...drawing,
      visible_from_us: 0, visible_until_us: 0, samples: drawing.samples.map(sample => ({...sample, t_us: 0})),
    }))};
  }
  const end = Math.min(durationUs, Math.max(start + 1, nativeUs, furthestUs));
  const rebased: Draft = {...draft, anchor: {kind: 'interval', start_us: start, end_us: end},
    drawings: draft.drawings.map(item => ({...item,
      visible_from_us: Math.max(0, item.visible_from_us - firstOffset),
      visible_until_us: end - start,
      samples: item.samples.map(sample => ({...sample, t_us: sample.t_us - firstOffset})),
    }))};
  return finalizeLiveDraft(rebased, nativeUs, durationUs, furthestUs);
}

/** Finish the outgoing scene before its selection or video can change. The
 * native acknowledgment may own the last stroke rather than onDrawing. */
export function capturedDraft(draft: Draft, pending: Drawing | undefined, nativeUs: number, durationUs: number, furthestUs: number, live: boolean): Draft {
  const next = {...draft, drawings: pending ? mergeDrawings(draft.drawings, [pending]) : draft.drawings};
  return live ? finalizeCapturedClip(next, nativeUs, durationUs, furthestUs) : next;
}

export function liveScene(draft: Draft, durationUs: number): {id: string; anchor: Draft['anchor']; drawings: Drawing[]} {
  if (draft.anchor.kind === 'point') return {id: draft.id, anchor: draft.anchor, drawings: draft.drawings};
  const length = durationUs - draft.anchor.start_us;
  return {id: draft.id, anchor: {...draft.anchor, end_us: durationUs},
    drawings: draft.drawings.map(item => ({...item, visible_until_us: length}))};
}

export type CommentThread = {comment: Comment; children: CommentThread[]};
export function replyBranches(roots: CommentThread[]): Set<string> {
  const ids = new Set<string>(), stack = [...roots];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.children.length) ids.add(node.comment.comment_id);
    for (const child of node.children) stack.push(child);
  }
  return ids;
}

export function toggleReplies(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
/** Missing parents and cycles become roots so every immutable comment remains
 * reachable. Building and flattening are iterative to tolerate deep replies. */
export function commentThreads(comments: Comment[]): CommentThread[] {
  const nodes = new Map(comments.map(comment => [comment.comment_id, {comment, children: [] as CommentThread[]}]));
  const parent = new Map<string, string>();
  for (const item of comments) {
    const candidate = item.parent_comment_id;
    if (candidate && candidate !== item.comment_id && nodes.has(candidate)) parent.set(item.comment_id, candidate);
  }
  const done = new Set<string>();
  for (const id of nodes.keys()) {
    const path: string[] = []; const seen = new Set<string>(); let current: string | undefined = id;
    while (current && !done.has(current)) {
      if (seen.has(current)) { parent.delete(current); break; }
      seen.add(current); path.push(current); current = parent.get(current);
    }
    path.forEach(value => done.add(value));
  }
  const roots: CommentThread[] = [];
  for (const [id, node] of nodes) {
    const parentId = parent.get(id);
    if (parentId) nodes.get(parentId)!.children.push(node); else roots.push(node);
  }
  return roots;
}

export function visibleThreads(roots: CommentThread[], expanded: ReadonlySet<string>): {node: CommentThread; depth: number}[] {
  const result: {node: CommentThread; depth: number}[] = [];
  const stack = roots.map(node => ({node, depth: 0})).reverse();
  while (stack.length) {
    const current = stack.pop()!; result.push(current);
    if (expanded.has(current.node.comment.comment_id))
      for (let i = current.node.children.length - 1; i >= 0; i--) stack.push({node: current.node.children[i], depth: current.depth + 1});
  }
  return result;
}

export function expandedAncestors(comments: Comment[], commentId: string, current: ReadonlySet<string>): Set<string> {
  const result = new Set(current);
  const byId = new Map(comments.map(item => [item.comment_id, item]));
  const seen = new Set<string>(); let item = byId.get(commentId);
  while (item?.parent_comment_id && !seen.has(item.comment_id)) {
    seen.add(item.comment_id); result.add(item.parent_comment_id); item = byId.get(item.parent_comment_id);
  }
  return result;
}
