# GamePack

GamePack is an offline desktop video review app for macOS and Windows (ARM64 and x64). The shared React Native interface lives in `packages/app`; native AVPlayer/MediaPlayer hosts bridge through CXX to the Rust/SQLite engine in `crates/gamepack-core`. Keep application data and configuration inside `GAMEPACK_HOME` or `~/.gamepack`. Work on `main`; GitHub Actions builds and packages both platforms.

## Interface rules

- Use restrained neutral surfaces with light-blue accents, in light and dark modes. Keep alignment, spacing, and contrast consistent.
- Omit ornamental eyebrow headings, redundant subheadings, explanatory helper paragraphs, instructional status lines, selection-state captions, drawing-count badges, storage statistics, technical media metadata, roadmap disclaimers, and permanence/autosave reassurance copy.
- Prefer concise control labels and visible interaction states. Show errors and progress only when they help the user act or understand an operation that is still running.
- Keep profile avatars, names, and disclosure controls vertically centered.
- Display replies as nested, collapsible children of their parent comment.
- Let users draw while video playback continues. Save ends the captured clip using native media time; playback and annotations must remain synchronized after seeking or changing speed.
- Preserve the simple review workflow. Do not add unsolicited product explanations, tutorials, promotional copy, or extra sections.

Verify native behavior and inspect screenshots in both themes before calling UI work complete. Keep demo footage and local verification screenshots out of the public repository. ZIP collaboration remains deferred.
