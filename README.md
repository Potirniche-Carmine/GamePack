# GamePack

Offline video review with immutable comments and freeze-frame drawings. GamePack uses React Native desktop screens, a shared Rust/SQLite engine, and native media players. No account, upload service, telemetry, or runtime server is required.

The app is under active development and is not a stable MVP. It supports local video review, comments anchored to a single frame, pen/arrow/ellipse markup, nested replies, and persistent appearance and keyboard settings. Posted comments cannot be edited; deleting their video or project removes them. ZIP exchange is not implemented.

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
2. Click empty video space or press Space to play or pause. **Watch** hides comments, drawings, review shortcuts, and filmstrip markers and plays continuously; **Review** stops at commented frames and waits for Play. Several comments at the same frame share one stop. Seeking back lets you review them again.
3. Choose Pen, Arrow, or Ellipse and draw on the frozen frame to start a comment. New conversations require a drawing; replies may contain only text. All drawings use the same blue ink. The laser (B) is temporary.
4. Add text and choose **Post**, or press Command/Control+Return. Set your display name when prompted. A comment holds completed drawings at one instant; drawing while the video plays and timed stroke replay are not supported.
5. Read comments in the floating glass column. One number per conversation connects its drawings, card, and filmstrip marker. Selecting a card emphasizes its drawings. **Reply** opens a composer on the same frame; replies stay with their conversation. Scroll the column for additional comments, or hide it with the comment control beside the drawing tools.
6. Use F for fullscreen. Space resumes playback; Up/Down or Page Up/Page Down in fullscreen moves between original comments. Escape closes menus, leaves text focus, or exits fullscreen.

The complete video frame fits the available workspace without cropping at Fit. Floating glass controls sit over a blurred extension of the footage; comments do not reserve space above or below the player. The title opens videos in the current folder. An unposted “+” filmstrip marker restores a saved draft. Playing or seeking away saves the current draft without moving its timestamp. **Discard** removes that draft and its drawings; **Post** publishes them.

Zoom using Fit/percentage, the mouse wheel, or a trackpad pinch. Footage and drawings zoom together; comment cards retain their size. Playback speed has its own dropdown. Native frosted surfaces and a blurred extension of the video's colors provide the surround in both themes.

Projects contain videos and one level of folders. Item menus provide rename, move, and delete actions. Removing a folder returns its videos to the project without changing comments. Moving a video stays within its project.

Existing timed comments are converted once to a completed drawing on the final included instant of their clip. Original posted records are retained for recovery. New records have no intervals, drawing colors, sample timestamps, or live-replay fallback.

Open the settings cog for a centered preferences window to choose System, Light, or Dark appearance and edit keyboard shortcuts. The profile avatar opens your name and initials settings. Click a shortcut and press its replacement; conflicts and reserved system/text keys are rejected. Clear unneeded bindings or reset all defaults. Appearance and bindings are stored in SQLite.

Defaults: Space plays/pauses; J/K/L shuttle backward, stop, and shuttle forward; Left/Right step frames; Shift+Left/Right seek five seconds; P/A/E select drawing tools; V selects the standard pointer; B selects the laser; + or = zooms in, − zooms out, and 0 fits the footage; Command/Control+Z and +Shift+Z undo/redo drawings. Command/Control+1–9 opens projects; Option/Alt+Up/Down changes videos within the current folder in the displayed order. F toggles fullscreen; Shift+M toggles comment cards; Command/Control+Shift+R expands or collapses replies. Existing custom assignments take precedence over these new defaults. Full assignments are searchable in Settings. Shortcuts do not intercept text editing, except the configured post shortcut.

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
- `native/macos`: AVPlayer, freeze-frame overlay, file picker, and CXX module.
- `apps/windows`: Win32/XAML React Native Windows host and native player.
- `crates/gamepack-core`: domain validation, canonical records, SQLite, media identity, evaluator, and CLI.
- `docs/mvp-contract.md`: concrete integration contract.
- `GamePack-Implementation-Plan-v3.md`: longer product roadmap, including deferred ZIP exchange and mobile targets.

Mobile targets, live collaboration, narrated/frozen-frame walkthroughs, ZIP exchange, and signed consumer installers remain outside the current development scope. Actual tested behavior and limitations are documented in [verification](docs/verification.md).
