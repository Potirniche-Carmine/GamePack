# GamePack

Offline video review with immutable comments and timed drawings. GamePack uses React Native desktop screens, a shared Rust/SQLite engine, and native media players. No account, upload service, telemetry, or runtime server is required.

The app is under active development and is not a stable MVP. It supports local video review, comments with optional end times, pen/arrow/ellipse markup, nested replies, and persistent appearance and keyboard settings. Posted comments cannot be edited; deleting their video or project removes them. ZIP exchange is not implemented.

## Download

[GitHub Releases](https://github.com/Potirniche-Carmine/GamePack/releases) provides separate macOS ARM64, macOS x64, Windows ARM64, and Windows x64 packages. Choose the architecture of your computer. Each package includes an installer, embedded JavaScript, the Rust engine, and a SHA-256 checksum; developer tools are only needed to build from source.

All GitHub Actions build and release jobs are currently disabled, including manual and reusable calls. Only `main` is permitted when explicitly re-enabled. Do not create tags or releases without an explicit user request. See [builds and releases](docs/ci.md). Linux is deferred.

## macOS

Requires macOS 14 or later. For a release package, extract it and run `Install.command`.

The source build uses Xcode, Node, Rust, and CocoaPods. Build prerequisites are installed by the bootstrap script; Xcode must be installed from the Mac App Store and opened once.

```sh
git clone https://github.com/Potirniche-Carmine/GamePack.git
cd GamePack
bash scripts/bootstrap-macos.sh
bash scripts/install-macos.sh
```

The installer creates `~/.gamepack/app/GamePack.app` and `~/.gamepack/Launch GamePack.command`. Double-click either to run it. The release app embeds its JavaScript, Rust engine, SQLite, and native playback integration; the installed app needs no Node, Cargo, CocoaPods, Metro, or running terminal.

For a portable location, set `GAMEPACK_HOME` before installing. Use the generated launcher so the same folder is used on subsequent launches:

```sh
GAMEPACK_HOME="$HOME/GamePack" bash scripts/install-macos.sh
```

To rebuild after changes, run `bash scripts/build-macos.sh`, then install again. This builds for the current Mac architecture. Public distribution is not notarized or Developer ID signed yet; local source builds are ad-hoc signed.

## Windows

See [Windows installation](docs/windows.md) for the dependency installer, source build, and package registration. Windows changes require a native Windows build and interactive verification; hosted jobs are currently disabled. A Mac run does not establish Windows playback or visual correctness. See [verification](docs/verification.md) for actual results and outstanding platform checks.

## Review a video

1. Open a project, then a folder or video. **New project**, **New folder**, and **Add video** keep the library organized. The breadcrumb returns to a project or folder; the GamePack mark opens all projects. Search stays within the current location.
2. Click empty video space or press Space to play or pause. Drawing tools sit at the left of the video. Choose **Comment** or press M to focus the comment box; Escape returns focus to the video so Space resumes playback.
3. Add markup. Playback pauses as soon as a stroke starts when **Pause when drawing starts** is enabled. Finishing a stroke opens a comment beside the drawing. Drag its header to reposition it or expand its timestamp to adjust timing. The separate laser tool (B) makes a temporary pulse.
4. Choose **Post** or press Command/Control+Return to capture the final stroke and publish. Set your display name when prompted.
5. Click a timed comment to open its conversation. A small dot indicates replies; opening a thread shows its nested replies. Use **Reply** to respond. The numbered filmstrip markers and Up/Down keys navigate original comments. Replies stay inside their on-video conversation; there is no discussion side panel.
6. Use the fullscreen icon at the right of playback controls or press F. Space plays/pauses, Up/Down or a Page Up/Page Down presenter advances through original comments, and Escape closes an open menu or exits fullscreen.

Opening a video gives the footage the full workspace. The video title opens the other videos in its current folder, with actions to browse that location or add a video. Unfinished comments reopen when you return to their video; Add comment or Reply also resumes an unfinished comment for that conversation. **Discard** removes the current comment and its drawings; **Post** publishes them. Spaces typed in the composer remain text. Replies are visible inside expanded conversations and never become separate playback annotations.

Zoom with the percentage control, the mouse wheel, or a trackpad pinch. The footage and drawings zoom together; card positions follow the footage. Playback speed has its own dropdown.

Projects contain videos and one level of folders. Item menus provide rename, move, and delete actions. Removing a folder returns its videos to the project without changing comments. Moving a video stays within its project.

A stroke drawn while paused appears complete at that frame's timestamp. During an interval, samples are revealed by source media time; speed changes, seeks, and pauses do not use a separate annotation timer. The end of a range is exclusive. Normal playback shows moment annotations for two seconds, capped at the video end; selecting a moment still displays its exact frame. Rendering uses a stable matching color for each comment and its drawings without changing the saved drawing data.

Comments with drawings appear from the first visible drawing sample until the final drawing ends. Text-only comments follow their moment or range. Older notes are placed in nearby free space. Drag a card by its header to save its position; expanded conversations scroll within the card. Moving a card changes only its local placement, preserving the posted content and digest.

Open the settings cog for a centered preferences window to choose System, Light, or Dark appearance and edit keyboard shortcuts. The profile avatar opens your name and initials settings. Click a shortcut and press its replacement; conflicts and reserved system/text keys are rejected. Clear unneeded bindings or reset all defaults. Appearance, bindings, and drawing behavior are stored in SQLite.

Defaults: Space plays/pauses; J/K/L shuttle backward, stop, and shuttle forward; Left/Right step frames; Shift+Left/Right seek five seconds; I/O set comment start/end; M starts a comment; P/A/E select drawing tools; V selects the standard pointer; B selects the laser; + or = zooms in, − zooms out, and 0 fits the footage; Command/Control+Z and +Shift+Z undo/redo drawings. Command/Control+1–9 opens projects; Option/Alt+Up/Down changes videos within the current folder in the displayed order. F toggles fullscreen; Shift+M toggles on-video comments; Command/Control+Shift+R expands or collapses replies. Existing custom assignments take precedence over these new defaults. Full assignments are searchable in Settings. Shortcuts do not intercept text editing, except the configured post shortcut.

Item menus delete a project or video after confirmation, including its comments and drafts. Original files and content-addressed managed media are retained; shared footage remains available to other projects and re-imports. This action does not reclaim disk space.

Icons use official [Lucide](https://lucide.dev/) assets with their bundled license. `npm run icons` regenerates native-scale image assets from the locked library version.

## One library folder

All application-owned mutable data is under `GAMEPACK_HOME` or `~/.gamepack` (`%USERPROFILE%\.gamepack` on Windows): SQLite, drafts, author profile, managed media, cache, and temporary files. The macOS installer puts the executable under that same folder. The Windows installer copies its native package into the same library root before registering it; see its installation notes. System frameworks may maintain their normal OS caches and preferences.

The original selected file is read-only. GamePack hashes and copies media incrementally, verifies its managed copy, and deduplicates by BLAKE3 plus byte length. Ordinary comments never transcode or burn marks into footage. Database writes use WAL and `synchronous=FULL`; complete comments and drawings publish atomically with their draft status. Publication retries reuse the draft's stable ID.

Back up the library with GamePack closed. Removing the app does not delete the library. ZIP interchange is not implemented and no archive format is promised during development.

## Development

```sh
npm ci
npm run typecheck
npm run test:ui
cargo test --workspace --locked
cargo clippy --workspace --all-targets -- -D warnings
bash scripts/build-macos.sh
```

The release build embeds a production JavaScript bundle. `npm start` and `npm run macos` are development tools only.

- `packages/app/src`: shared React Native interface and typed native contract.
- `native/macos`: AVPlayer, media-clock overlay, file picker, and CXX module.
- `apps/windows`: Win32/XAML React Native Windows host and native player.
- `crates/gamepack-core`: domain validation, canonical records, SQLite, media identity, evaluator, and CLI.
- `docs/mvp-contract.md`: concrete integration contract.
- `GamePack-Implementation-Plan-v3.md`: longer product roadmap, including deferred ZIP exchange and mobile targets.

Mobile targets, live collaboration, narrated/frozen-frame walkthroughs, ZIP exchange, and signed consumer installers remain outside the current development scope. Actual tested behavior and limitations are documented in [verification](docs/verification.md).
