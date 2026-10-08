# GamePack — Immutable Comments and Timed Drawing Reviews

**Plan revision:** 3 — append-only comments, comment-owned drawing playback  
**Updated:** October 8, 2026  
**Status:** Proposed product specification and implementation plan. No feature, benchmark, or platform support described here is claimed to be implemented.  
**Platforms:** React Native interfaces on macOS, Windows, iOS/iPadOS, and Android; shared Rust engine.  
**Operating model:** Offline-first; no account, developer-operated server, LLM, or network connection required for the core workflow.  
**Working name:** GamePack. General-purpose video review, with sports as the first demonstration and pilot audience.

## 1. Decisions in this revision

This document supersedes the editable-comment and conflict-resolution design in `GamePack-Implementation-Plan-v2.md`. It retains the two ZIP exports, unchanged source footage, exact media matching, React Native/Rust architecture, local storage, and benchmark-led development.

### The new product rule

> A posted comment is a complete, immutable review: its text, author snapshot, video reference, time anchor, and optional drawing sequence are published together. Further feedback is another comment or reply, never an edit to the posted object.

Required consequences:

- Drafts are editable; posted comments are not.
- The drawing sequence belongs to exactly one comment and becomes immutable with it.
- Drawings are not independent shared objects that another person can revise.
- A comment can target a moment or an interval, including a 30-second walkthrough.
- Timed drawings follow the video's playback position, not elapsed wall-clock time.
- Selecting a comment selects its drawing sequence. Different comments can overlap in time without combining their drawings.
- Replies and corrections are new immutable comments with their own author, anchor, and optional drawings.
- ZIP import adds previously unseen complete comments and ignores identical known comments.
- Ordinary collaboration needs no edit-conflict dialog, comment revision graph, text merge, last-write-wins policy, or deletion tombstones.
- Same-ID/different-content records are an integrity error, not a normal collaboration conflict.
- Media originals remain unchanged. No normal commenting or ZIP exchange operation burns drawings into the video or re-encodes it.

### What stays out of v1

No real-time networking, magic links, cloud accounts, hosted library, simultaneous editing, shared comment deletion, shared reactions/status editing, AI, automatic alignment to edited videos, voiceover, screen-recorded walkthroughs, custom video codec, or destructive compression.

“Real-time drawings” in this plan means synchronized drawing playback from saved annotation data. It does not mean a live collaborative session.

## 2. Product experience

### 2.1 Create an ordinary timestamped comment

1. Open a video already linked or imported into a project.
2. Click **Comment**, use the shortcut, or click the image while Comment mode is selected.
3. Pause at the displayed frame and capture that frame's presentation time.
4. Enter the comment. An optional pin marks the clicked image location.
5. Preview and select **Post comment**.
6. Show the comment as posted only after the local durable-write operation succeeds.

Normal playback gestures should not accidentally create comments. Desktop keyboard and accessible controls provide the same workflow without requiring a spatial pin.

### 2.2 Create a timed visual walkthrough

Example: a comment about `01:10–01:40` of a source video.

1. Create a draft, write the explanation, and choose **Add drawings**.
2. Set a moment or an interval; for this example, choose the 30-second interval.
3. Play the interval and draw. Freehand strokes appear progressively at the times they were drawn; arrow/circle tools can appear at their insertion times.
4. Pause or seek between strokes when needed. Draft controls allow undo, removal, timing adjustment, and complete retakes before posting.
5. Replay the draft exactly as a recipient will see it.
6. Select **Post comment** to publish the text, interval, author snapshot, and complete drawing sequence as one object.

The recipient selects the comment and uses **Play review**. The original video plays with only that comment's drawings, synchronized to its interval.

Suggested comment card:

> **Maya · 01:10–01:40 · Drawings attached**  
> Watch how the coverage changes after the motion.  
> **Play review** · **Reply**

The same feature works for a sports clip, dance rehearsal, client video review, or screen recording.

### 2.3 Replies and corrections

A reply is a new comment with `parent_comment_id`; a correction can additionally specify `corrects_comment_id`. Neither replaces or mutates its target.

Example:

> **Maya:** Watch the left defender at 01:22.  
> **Maya, replying:** Correction: I meant the right defender. See my new drawing below.

The second comment may contain its own timed drawing sequence. Selecting it replaces the active overlay rather than modifying or accumulating onto the first comment's overlay.

Replies inherit the parent's video and proposed anchor when drafted, but the author can choose another point or interval in that same video before posting. Cross-video references can be added later as explicit links, not ambiguous reply remapping.

### 2.4 Display names without accounts

Ask once: **“What name should appear on your comments?”** Show **“Commenting as Maya”** in the draft composer.

Use a stable random `author_id` for the local profile and a `name_at_posting` snapshot in each posted comment. Equal names do not mean equal authors. A profile rename applies to future posts and does not silently rewrite previous attribution.

Record a reported creation time for display, but do not use that clock to decide whether a comment overwrites another. These names and times are self-declared metadata, not verified identity or proof of when an event occurred.

