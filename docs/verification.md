# Development verification

## Spatial review refinement — October 9, 2026

Verified with the signed macOS Release app, production JavaScript, AVPlayer, and Rust/SQLite in an isolated `GAMEPACK_HOME`. Fixture footage, thumbnail caches, and screenshots remain in ignored `artifacts/local/overhaul/`.

- Removed the discussion side panel and its header controls. Native checks cover collapsed cards, reply indicators, expanded nested replies, inline reply posting through Command–Return, and drawing a native ellipse to open a nearby composer. Comment and composer headers drag without triggering playback; posting retains the dragged location and complete text.
- Card placement uses video coordinates and a separate schema-v5 table. Rust tests verify save, post, move, reopen, migration, and invalid coordinates while preserving immutable comment content and digests. Additional UI regression cases cover letterboxing, zoom, crowded legacy notes, late drawing starts, and newly posted replies before state refresh.
- Empty video space plays and pauses with the normal pointer. The separate laser tool leaves playback unchanged. The native zoom menu, mouse wheel, keyboard plus/minus, and Fit reset were exercised; video and drawings share the same transform. Fullscreen entry and exit retain accessible cards and transport controls.
- The timeline displays twelve native video thumbnails. Files cache under `GAMEPACK_HOME`, and missing thumbnails fall back to the ordinary timeline. Coincident comment markers remain individually reachable.
- Inspected native light/dark workspace and Settings screenshots, the initials profile, fullscreen, project navigation, and an empty folder. App-owned library menus support keyboard selection and Escape. Search and profile inputs have centered content and no native blue bezel.
- The video switcher is anchored beneath its trigger and contains only videos in the current folder. Native Down/Return navigation opens Browse folder without invoking the underlying comment shortcuts; the small menu fits its contents.
- Final theme checks caught an AppKit backing-layer redraw issue that hid paused annotations until the next seek. The overlay now invalidates on effective appearance changes; switching light to dark and back keeps drawings visible without seeking.
- The requested animation audit led to 100 ms press feedback, 160 ms release, a restrained 180 ms settings entrance for pointer activation, and 140 ms switch movement. Keyboard activation remains immediate and reduced-motion preferences remove scale/travel. Drawing, dragging, playback, and comment disclosure stay direct.
- TypeScript, 59 UI/domain tests, 24 Rust integration tests, formatting, strict Clippy, and the macOS Release build pass. The isolated database reports schema version 5 and `integrity_check = ok`.
- Installed and opened the final build at `~/.gamepack/app/GamePack.app`; the existing project library and initials profile are present. Its executable and JavaScript SHA-256 values match the tested build, and deep signature verification passes.

Windows player and thumbnail source is updated but has not been compiled or exercised on a Windows device in this iteration. Hosted workflows remain disabled; no release was created.

## Workspace overhaul — October 9, 2026

Verified with the signed macOS Release app, production JavaScript, AVPlayer, and Rust/SQLite in an isolated `GAMEPACK_HOME`. Local fixture media and screenshots are excluded from Git.

- The application opens to projects. Native checks cover project and folder navigation, creating a folder, moving a video between folders, and the resulting empty folder. The moved location, profile, comments, and appearance survive restarting the app.
- Light and dark screenshots were inspected for the video workspace, expanded on-video conversations, Settings, and the no-video project state. The dark discussion, initials profile, and fullscreen layout were also inspected. Evidence lives under ignored `artifacts/local/overhaul/`.
- Clicking a timed comment expands its entire conversation, including replies to replies. A native reply posted through Command–Return retains its full text and correct parent. Individual and global sidebar disclosure work, and collapsed cards retain a subtle reply indicator.
- Coincident timeline markers group without hiding comments; clicking a group opens the discussion.
- Native playback, drawing-tool shortcuts, ellipse capture, posting, fullscreen entry, and returning from fullscreen to projects were exercised. The drawing toolbar remains below the fullscreen header.
- A comment with a native ellipse was left through the folder breadcrumb and reopened with its complete text and drawing, then posted. Empty drawing-tool selections do not reopen as unfinished work.
- Profile editing updates the initials avatar, and appearance settings persist. Confirmation dialogs focus Cancel and disable the background controls; Escape returns to the library without applying deletion.
- Theme switching with expanded conversations exposed a React Native macOS shadow-color lifetime crash. Comment cards and drawing controls now use borders; repeated light/dark switches with the conversations mounted pass in the rebuilt native app.
- SQLite reports `integrity_check = ok`, schema version 4. Folder migration and removal, cross-project move rejection, immutable comment preservation, Unicode initials, reply traversal, folder-scoped navigation, and unfinished-comment selection have automated coverage. TypeScript, 47 UI/domain tests, 20 Rust contract tests, Rust formatting, strict Clippy, the macOS build, and deep signature verification pass.
- Installed the verified build under `~/.gamepack/app/GamePack.app`. Its JavaScript SHA-256 matches the tested build and deep signature validation passes. The existing user process was left running; relaunch GamePack to load the update.

