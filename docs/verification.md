# MVP verification

Verified on October 8, 2026. The local UI run uses the installed Release app on Apple silicon, native AVPlayer, the production JavaScript bundle, and the real Rust/SQLite engine. It does not use a browser mock, Metro server, or seeded comment fixture.

## Local macOS results

The demo MP4 from Downloads was imported through the native file picker. It is 1920 × 1080, approximately 30 seconds, and 17,839,845 bytes. The source and managed copy both have SHA-256 `d6617a009c0c6c9aebf7398d43cad6d1985ddc1b9ab0479e2ea977362b8af5b0`. The original was not modified. Footage and screenshots remain local and are excluded from this public repository.

| Check | Observed result |
| --- | --- |
| Native installation | Release ARM64 app runs from `~/.gamepack/app/GamePack.app`; deep ad-hoc signature verification passes |
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
| Final restart | Video, profile, four posted comments, parent reply relation, theme, and all drawings survive restart |
| Storage integrity | SQLite `integrity_check` returns `ok`; schema version 2, one video, four comments, zero remaining drafts |
| Deferred ZIP | Both buttons remain visible and disabled |

Evidence is saved under `artifacts/local/screenshots/`. Screenshots `01`–`10` cover the initial import, drawing tools, isolated review, seeking, restart, and hosted-package installation. The final interface is covered by `11-light-threaded.png`, `12-light-raw-video.png`, `13-dark-overlays.png`, `14-live-capture.png`, `15-comment-prompt.png`, `16-saved-live-clip.png`, `17-normal-playback-later.png`, `18-compact-dark.png`, and `19-restart-live-clip.png`.

## Automated verification

`npm run typecheck`, Rust formatting, and Clippy with warnings denied pass locally. Fourteen Rust integration tests run on macOS; thirteen run on Windows because the symlink fixture uses Unix-only APIs. These cover persistence and appearance migration, media deduplication and tamper detection, atomic publication and retry idempotency, concurrent publication, transaction rollback, immutable snapshots, reply boundaries, drawing validation, strict JSON validation, deterministic seek evaluation, metadata updates, and filesystem symlink containment. Nineteen UI-domain tests cover aggregate playback, consistent review colors, exclusive ends, EOF moments, native capture boundaries, live draft recovery and navigation, final-stroke deduplication, large stroke data, and nested/cyclic/orphaned reply trees. The macOS native Release build and package script pass locally. Windows CI also runs JSON payload regression fixtures against the compiled Rust CLI, checks the app/runtime PE machine codes, and verifies that declared Microsoft framework dependencies are bundled.

Hosted macOS ARM64/x64 and Windows ARM64/x64 builds are tracked in [GitHub Actions](https://github.com/Potirniche-Carmine/GamePack/actions). The release workflow requires all four packages and checksums before publishing. A successful build establishes compilation and packaging; Windows playback, pointer interaction, and visual correctness still require an interactive Windows device check. They are not established by the Mac screenshots.

## Practical limits

This is an offline MVP, with no ZIP exchange, mobile targets, Linux target, live sync, or automatic update service. macOS packages are ad-hoc signed and not notarized; Windows packages are unsigned and use development-package registration. Installation documentation explains the relevant OS prompts.

The UI and media engines use source media time, stored as integer microseconds. That storage precision is not a claim of microsecond playback accuracy: frames, input sampling, media decoding, and display refresh have their normal platform limits. Native moment overlays allow a 2 ms match tolerance around a seek; interval ends are exclusive.

The React Native 0.81 desktop dependencies are deliberately aligned between macOS and Windows. npm audit still reports transitive advisories in that dependency tree; the full audit is retained locally at `artifacts/local/npm-audit.json`. Dependency upgrades need coordinated native compatibility work. Release operation needs no development server.