Changing the local profile remains allowed. Changing the author snapshot on a posted comment does not.

## 3. Drafts versus posted records

This distinction is essential to making immutable comments usable.

### Drafts

Draft text, anchor, geometry, sample timing, and styles are editable. Autosave drafts locally. Support undo/redo while drafting; none of this editing history is exchanged.

Preview is not publication. A draft can be discarded, and incomplete work must survive an application restart when autosave has succeeded.

Drawing sessions on an existing posted comment are prohibited. **Reply with drawings** or **Create follow-up** creates a new draft instead.

### Posting

On posting:

1. Validate the target project, media identity, anchor, parent references, drawing bounds, and sample timing.
2. Freeze the displayed author snapshot and comment contents.
3. Assign/persist a stable comment ID once for this publish attempt.
4. Produce the deterministic canonical representation and digest.
5. Commit the entire comment, including all drawing data, in one local transaction.
6. Mark the draft as published in the same transaction.
7. Return the existing result if a retry repeats the same publication attempt.

Double-clicking Post or retrying after a lost acknowledgment must not create two comments. A failed publication leaves an editable draft and no partially visible posted comment.

Do not publish text first and attach drawings later: that would violate the immutable-object contract.

### Removing or hiding information

V1 has no shared comment-delete operation. A local **Hide** filter may suppress a comment in that person's view but does not delete it from the collaboration or from another person's copies. Hidden comments remain in normal selected-video exports; the export preview must make that clear.

Private scratch notes stay outside the shared posted stream. Publishing one creates a fresh posted comment and never includes private draft history.

A user can remove a local project copy without issuing a deletion to collaborators. A clean independent project/export can omit material, but it is a separate review, not a mechanism for retracting a previously shared comment.

This is a product simplicity tradeoff. State clearly before posting/exporting that later replies correct content but do not erase earlier shared information. Review this policy with pilot users rather than promising irreversible records are always desirable.

## 4. Drawing ownership and playback rules

### 4.1 One selected comment, one overlay

The player has a single `active_comment_id` or none.

- Browsing a video normally does not automatically show every overlapping drawing.
- Selecting a point comment pauses at its anchor and shows its static drawing, if present.
- Selecting an interval comment seeks to its start and prepares its drawing sequence without automatically starting playback.
- **Play review** plays that interval with the selected overlay and pauses at completion.
- Selecting another comment replaces the overlay atomically; it does not blend layers.
- A text-only comment has no overlay, even when its parent has one.
- Closing/deselecting the comment clears the overlay.
- Replies do not inherit drawing data. Their own explicit sequence is shown only when selected.

The interval timeline can highlight other comments without showing their drawings. An explicit compare/multi-layer mode is out of scope until users need it.

### 4.2 Video time is the source of truth

Store source media presentation times, not `frame_number / assumed_fps`, the device wall clock, or elapsed time since pressing Play. Preserve the selected stream and normalized timeline origin.[S5]

For an interval comment with source start `start_us` and source playhead `playhead_us`:

```text
local_time_us = playhead_us - start_us
```

Drawings are visible only in `[start_us, end_us)`. Use end-exclusive intervals consistently. At the end of Play review, show **Review complete** and do not leave a misleading overlay on later frames.

At half speed, double speed, buffering, or pause, the overlay follows the same source playhead as the video. It does not run on an independent timer.

Declared timestamp precision is not a claim of frame-perfect native playback. Measure actual alignment and seek behavior on each supported platform.

### 4.3 Proposed drawing primitives

Start with freehand pen, arrow, and circle/ellipse. Each belongs to its parent comment and includes:

- A comment-local drawing identifier and stable layer order.
- A tool type and validated style.
- Geometry in normalized source-image coordinates.
- `visible_from_offset_us` and `visible_until_offset_us` for interval comments.
- For freehand, ordered samples with a source-relative time and normalized coordinates.

Use a fixed normalized coordinate grid, for example integers from `0` to `1_000_000`, to avoid storing screen-pixel positions. A viewport transform handles aspect ratio, rotation, letterboxing, resize, and optional zoom. Stroke widths should scale consistently with the video content rectangle, not the whole window.

Native pointer data can be richer during drafting. The posted object should contain only supported geometry and style, not executable drawing commands, HTML, or platform-specific handles.

### 4.4 Progressive strokes, persistence, and shapes

For a freehand stroke, replay the path prefix supported by samples at or before the current video time. A renderer may interpolate between adjacent distinct-time samples according to one documented rule; the reference evaluator and platform renderers must use that same rule.

After the final sample, keep the complete stroke visible until its explicit visibility end. Default to the end of the comment interval. While drafting, an author can shorten that duration using a simple **Show until** control.

In v1, arrows and circles may appear fully formed at their insertion time; animating their drag gestures is not required. The UI should preview this exact behavior before publication.

Undo during drafting removes draft geometry. It is not a shared erase event. Per-stroke visibility windows provide timed disappearance without inventing a mutable global canvas.

Example:

