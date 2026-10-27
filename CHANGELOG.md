# Changelog

## [1.0.4](docs/releases/1.0.4.md)

- Selecting a moment or one of its replies jumps to the beginning of the moment.
- Mac downloads use a disk image: drag GamePack into Applications to install it.
- Automatic updates support Applications and existing GamePack data-folder installations.
- Release downloads omit separate checksum files while retaining automatic verification.
- Fixed the updater test race that blocked Mac packages, and improved CI parallelism and caching.

## [1.0.3](docs/releases/1.0.3.md)

- Drawing tools pause on the current video frame without rewinding to an older playback position.
- Switching drawing tools preserves the paused frame.
- The timeline playhead moves continuously during playback, settles on pause, and stays visible in both themes.
- Moment and Play use distinct icons in a compact control below the pointer.
- Settings groups drawing modes and the default Play speed under Moments.

## [1.0.2](docs/releases/1.0.2.md)

- Stabilized drawing tools and update controls as their state changes.
- Improved playback shortcuts, tool hints, and spacing in comment cards.
- Posting preserves the comment card, video frame, and playhead position.
- Timed annotations support seeking without changing existing stroke timing.
- Added playback speeds from 0.25× to 4× and a configurable default speed for timed drawing.
- Clarified individual moment positions and grouped timeline markers.

## [1.0.1](docs/releases/1.0.1.md)

- Added Moment annotations for a single frame and Play annotations spanning several seconds.
- Timed drawings replay at their original positions within a conversation.
- Replies share their conversation's time range; drafts support resume, undo/redo, and frame stepping.
- Added verified in-app update downloads and installation, with pending work saved before restarting.

## [1.0.0](docs/releases/1.0.0.md)

- Introduced offline video review on macOS and Windows, for ARM64 and x64.
- Organize footage into projects, annotate frames, and discuss them with comments and replies.
- Review mode pauses at commented frames.
- Libraries and configuration stay in `GAMEPACK_HOME` or the default `.gamepack` folder.
