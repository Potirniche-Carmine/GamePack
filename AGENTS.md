# GamePack

GamePack is an offline desktop video review app for macOS and Windows (ARM64 and x64). The shared React Native interface lives in `packages/app`; native AVPlayer/MediaPlayer hosts bridge through CXX to the Rust/SQLite engine in `crates/gamepack-core`. Keep application data and configuration inside `GAMEPACK_HOME` or `~/.gamepack`. Work on `main`; GitHub Actions is paused while the app is under active development. Do not create releases, tags, publish packages, or enable release automation unless the user explicitly requests it. Build and packaging workflows must only run from `main` and remain disabled until explicitly re-enabled.

## Interface rules
- Omit ornamental eyebrow headings, redundant subheadings, explanatory helper paragraphs, instructional status lines, selection-state captions, drawing-count badges, storage statistics, technical media metadata, roadmap disclaimers, and permanence/autosave reassurance copy.
- Prefer concise control labels and visible interaction states. Show errors and progress only when they help the user act or understand an operation that is still running.
- Preserve the simple review workflow. Do not add unsolicited product explanations, tutorials, promotional copy, or extra sections.

Verify native behavior and inspect screenshots in both themes before calling UI work complete. Keep demo footage and local verification screenshots out of the public repository.