| Source time | Selected comment's visual state |
|---|---|
| 01:10 | Review starts; no drawing yet. |
| 01:13–01:15 | A freehand line is progressively drawn. |
| 01:15–01:25 | The completed line remains visible. |
| 01:22 | A circle appears. |
| 01:25 | The line ends; the circle remains. |
| 01:40 | The review interval ends and the overlay clears. |

Another person's comment can cover exactly these times with entirely different geometry. It has no effect until selected.

### 4.5 Drawing while paused

A paused video has no advancing media time. V1 therefore treats a stroke drawn while paused as appearing complete at that paused timestamp when the review is replayed. Samples at that timestamp retain a deterministic order.

For a point comment, its drawings are static: selecting the comment pauses on the relevant frame and shows them. Resuming ordinary video playback clears the point overlay. There is no hidden duration inferred from how long the author paused.

Reproducing an author's eight-second pause and hand movement on a frozen frame would require a separate presentation clock and scripted playback. That is explicitly outside v1. Explain the current behavior in the draft preview so users do not mistake it for screen recording.

### 4.6 Seeking while drawing and replaying

Finish the active stroke before authoring seeks. Do not record a single stroke across a backward seek or discontinuous playhead jump. After seeking, new geometry is a new stroke with timestamps relative to the chosen interval.

Samples within a stroke must be nondecreasing in source time. Out-of-order UI callbacks must not produce invalid sample order; associate input with the native media clock, sequence it, and validate before posting.

Changing the draft's interval after drawing requires explicit validation: keep valid source-anchored marks, warn about marks now outside the interval, and request correction before posting. Do not silently stretch or shift geometry in time.

During review, seeking to any point reconstructs the overlay for that point. The user must not need to replay from the beginning to make drawings correct. Seeking backward removes path segments that have not happened yet.

An optional derived index/checkpoint cache may accelerate rendering. It is disposable and is never the authority for a posted comment.

## 5. Data contract

### 5.1 Immutable comment envelope

Proposed conceptual fields:

```text
Comment
  comment_id
  project_id
  project_video_id
  media_id
  author_id
  name_at_posting
  created_at_reported
  parent_comment_id?       # a reply; not an edited version
  corrects_comment_id?     # explicit reference; never overwrites its target
  text
  anchor
    kind                  # point or interval
    stream_id
    at_us?                # point
    start_us?, end_us?     # interval
  pin?                    # optional image location
  drawing_sequence?       # owned by and committed with this comment
  schema_version
```

`comment_id` is generated once and remains stable in every ZIP. Do not use author name, text, or timestamp as the identifier.

Posted text, anchor, attribution, and drawing samples are immutable. `edited_at`, editable drawing entities, revision parents, conflict heads, and shared tombstones are not part of the new comment format.

`parent_comment_id` describes conversation structure only. Reply references must be acyclic and belong to the same project/video context. Limit graph depth and processing work on import. An unavailable parent is represented as a pending/missing context reference, not silently reassigned or discarded.

### 5.2 Encoding and validation

Use a documented deterministic Rust-owned serialization for immutable logical records. Freeze the exact field order/encoding before publishing the archive format. Canonical decimal strings for integer microseconds and fixed-point geometry are proposed cross-language choices.

Reject duplicate JSON keys, unsupported required fields/features, invalid numeric strings, nonfinite values, oversized text/point arrays, and duplicate comment-local drawing IDs. Normalize input only before publication and preview; never silently alter imported posted content.

Keep a digest of canonical immutable content for comparison. The digest covers project/media scope, author snapshot, anchor, text, and drawing payload. Exclude local UI flags, locations, and import history. A digest detects changes relative to a known record; it does not authenticate the person who created a ZIP.

Do not assume arbitrary JSON byte ordering is meaningful. Preserve and compare canonical logical content, not the order in which another serializer happened to emit keys.

### 5.3 Local-only data

Editable drafts, current profile settings, read/unread flags, bookmarks, hidden-comment filters, last playhead, selected overlay, window layout, local aliases, device file permissions, and project display ordering stay local.

Imported project-title changes may be presented as suggested labels, not silent shared edits. New video memberships are independent additions. Removing or reordering a video locally does not delete someone else's comments.

### 5.4 Suggested storage entities

| Entity | Responsibility |
|---|---|
| `AuthorProfile` | Current local profile and stable self-declared identity. |
| `MediaAsset` | Exact-byte identity, size, selected stream metadata, timing/geometry conventions. |
| `AssetLocation` | Linked or managed file, permission/access state, verification status; never exported verbatim. |
| `Project` | Collaboration identity and local display settings. |
| `ProjectVideo` | Stable membership linking an asset to one collaboration. |
| `CommentDraft` | Editable local work, draft geometry, publish-attempt ID. |
| `PostedComment` | Canonical immutable body and digest. |
| `DrawingIndex` | Optional derived lookup/render index for a comment; rebuildable. |
| `LocalCommentState` | Read/hidden/selected flags; not shared. |
| `ImportReceipt` | Package digest, accepted scope, counts, media matches, warnings. |
| `Job` | Durable import/export/media task and recovery state. |