Windows runtime and screenshot verification remain outstanding; the shared React Native interface and Rust changes have not been built on a Windows machine in this iteration. Hosted workflows remain disabled and no release was created.

## Comment hierarchy and drawing controls — October 8, 2026

Verified with a signed macOS Release build in a separate app and an isolated `GAMEPACK_HOME` copied from the local library.

- Replies use an inset surface, stronger indentation, a reply icon, and smaller author/body type. Inspected the expanded thread in both light and dark appearances.
- Simultaneous on-video comments form a vertical, scrollable stack. Inspected three overlapping cards at 00:10 in the window and fullscreen; their individual Reply actions remain available and the carousel is removed.
- Command/Control hint badges and their native modifier-state emitters are removed. Shortcuts remain available in Settings and as accessibility hints. Native checks exercised playback, seeking, drawing-tool shortcuts, Settings, and Command–Return posting.
- Pointer is the default and is restored when leaving drawing modes. Native video clicks preserve both paused and playing states, including switching from a drawing tool during playback. The native click-to-toggle-playback event is removed on both platforms.
- Selecting Pen, Arrow, or Ellipse leaves the Comments dock closed. Completing a pen stroke also leaves it closed while respecting the pause-on-drawing preference. M explicitly opens the composer; the posted test comment retained its complete text and one drawing. The isolated database integrity check returned `ok`.
- TypeScript, all 31 existing UI/domain tests, the macOS Release build, and deep signature verification pass. Local screenshots `54`–`58` are ignored under `artifacts/local/screenshots/`.

Windows source is updated but has not been compiled or exercised on Windows. Hosted workflows remain disabled.

## Drawing and focus refinement — October 8, 2026

Verified in a separate macOS Release app and isolated `GAMEPACK_HOME`, preserving the user's running app and library.

- A native stroke pauses AVPlayer before its first sample. Finishing it opens the composer without focusing text. M focuses the comment, ordinary spaces remain text, Escape blurs it, and Space resumes playback with the selected drawing tool retained. A second stroke paused again and both drawings posted in their captured 00:10–00:17 range.
- Native clock settling exposed a submillisecond interval after an otherwise frozen stroke. Capture now uses the existing 2 ms moment tolerance. The final native build posted “Hold this frame.” as a point at 2,608,544 µs with all drawing sample times zero. SQLite integrity returned `ok`.
- Discard clears the current drawing and composer. Preview and the Draw toggle are removed; drawing tools remain visible. The collapsed composer is compact, and Discard/Post share dimensions. Pointer clicks produce a temporary pulse without creating a comment or persisted drawing.
- Normal windows have independently collapsible Library and Comments docks. Fullscreen hides those docks, restores them on exit, and places the compact composer and original-comment cards at the right. Profile circles are removed and author names emphasized. Close, add, and delete controls share alignment.
- Native reply expansion/collapse was checked by clicking the same screen coordinates twice. The disclosure remains in the parent action row; expanding children no longer triggers automatic scroll-to-selection. Global expansion remains available.
- Inspected native screenshots in both themes, including loaded video, fullscreen, composer, and an empty library. Evidence is local and ignored under `artifacts/local/screenshots/48`–`53`; `empty-light.jpg` and `empty-dark.jpg` are the requested no-video views.
- Shortcut badges now fit inside their controls and use high-contrast labels instead of clipped negative offsets. Native accessibility exposes the configured shortcuts. A physical Command hold remains a manual visual check: synthesized held chords did not capture the transient modifier state reliably.
- TypeScript, 31 UI/domain tests, 16 Rust contract tests, and the signed macOS Release build pass. Regression coverage includes frozen-frame capture, native clock settling, and resuming a moment into a longer review.
- Installed under `~/.gamepack/app/GamePack.app`; its JavaScript SHA-256 matches the verified build and deep signature validation passes. The user's existing process was already running and was left intact; relaunch it to load this update.

