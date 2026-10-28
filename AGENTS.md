# GamePack

GamePack is an offline desktop video review app for macOS and Windows (ARM64 and x64). The shared React Native interface lives in `packages/app`; native AVPlayer/MediaPlayer hosts bridge through CXX to the Rust/SQLite engine in `crates/gamepack-core`. Keep application data and configuration inside `GAMEPACK_HOME` or `~/.gamepack`. CI is enabled. Develop new features and fixes on focused branches (use `codex/` for agent branches) and open pull requests targeting `main`. Shared checks run on pull requests; native builds and packaging only run from `main`. Successful main CI runs automatically sign, notarize, verify, and publish new versions through `.github/workflows/release.yml`; that verified publication flow is authorized. Do not publish releases or create public tags outside that flow, or publish packages, without an explicit user request. Keep signing credentials in encrypted Actions secrets and temporary runner keychains; never commit or log them.

## Interface rules
- Omit ornamental eyebrow headings, redundant subheadings, explanatory helper paragraphs, instructional status lines, selection-state captions, drawing-count badges, storage statistics, technical media metadata, roadmap disclaimers, and permanence/autosave reassurance copy.
- Prefer concise control labels and visible interaction states. Show errors and progress only when they help the user act or understand an operation that is still running.
- Preserve the simple review workflow. Do not add unsolicited product explanations, tutorials, promotional copy, or extra sections.

Verify native behavior and inspect screenshots in both themes before calling UI work complete. Keep demo footage and local verification screenshots out of the public repository.

Commit completed work in logical checkpoints on the working branch.