One Rust-owned coordinator performs SQLite writes. Export logical records, not the live database. SQLite's local transaction and WAL documentation remain implementation references.[S11][S18]

## 6. Storage and media identity

### Originals never change

Link existing videos read-only by default where persistent platform access is supported. Managed imports keep one verified media object reused across projects. Retain relinking and permission-recovery workflows for external files and mobile providers.[S9]

FFmpeg is for inspection and explicitly separate derivatives such as thumbnails. Ordinary comments, drawings, and ZIP exchange require no transcoding.[S5]

An already encoded source is decoded for playback as needed; do not expand the whole recording into an uncompressed disk file. No automatic re-encoding of idle originals. Storage savings initially come from reusing source assets and pruning safe caches.

### Exact identity

Retain the proposed `media_id` based on BLAKE3 of the full file plus byte size, using incremental hashing.[S8]

- Same bytes with another name: eligible for automatic matching.
- Same name with different bytes: not an exact match.
- Different encode, remux, trim, or edit: separate media identity unless a later explicit mapping feature is used.
- Same media in another project: reuse storage, not the discussion.

Metadata such as size, duration, and filename may narrow candidate searches, but never substitute for the full identity check. Verify that a linked source remains available and unchanged before export or playback decisions that rely on its cached identity.

### Storage accounting

Display separately: linked external bytes, managed media, posted annotation data, drafts, rebuildable indexes/previews, exported ZIPs, and temporary space.

A full ZIP necessarily contains footage. A recipient may temporarily hold both the ZIP and an extracted managed copy. Do not describe that as zero-copy delivery. Avoid redundant internal staging and reuse existing verified managed assets.

Never silently delete a user's original or a received ZIP. Explain which files can be safely removed from the application's perspective and leave the decision to the user.

## 7. Two ZIP exports

### Videos + annotations

Select multiple project videos and export their original bytes plus posted comments, replies, and each comment's drawing sequence. Include each selected media object once.

The preflight screen lists actual media, scope, attribution, and estimated output size. A virtual interval does not redact the rest of its original video: v1 shares the whole selected file. Sensitive interval-only distribution requires a separate prepared clip and explicit mapping workflow; do not pretend hidden timestamps exclude footage.

Use stored ZIP entries for original media and compressed entries for text where appropriate. ZIP64 support is needed for valid large entries/offsets; the ZIP format is lossless packaging, not a video encoder.[S16]

### Annotations only

Include complete posted-comment snapshots for the selected videos, media identities, and project context. Drawing data is vector/timing metadata, not a rendered video, screenshot, or image payload.

Include no video, audio, thumbnails, or screenshots by default. A recipient can read comments before linking missing footage, then replay drawings after matching the exact video.

A complete metadata snapshot avoids asking users to choose which previous export to patch. Stable IDs make previously received records harmless duplicates. Include relevant reply ancestors for the selected scope; do not create orphaned replies through arbitrary private/public filtering.

### Proposed archive layout

```text
manifest.json
project.json
media-index.json
project-videos.jsonl
comments.jsonl           # complete immutable comments, nested drawing sequences
media/                   # absent for annotations-only
  <opaque-asset-name>.mp4
```

Do not include revision headers, current-head files, or deletion markers from the v2 proposal. Do not duplicate the authoritative drawing data in a second editable file. A future large-sequence blob layout must remain immutable and fully referenced by its comment if introduced.

Manifest fields include the product format ID, format version, required capabilities, package ID, project ID, package kind, selected memberships, entry digests/sizes, and media-inclusion policy. Suggested capabilities are `immutable-comments-v1` and `comment-drawing-sequences-v1` when used.

Document revision 3 does not imply archive format version 3. Before the first release, freeze a first public schema. If a prototype exported an earlier incompatible format, detect it and require explicit conversion into a new review instead of silently pretending editable revisions are immutable posts.

### Portable import

**Open project** accepts either kind. Inspect content rather than trusting the filename.

Example import preview:

> **4 videos matched · 1 needs locating**  
> **9 new comments · 3 replies · 2 drawing reviews included**  
> **Existing project: Thursday practice**

The counts are illustrative, not measured. “Drawing reviews included” is a subset/attribute of comments, not additional independently merged entities.

Normal actions are **Import**, **Locate missing video**, and **Cancel**. There is no routine “resolve comment edits” screen.

A known `project_id` updates that collaboration. A new one creates a separate review. An intentional independent copy gets a new collaboration identity and remapped comment references, while continuing to reuse verified media storage.

## 8. Append-only import and merge

### 8.1 Normal behavior

