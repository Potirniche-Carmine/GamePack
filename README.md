# GamePack

Offline video review with immutable comments and timed drawings. GamePack uses React Native desktop screens, a shared Rust/SQLite engine, and native media players. No account, upload service, telemetry, or runtime server is required.

The MVP supports adding a video, drawing with pen/arrow/ellipse tools while it plays, and saving the captured clip with a comment. Paused-frame comments and manual time ranges are also supported. Replies appear as collapsible children of their parent. Drafts autosave; saved comments cannot be edited. ZIP import and export are visible but disabled.

## Download

[GitHub Releases](https://github.com/Potirniche-Carmine/GamePack/releases) provides separate macOS ARM64, macOS x64, Windows ARM64, and Windows x64 packages. Choose the architecture of your computer. Each package includes an installer, embedded JavaScript, the Rust engine, and a SHA-256 checksum; developer tools are only needed to build from source.

Standard GitHub-hosted runners build the packages. Version tags publish a release only after every architecture succeeds. See [builds and releases](docs/ci.md). Linux is deferred.

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

See [Windows installation](docs/windows.md) for the dependency installer, source build, and package registration. Windows code is compiled by the repository's Windows CI; a Mac run does not establish Windows playback or visual correctness. See [verification](docs/verification.md) for actual results and outstanding platform checks.

## Review a video

1. Choose **Add video**. GamePack stores one byte-preserving managed copy in the library, reused for identical footage across projects.
2. Choose **Comment** and draw over the footage while it plays. A captured clip starts at the first stroke. You can also pause to annotate a single frame.
3. Choose **Save** to pause and finish the clip at the native video playhead, including its final stroke.
4. Enter the comment in the dialog and save it. Set your display name when prompted. The comment and drawings are saved together.
5. Play the video normally to see saved drawings and their matching highlighted comments. **Hide annotations** shows the original footage. Use **Reply** to add a child review; expand or collapse the thread beside its parent.

A stroke drawn while paused appears complete at that frame's timestamp. During an interval, samples are revealed by source media time; speed changes, seeks, and pauses do not use a separate annotation timer. The end of a range is exclusive. Normal playback shows moment annotations for two seconds, capped at the video end; selecting a moment still displays its exact frame. Rendering uses a stable matching color for each comment and its drawings without changing the saved drawing data.

Open your profile to choose System, Light, or Dark appearance. Both themes use light-blue accents; the preference is saved inside the library database.

## One library folder

All application-owned mutable data is under `GAMEPACK_HOME` or `~/.gamepack` (`%USERPROFILE%\.gamepack` on Windows): SQLite, drafts, author profile, managed media, cache, and temporary files. The macOS installer puts the executable under that same folder. The Windows installer copies its native package into the same library root before registering it; see its installation notes. System frameworks may maintain their normal OS caches and preferences.

The original selected file is read-only. GamePack hashes and copies media incrementally, verifies its managed copy, and deduplicates by BLAKE3 plus byte length. Ordinary comments never transcode or burn marks into footage. Database writes use WAL and `synchronous=FULL`; complete comments and drawings publish atomically with their draft status. Publication retries reuse the draft's stable ID.

Back up the library with GamePack closed. Removing the app does not delete the library. ZIP interchange is not implemented and no archive format is promised by this MVP.

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

Mobile targets, live collaboration, narrated/frozen-frame walkthroughs, ZIP exchange, and signed consumer installers remain outside this MVP. Actual tested behavior and limitations are documented in [verification](docs/verification.md).