Windows source includes pause-on-contact and pointer events but has not been compiled or exercised on Windows. Hosted workflows remain disabled.

## Continuous video workspace — October 8, 2026

Verified with the local macOS Release app, production JavaScript, AVPlayer, and Rust/SQLite in an isolated `GAMEPACK_HOME`. Existing source changes and the user's library were preserved.

- The running installed app initially contained an older reply implementation. The rebuilt interface inserts and removes actual reply rows. Native checks cover individual disclosure, global expand/collapse across multiple threads, and disclosure with a focused composer.
- Playback, timeline, drawing tools, color, undo/redo, and the composer now sit on an edge-to-edge video surface. Library and discussion open as floating panels without resizing the footage. Drawing tools appear on demand. Timing is expandable; drawing minimizes the composer. There is no drafts UI or startup restoration of unfinished composers; existing stored records are preserved.
- Native drawing verification created an ellipse at 00:04, posted a 00:04–00:09 comment, entered fullscreen, sought to the exclusive end (card disappears), and sought backward (card and drawing return). A reply posted from fullscreen retained its full text and parent relationship after restart.
- The standard fullscreen icon sits at the right end of the playback controls; there is no separate Present action. Fullscreen entry/exit, Escape, Page Down navigation, selection preservation, and opening the complete discussion in fullscreen were exercised. Global expansion reveals replies in fullscreen as well.
- Moving controls over the player exposed AppKit forwarding mouse events to the video. The native overlay now accepts only a mouse sequence that starts on the video itself. Rechecked that clicking Comment creates a paused moment, while native drawing still records geometry.
- Light and dark workspace screenshots and the dark fullscreen surface were inspected. Text contrast meets 4.5:1; input, button, and selected-state boundaries meet 3:1. Video overlays deliberately use a dark surface in either appearance. Local final screenshots are `44-fullscreen-icon-final.jpg`, `45-final-light.jpg`, and `46-final-dark.jpg` under ignored `artifacts/local/screenshots/`.
- Space starts and stops native playback, while a Space typed into the focused composer remains text. Original comments alone appear over the video and in next/previous navigation; replies and nested replies remain accessible through the discussion. Native disclosure checks were repeated in the floating discussion.
- TypeScript, 29 UI/domain tests, 16 Rust contract tests, the macOS Release build, and deep signature verification pass. Added cases cover timed note boundaries, overlapping notes, EOF, chronological navigation, nested/global disclosure, original-only video notes/navigation, and migration that preserves older custom keybindings.
- Shortcut hints use the configured bindings, include accessible shortcut descriptions, and suppress unrelated hints while editing text. Accessibility inspection confirmed the preserved custom play binding and Command–1 project mapping. A modifier-only physical keyboard hold still needs a manual visual check: the automation API rejects modifier-only key presses and did not capture the transient badges during synthesized chords.
- Installed the final local build under `~/.gamepack/app/GamePack.app`, verified its deep signature and byte-identical JavaScript bundle, and opened it against the existing library. Native inspection confirmed existing footage/comments, Space playback binding, the fullscreen icon, and no drafts list. The user's separate preview window and active annotation were left running.

Windows fullscreen and Control-key hint handling are implemented in source but have not been compiled or exercised on Windows. Hosted workflows remain disabled. This iteration changes the local review interface; it does not add ZIP exchange, cloud sharing, or synchronization.

## Current interface iteration — October 8, 2026

This iteration is under active development, not a stable MVP. Verification uses the local macOS Release build, its production JavaScript bundle, AVPlayer, and Rust/SQLite in an isolated `GAMEPACK_HOME`. Demo footage and verification screenshots are not committed.