| Input | Required behavior |
|---|---|
| New comment ID with valid contents | Add the complete comment. |
| Known comment ID with identical canonical contents | Ignore the duplicate. |
| Known comment ID with different canonical contents | Reject/quarantine the import; preserve the trusted local object. |
| Different IDs with identical text/time | Keep both. They can be genuinely separate observations. |
| Two comments with overlapping drawings or intervals | Keep both independently; selection controls rendering. |
| New reply | Add it and link its parent when available. |
| A correction comment | Add it; do not rewrite the target. |
| An old ZIP | Add only unseen valid records; never roll back or overwrite. |
| A comment omitted from an export | Do nothing to the local record. |
| File renamed but exact identity found | Bind it to the existing media asset. |
| Media unavailable | Retain readable comments and mark playback as awaiting footage. |

For valid records in the same collaboration, conceptual merging is set union over comment IDs with identical-content validation. Require idempotence, commutativity, and associativity for the accepted comment set. Local read state and import timestamps need not be identical between devices.

This simpler merge follows directly from prohibiting shared edits and deletion. It is not a solution for arbitrary mutable collaborative documents, and must not be advertised as one.

### 8.2 Integrity errors are not edit conflicts

Same-ID/different-content can arise from corruption, a software bug, manual archive tampering, or identity misuse. Never use timestamp recency or a “last ZIP wins” rule to select a version.

Abort the metadata transaction for the offending package and show a useful error/exportable diagnostic without leaking local paths or private content. Users should not be asked to manually reconcile these as everyday football/video feedback.

If a brand-new, unknown ID arrives in a forged package, self-declared author metadata does not prove authenticity. Immutability is an application/storage contract, not cryptographic identity or tamper-proof evidence.

### 8.3 Conversation completeness

Normal exports include complete posted discussion for selected videos, including reply ancestors. When receiving incomplete external data, show a missing-parent placeholder and retain validated pending references. Do not manufacture a parent or attach it by matching text.

Reject cycles, contradictory project/video scope, unreasonable nesting, and invalid identifiers. Project membership IDs also have immutable identity fields; an existing membership cannot silently change which media it targets.

### 8.4 Thread state

Do not add synchronized reactions, shared resolved flags, or mutable thread titles to v1 casually: those reintroduce mutable merge semantics. A reply such as “Resolved in the next take” remains append-only. Personal bookmarks/read state can remain local.

No CRDT or general text-merging dependency is necessary for the proposed first workflow. Reevaluate only if future requirements introduce shared mutable state.

## 9. Import/export safety and recovery

### Import sequence

1. Inspect supported format, required capabilities, entry inventory, and declared sizes.
2. Validate paths, schemas, IDs, digests, timing/geometry, and comment/reference scope.
3. Prepare a non-mutating preview of added/duplicate records and exact/pending media bindings.
4. Ask for confirmation and any missing-file locations.
5. Stream missing media into controlled staging, verify bytes, and reuse verified existing assets.
6. Journal publication of new media objects.
7. Commit validated complete comments, mappings, and import receipt in a short SQLite transaction.[S18]
8. Recover orphaned staging or published-but-unreferenced media after interruption.

Filesystem publication and SQLite commit are not one transaction; explicitly test both crash windows. Do not hold a write transaction across long hashing or extraction work.

When reusing local footage, do not claim that an unexamined archive copy was fully verified. Distinguish reused local media from freshly imported and verified media.

### Export sequence

1. Freeze a snapshot of selected video memberships and complete posted comments.
2. Build an explicit allowlist excluding drafts, local state, paths, credentials, unused profiles, and other projects.
3. Preview complete-original inclusion, notes, attribution, and plain/encrypted status.
4. Confirm source availability and output-space requirements.
5. Stream media and canonical annotation records into a temporary archive, validating sizes and source hashes.
6. Finalize and inspect the archive before publishing it as completed.
7. Preserve originals and local projects on cancellation or failure.

An interrupted ZIP may need to restart rather than resume at the byte offset. State that honestly and avoid publishing a partial archive as a usable pack.

### Archive and renderer defense

Treat imported files and vector data as untrusted.

- Reject absolute/traversal paths, NULs, symlinks, device entries, duplicate normalized paths, and cross-platform case collisions. Derive extraction paths from validated asset IDs.[S17]
- Enforce entry count, expanded-byte, JSON depth/string, point-count, geometry, timeline, and reply-depth limits. Check actual streamed bytes, not declarations alone.
- Allow only supported compression methods and capabilities. Support legitimate large media using streaming/ZIP64 rather than unbounded memory allocation.[S16]
- Reject duplicate keys, unknown required tools, invalid colors, nonfinite/out-of-range geometry, and times outside declared ranges.
- Do not execute scripts, load remote assets, interpret imported HTML, or invoke arbitrary FFmpeg arguments from a package.
- Render unknown optional data as a clear unsupported-item notice; never silently misrepresent a required drawing feature.
- Sandbox media-processing and file access as appropriate to each platform; pin and update native dependencies after compatibility testing.

A normal ZIP is not automatically encrypted; encryption is an optional archive capability.[S16] Label plain exports **“Anyone with this file can read the included material.”** No app-operated upload service is different from encrypted at-rest storage or encrypted delivery through a third party.

Original media can contain embedded metadata. Byte-preserving sharing retains it. Annotations-only packages can still contain sensitive text, author names, and spatial/timing observations.

## 10. Architecture and platform integration

```text
Shared React Native screens and TypeScript workflow
                       │
         compact typed native commands/events
                       │
                Shared Rust engine
      ┌────────────────┼───────────────────┐
 Media identity   Drafts + immutable    ZIP import/export
 and storage      comments + merge     and validation
      │                 │                    │
 Source files     SQLite + optional drawing index
                       │
       Native playback clock + overlay renderer
```

Retain the proposed small C++ native-module/CXX boundary to Rust. The individual technologies have documentation, but the combined implementation and four-platform parity must be tested.[S1][S2][S3][S4][S6][S7]

All application interfaces remain React Native. Thin platform-specific file access, player, drawing surface, accessibility, and packaging adapters are expected; no Tauri replacement is introduced.

Keep video bytes and decoded frames out of the JavaScript message path. Pass references, compact draw instructions, commands, and throttled progress. Hashing, ZIP processing, and validation are asynchronous native work.

### Playback/overlay contract

The native player exposes current displayed/presentation time, seek completion, playback-rate changes, pause/buffer state, content-rectangle transforms, and stream orientation.

Evaluate the active comment against that media time. Do not animate the overlay using low-frequency generic UI progress callbacks or an independent JavaScript interval. Prototype timing fidelity before picking the final cross-platform drawing surface.

A pure/reference evaluator maps `(immutable sequence, source time)` to normalized visible geometry. Native renderers consume equivalent evaluated state. Rendering code must not write back into the posted sequence.

Only the selected comment needs full drawing evaluation. Index samples and visibility windows to support seeking; avoid scanning every comment in a large project on every frame. Cache evaluations only as an optimization.

### Native API sketch

```text
setAuthorProfile, getActiveAuthor
linkAsset, importManagedAsset, verifyAsset, relinkAsset
createProject, addProjectVideo
createCommentDraft, updateDraft, previewDraft, discardDraft
postCommentDraft
listComments, getComment, selectCommentForReview
inspectPackage, prepareMediaBindings, previewImport, commitImport
prepareExport, exportPackage
getStorageSummary, cancelJob, getJobProgress
```

`updateDraft` cannot operate on a posted ID. No edit-posted-comment, edit-posted-drawing, or shared-delete API is exposed. Reply creation is draft creation with a parent reference.

### Repository sketch

```text
gamepack/
  apps/{mobile,macos,windows}/
  packages/
    app/                  # shared RN workflows
    ui/                   # generic review components
    native-gamepack/      # typed commands and platform adapters
    player-overlay/       # player clock and drawing contract
  crates/
    core/                 # commands/domain orchestration
    storage/              # SQLite, locations, media identity
    review/               # drafts, immutable comments, append-only merge
    drawing/              # validation and reference timeline evaluator
    archive/              # schema, streaming ZIP, safe import/export
    media/                # probe/thumbnail jobs
    ffi/
    cli/                  # validators, fixtures, benchmarks
  schemas/
  fixtures/
  benchmarks/
  docs/
```

These are logical boundaries; fewer crates are acceptable initially. Keep one source of truth for schema, media identity, comment immutability, and drawing semantics.

## 11. Milestones and release gates

### M0 — Native playback and drawing proof

Run one shared React Native screen on macOS, Windows, iOS/iPadOS, and Android. Play a source, pause and seek, obtain media time, draw a normalized overlay, and call an asynchronous Rust job.

**Gate:** actual platform/dependency matrix, measured overlay alignment, file-access persistence checks, and documented unresolved differences. A successful Mac build is not proof of cross-platform support.

### M1 — Local immutable comments

Implement source linking/managed imports, stable authors, moment/interval anchors, editable local drafts, atomic posting, replies, local autosave, and read-only posted cards.

Draft the immutable record schema and append-only merge tests now, before parallel UI work diverges.

**Gate:** sources unchanged, no per-project video duplication, no edits to posted records, repeat Post requests cannot duplicate a comment, and crashes preserve acknowledged work under the chosen durability contract.

### M2 — Comment-owned timed drawing reviews

Add draft drawing tools, normalized geometry, media-timed samples, preview, point/interval playback, visibility windows, and selected-comment isolation.

**Gate:** the same 30-second review behaves correctly during normal play, slow/fast play, buffering, backward/forward seeks, and platform resize. A second overlapping comment does not alter the first. Paused-stroke semantics are clearly demonstrated.

### M3 — Full and annotations-only ZIP round trip

Freeze the initial public archive schema; implement streaming export/import, exact media matching, pending footage, complete comment merging, import previews, and plain-ZIP warnings.

**Gate:** two people independently post comments and replies, exchange ZIPs in different orders, and converge on the same accepted posted-comment set and drawing data. Repeated imports add no duplicates. Different content claiming an existing ID is rejected.

### M4 — Hardening and release

Exercise corrupted archives, disk-full conditions, crash windows, large media, dense drawing tracks, mobile suspension/permissions, accessibility, installer/bootstrap, and FFmpeg distribution requirements.[S15]