- TypeScript checks, 23 UI/domain tests, 16 Rust contract tests, Rust formatting, and Clippy with warnings denied pass. The added checks cover shortcut conflicts and remapping, appearance contrast, preference migration/persistence, and scoped project/video deletion with shared media and immutable comment guards preserved.
- The macOS Release build compiles and signs locally. Native checks cover shortcut recording/conflict feedback, replacement of Space with a custom binding, persistence after restart, text-entry isolation, Command–Return posting, frame stepping, project navigation, and opening/cancelling deletion confirmation.
- Drawing tools remain visible. Native playback pauses after completing a stroke with that preference enabled, keeps the tool selected for more marks, and posts two drawings with the inline comment. The review workspace and Settings are inspected in both light and dark appearances.
- Automated contrast checks cover normal/muted text, button labels, input outlines, and selected-control outlines. Native screenshots remain necessary to check actual rendered assets and layout.
- Native checks caught and fixed stale icon tints after theme changes and a final-character race during immediate keyboard posting. Rechecked theme switching, complete posted text, and posting while the time field has focus. Official Lucide assets and their license are included in the notice inventory.
- macOS, Windows, and release workflows are disabled on GitHub. Their source has no push, pull-request, or tag triggers; each job remains disabled and restricted to `main`. No release was made for this iteration.

The Windows shortcut/player source is updated but has **not** been compiled or exercised on a Windows device for this iteration. Hosted verification remains paused as requested. Project/video deletion is exercised by Rust integration tests; the native confirmation UI is inspected without deleting a user library. Deleting a library item retains cached media bytes and original source files.

## Historical v0.1.3 verification

Verified on October 8, 2026. The local UI run uses the installed Release app on Apple silicon, native AVPlayer, the production JavaScript bundle, and the real Rust/SQLite engine. It does not use a browser mock, Metro server, or seeded comment fixture.

### Historical local macOS results

The demo MP4 from Downloads was imported through the native file picker. It is 1920 × 1080, approximately 30 seconds, and 17,839,845 bytes. The source and managed copy both have SHA-256 `d6617a009c0c6c9aebf7398d43cad6d1985ddc1b9ab0479e2ea977362b8af5b0`. The original was not modified. Footage and screenshots remain local and are excluded from this public repository.

| Check | Observed result |
| --- | --- |
| Native installation | Release ARM64 app runs from `~/.gamepack/app/GamePack.app`; deep ad-hoc signature verification passes |
| Hosted package installation | v0.1.3 Apple silicon package from GitHub Actions installed with its included `Install.command`; installed executable and JavaScript match the downloaded artifact byte for byte; the public release archive matches that artifact; library and theme retained |
| Playback | Native video renders; play, pause, slider and ±5-second seeks work |
| Profile | In-app display-name dialog saves “Demo reviewer” |
| Draft recovery | Text and an ellipse survived quitting and reopening before posting |
| Moment comment | Text plus an ellipse posted successfully at 00:00 |
| Reply | Immutable reply with range 00:00–00:12 and arrow/pen posted; appears as an indented, collapsible child |
| Editing a draft | Undo removes the last stroke; redo restores it |
| Preview and replay | Draft preview at 0.5× and posted review at 2× work; range stops at 00:12 and clears drawings |
| Timed pen | A separate range review captured positive media-relative sample times near 9.73 seconds |
| Direct seeking | Seeking to 00:10 reconstructs the timed stroke; returning to 00:05 removes it |
| Review isolation | Selecting the moment displays only its ellipse; overlapping reviews do not mix drawings |
| Live capture | Started playback, opened Comment, and drew without pausing; Save paused the native player and opened the comment dialog |
| Captured boundaries | Saved clip starts at the first native stroke sample, 2,585,953 µs, and ends at native Save time, 8,199,413 µs; samples rebased to zero and drawing visibility bounded to the clip |
| Normal playback | Ordinary Play renders overlapping reviews together with matching comment/drawing colors; the moment disappears after two seconds, the captured clip after its end, and the later pen appears at its sampled time |
| Raw video | Hide annotations removes saved overlays and active comment colors; Show annotations restores them at the current playhead |
| Appearance | Both light and dark themes inspected; Light survived reinstall and Dark survived restart; profile row vertically centered |
| Window resize | Layout remains usable at approximately 1100 × 730 points; normalized ellipse remains aligned with footage |
| Final restart | Video, profile, six posted comments, parent reply relation, theme, and all drawings survive restart |
| Storage integrity | SQLite `integrity_check` returns `ok`; schema version 2, one video, six comments, zero remaining drafts |
| Return to drawing | Reply text survived Back to drawing; playback resumed, a second stroke was added, and the saved nested reply contains its arrow and pen |
| Leaving a live draft | Close captured 8.174–11.299 seconds from the first stroke; reopening and restarting retained those bounds and the drawing, then posting succeeded |
| Deferred ZIP | Both buttons remain visible and disabled |