**Gate:** the documented supported platform combinations complete the full round trip without developer tools or a developer-operated service. Publish reproducible correctness and performance reports.

Build the Mac workflow in depth first if convenient, while keeping all native targets in the integration matrix from M0. Do not postpone every platform risk until packaging.

## 12. Benchmarks and acceptance tests

All targets here are proposed; publish actual results only after running the tests.

### Non-negotiable correctness gates

- Original file hashes remain unchanged through creation, posting, review, export, import, and cleanup.
- Multiple projects/comments reuse one linked or managed source.
- A posted comment and its drawing sequence cannot be modified through application APIs.
- A post is fully present or absent after recovery; no partially attached drawing sequence.
- Draft revisions, private notes, local paths, permissions, and UI state do not enter exports.
- Annotations-only exports contain zero video/audio/image payload; drawings remain structured vector/timing data.
- Equal timestamps, names, text, or intervals never collapse distinct comment IDs.
- Repeated and reordered valid imports yield the same set of complete comments.
- Same-ID/different-content is rejected, not treated as a user edit to reconcile.
- Exact media binds after a rename; a different file with the old name does not.
- Active overlays never leak geometry from another comment.
- Seeking reconstructs the correct drawing state without replaying from the start.
- Paused playback freezes interval animation; point overlays clear on resume.
- Changing playback speed keeps drawing timing anchored to media, not wall time.

### Measured workloads

| Workload | Measure |
|---|---|
| Link/hash large source | Throughput, peak memory, UI responsiveness. |
| Open project/video | First interactive UI, first frame, storage reads. |
| Post a comment | Acknowledged durable-write latency, retry behavior. |
| Load 1k/10k/100k synthetic comments | Query/scroll responsiveness, memory; label these stress tests. |
| Replay dense 30-second drawing review | Overlay evaluation time, frame-budget use, visible timing error. |
| Seek/switch selected comments | Latency and exact expected visible geometry. |
| Full ZIP export/import | Time, CPU, staged bytes, extracted/reused media bytes. |
| Annotations-only import | Parse/validation/merge time and resulting payload size. |
| Repeated/reordered exchanges | Correctness plus memory/time growth. |
| Human round trip | Total effort, including draft preview, locating media, and understanding replies. |

For drawing stress tests, declare sample count, tool mix, visible stroke count, video resolution, playback rate, platform, and hardware. More samples are not automatically better; any sample reduction must meet an explicit visual-error bound and preserve timing.

Frame-rate and synchronization claims need actual device measurements. A microsecond storage field does not imply microsecond display precision.

### Reference/property tests

- Set-union merge idempotence, commutativity, and associativity for valid comments.
- Equivalent pure evaluator state after a direct seek versus normal playback reaching the same timestamp.
- Correct interval boundaries and equal-time sample ordering.
- Round-trip serialization preserving canonical comment content and digests.
- No implicit overlay inheritance on replies or comment switches.
- Two people using the same display name but different IDs.
- A replied-to comment arriving after its reply.
- Same package twice, different packages with overlapping snapshots, and independent offline posts.
- False known-ID payload, conflicting media membership, cycles, malformed drawings, and excessive sample counts.

### Failure tests

Cancel during ZIP creation, kill the app between media publication and metadata commit, exhaust disk space during post/import/export, revoke a source permission, disconnect an external drive, alter a linked source during export, and load malformed archive fixtures.

Test mobile background/suspension separately from desktop process termination. Neither should lead the UI to claim an operation completed when durable state was not committed.

### Continuous improvement

Run small correctness suites on each pull request. Run heavier benchmarks on a consistent trusted machine with source/fixture checksums, commit, OS, build flags, dependency versions, power state, codec properties, and cold/warm cache distinction.

Generate JSON and static report artifacts instead of an always-on dashboard. Establish baseline variance before failing small timing regressions. Correctness regressions fail immediately.

Suggested future CLI commands: `inspect`, `verify`, `replay-overlay`, `import-preview`, `export`, `bench`, `compare`, and `report`. These are proposed interfaces, not existing commands.

## 13. Parallel work boundaries

| Workstream | Initial ownership | Acceptance contract |
|---|---|---|
| Product/UI | Draft, posted card, interval authoring, review player | No edit affordance after post; clear preview and selected overlay. |
| Native integration | Player clock, viewport transform, files, FFI | Shared behavior demonstrated on each platform. |
| Storage | Identity, drafts, immutable posts, local state | Atomic publish, no source mutation, no duplicate assets. |
| Drawing | Tools, reference evaluator, native rendering | Comment ownership, seek correctness, clock alignment. |
| Archive/collaboration | Schema, snapshots, import previews, set-union | Repeated imports safe; known-ID mismatch rejected. |
| Quality | Fixtures, failure injection, static benchmarks | Measured correctness before optimization claims. |

Freeze shared contracts before delegating many tasks to contributors or coding agents. No agent should independently invent an alternative timeline, editable drawing table, or comment merge policy.