Evidence is saved under `artifacts/local/screenshots/`. Screenshots `01`–`10` cover the initial import, drawing tools, isolated review, seeking, restart, and hosted-package installation. The final interface is covered by `11-light-threaded.png`, `12-light-raw-video.png`, `13-dark-overlays.png`, `14-live-capture.png`, `15-comment-prompt.png`, `16-saved-live-clip.png`, `17-normal-playback-later.png`, `18-compact-dark.png`, `19-restart-live-clip.png`, `20-draft-navigation-recovery.png`, `21-nested-live-reply.png`. The installed GitHub-built v0.1.3 package is shown in `22-release-v0.1.3-dark.png` and `23-release-v0.1.3-light-raw.png`.

### Historical automated verification

`npm run typecheck`, Rust formatting, and Clippy with warnings denied pass locally. Fourteen Rust integration tests run on macOS; thirteen run on Windows because the symlink fixture uses Unix-only APIs. These cover persistence and appearance migration, media deduplication and tamper detection, atomic publication and retry idempotency, concurrent publication, transaction rollback, immutable snapshots, reply boundaries, drawing validation, strict JSON validation, deterministic seek evaluation, metadata updates, and filesystem symlink containment. Nineteen UI-domain tests cover aggregate playback, consistent review colors, exclusive ends, EOF moments, native capture boundaries, live draft recovery and navigation, final-stroke deduplication, large stroke data, and nested/cyclic/orphaned reply trees. The macOS native Release build and package script pass locally. Windows CI also runs JSON payload regression fixtures against the compiled Rust CLI, checks the app/runtime PE machine codes, and verifies that declared Microsoft framework dependencies are bundled.

The [v0.1.3 release workflow](https://github.com/Potirniche-Carmine/GamePack/actions/runs/37848971586) passed all four macOS ARM64/x64 and Windows ARM64/x64 builds and published [four installers with checksums](https://github.com/Potirniche-Carmine/GamePack/releases/tag/v0.1.3). Public downloads were fetched and checked against their SHA-256 files; the installed Apple silicon archive matches the public download byte for byte. Both Mac architectures passed binary architecture, version, signature, and notice checks. Both Windows archives passed checks for every native DLL, manifest activation path, OS minimum, runtime dependency, and notice. The release workflow requires every package and checksum before publishing. A successful build establishes compilation and packaging; Windows playback, pointer interaction, and visual correctness still require an interactive Windows device check. They are not established by the Mac screenshots.

### Historical practical limits

This is an offline development app, with no ZIP exchange, mobile targets, Linux target, live sync, or automatic update service. macOS packages are ad-hoc signed and not notarized; Windows packages are unsigned and use development-package registration. Installation documentation explains the relevant OS prompts.

The UI and media engines use source media time, stored as integer microseconds. That storage precision is not a claim of microsecond playback accuracy: frames, input sampling, media decoding, and display refresh have their normal platform limits. Native moment overlays allow a 2 ms match tolerance around a seek; interval ends are exclusive.

The React Native 0.81 desktop dependencies are deliberately aligned between macOS and Windows. npm audit still reports transitive advisories in that dependency tree; the full audit is retained locally at `artifacts/local/npm-audit.json`. Dependency upgrades need coordinated native compatibility work. Release operation needs no development server.