## 14. General-purpose positioning

**Category:** offline video review with portable feedback.

**Headline:** “Video feedback that travels with the footage.”

**Feature explanation:** “Leave a comment, draw through a moment, and let someone replay exactly the annotations you attached. Exchange videos or just feedback as ZIPs; the original footage stays unchanged.”

Avoid promising an exact recreation of pauses or narrated presentations: the first drawing mode follows media time and has the documented paused-stroke behavior.

### Demonstrations using the same features

- **Football/hockey:** a coach annotates a 30-second movement sequence; another coach replies with an independently drawn interpretation over the same footage.
- **Music/dance/skills:** an instructor marks timing and technique; a student replies at a precise moment.
- **Video creators:** a client adds frame/range notes to a particular cut; comments remain tied to that exact version.
- **Software QA/product review:** a reviewer circles a UI behavior as it occurs in a screen recording and exchanges an annotations-only ZIP.

Use generic navigation: Projects, Videos, Comments, People, and Share. Sports tags are optional. Do not expand into tactical inference, professional grading, scheduling, or an editor simply to broaden the market.

## 15. Open-source distribution and later options

Publish the application, shared engine, schema, import/export CLI, generated/permitted fixtures, build instructions, and benchmark history. No private footage, author data, or sample team comments belong in the repository.

No required runtime server means no required developer video-hosting bill. Native distribution, signing, dependency updates, security work, and support still require resources. Pin and review FFmpeg/native dependency builds and licenses before distributing binaries.[S15]

The app should make no implicit network requests for accounts, telemetry, assets, or models. Optional future update checks/diagnostics need documented consent. Plain ZIPs and recipient disks are not automatically encrypted.

Possible later features, only after useful file-based collaboration:

- Authenticated encrypted exports and a clear key-delivery/recovery workflow.
- Explicit compact/segment derivatives with validated annotation mapping.
- Verified mapping to changed video versions.
- Profile migration and optional signed attribution.
- Narrated/pause-aware presentations with a separate presentation timeline.
- Explicit multi-comment comparison, never accidental overlay mixing.
- Paired nearby delivery, then user-owned internet delivery infrastructure.

Do not reintroduce edits to posted comments incidentally while building any of these. Such a change would be a deliberate product and archive-format decision.

## 16. Release demonstration

A completed first release should show:

1. Link an original without copying or modifying it.
2. Enter a display name; create an editable draft for a 30-second interval.
3. Draw during playback, preview it, and post a complete immutable comment.
4. Attempt to revise it through the UI; the available action is Reply/Create follow-up instead.
5. Add a second overlapping comment with different drawings.
6. Select each comment and see only its own synchronized overlay.
7. Export multiple videos plus annotations and open them on another device.
8. The recipient adds replies/drawings while the original author posts different comments offline.
9. Return annotations only; match the source by exact identity, independent of filename.
10. Import in different orders and repeatedly with no lost or duplicated comments.
11. Seek through both drawing sequences and verify expected states.
12. Report unchanged source hashes, annotation payload size, extra storage, merge time, and drawing-playback measurements.

This is the main product demonstration. Networking and an LLM are unnecessary.

## References and provenance

This revision is a design update based on the user's explicit immutable-comment and comment-owned timed-drawing requirements and the preceding v2 plan. All new UI rules, fields, merge behavior, timeline conventions, and tests above are proposed engineering choices, not claims of an existing implementation or findings established by the references.

The following implementation references are retained from the earlier plan for follow-up; they were not freshly reverified for this design-only revision. Verify dependency versions and platform support at M0. No new literature or competitive-research claims are made.

- [S1] React Native 0.82 architecture transition: https://reactnative.dev/blog/2025/10/08/react-native-0.82
- [S2] React Native performance/architecture caveats: https://reactnative.dev/architecture/landing-page
- [S3] React Native Windows architecture guidance: https://microsoft.github.io/react-native-windows/docs/new-architecture/
- [S4] React Native C++ native modules: https://reactnative.dev/docs/the-new-architecture/pure-cxx-modules
- [S5] FFmpeg processing model: https://ffmpeg.org/ffmpeg.html
- [S6] React Native macOS setup: https://microsoft.github.io/react-native-macos/docs/getting-started
- [S7] CXX Rust/C++ bindings: https://cxx.rs/
- [S8] BLAKE3 official implementation: https://github.com/BLAKE3-team/BLAKE3
- [S9] Android document/file permissions: https://developer.android.com/training/data-storage/shared/documents-files
- [S11] SQLite WAL behavior and limitations: https://sqlite.org/wal.html
- [S14] VMAF: https://github.com/Netflix/vmaf
- [S15] FFmpeg distribution considerations: https://ffmpeg.org/legal.html
- [S16] PKWARE ZIP format, stored entries, encryption, and ZIP64: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
- [S17] Rust ZIP entry/path validation documentation: https://docs.rs/zip/latest/zip/read/struct.ZipFile.html
- [S18] SQLite transactions: https://sqlite.org/lang_transaction.html
