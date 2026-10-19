# Reviewing video

[← GamePack](../README.md) · [Build from source](development.md)

## Library

Choose **New project**, open it, then **Add video**. Projects can hold videos directly or group them into one level of folders. Search applies to the current location.

The breadcrumb returns to a project or folder. The GamePack mark opens all projects, and the video title opens the video list for the current folder. Item menus let you rename projects and folders, move videos within their project, or delete items. Removing a folder returns its videos to the project without changing their comments.

Imported footage is copied into GamePack's managed library. Original files are read-only. Deleting a project or video removes its comments and drafts after confirmation, but retains the original and managed media; this does not reclaim storage space.

## Watch and Review

Click empty video space with the pointer selected, or press **Space**, to play or pause.

- **Watch** plays continuously and hides drawings, comments, review shortcuts, and comment markers.
- **Review** stops at Moment comments and at the end of Play comments, then waits for Play. Conversations ending on the same frame share a stop. Seeking backward lets you review those moments again.

Press **R** to switch modes. Use **← / →** to step frames, **Shift + ← / →** to seek five seconds, or **J / K / L** to shuttle backward, stop, and shuttle forward.

## Draw and post

In Review, choose **Pen**, **Arrow**, or **Ellipse** to start a comment on a frozen frame. **Moment** is the default. All marks use the same blue ink.

For one conversation over several seconds, switch **Moment** to **Play**, choose a drawing tool, and press **Space** or the playback button. Switching modes alone does not start the video. Draw as the video progresses; pause to add details or text, then resume to continue the same play. The speed control offers **0.5×** for slower capture. Your previous speed returns when you leave the draft. The timestamp and blue filmstrip range show the covered time.

Play drawings replay in source time, including strokes drawn while paused. Scrub backward within the draft to revisit an earlier frame without losing later marks. The play retains its furthest captured endpoint; seeking earlier or undoing a stroke does not shorten it. A reply stays inside its original conversation's window.

Add text and choose **Post**, or press **Command/Control + Enter**. Set your display name when prompted. New conversations require at least one drawing; replies can contain only text. The laser pointer (**B**) is temporary and is not posted.

Posted comments cannot be edited or individually deleted. Deleting their video or project removes them along with associated drafts.

## Drafts

Leaving a conversation saves its draft. Playing or seeking away from a Moment keeps its original timestamp; playback and seeking within a Play continue that draft. **Discard** removes the active draft and its drawings; **Post** publishes them after the native player pauses and finishes any held stroke.

**Resume** in the drawing tools reopens the most recent unfinished new conversation for the current video. Choose **Reply** again to restore a saved reply. Play drafts reopen paused at their end. The active Play draft appears as a filmstrip range.

Use **Command/Control + Z** and **Command/Control + Shift + Z** to undo and redo unposted drawings.

## Conversations

Moment drawings and conversations appear together once the video has paused on their frame. Play conversations appear throughout their window while the strokes reveal in time. Select a Play card or marker to read it at its final frame; choose **Replay** to watch from its beginning. Replay still stops at any Moment comments along the way and holds the play’s final frame. Comments stay on the right; selecting a card emphasizes its drawings. Frames with multiple conversations number those cards from 1. A lone conversation has no number. Filmstrip markers show a dot for one comment and a count for grouped comments.

Choose **Reply** to open a composer on the same moment or play. Play replies initially open at the final frame; scrub within the range to attach new strokes earlier. Replies remain nested in the conversation. Expand or collapse them with the reply control, or use **Command/Control + Shift + R** for all replies. Scroll the right-hand column for more comments.

## Zoom and fullscreen

At **Fit**, the entire video frame fits the workspace without cropping. Use the Fit/percentage control, mouse wheel, or trackpad pinch to zoom. Wheel and pinch gestures zoom around the point under the cursor. Footage and drawings scale together while comment cards keep their position and size. Fit resets the view. Playback speed has its own control.

Press **F** for fullscreen. In fullscreen Review, **↑ / ↓** or **Page Up / Page Down** moves between original comments. Press **Space** to resume playback. **Escape** dismisses a menu, leaves text focus, or exits fullscreen, depending on the current interaction.

## Preferences

Open the settings cog to choose **System**, **Light**, or **Dark** appearance and edit shortcuts. Select a binding and press its replacement. Conflicts and reserved system or text-editing keys are rejected. You can clear a binding or restore defaults.

The profile avatar opens your name and initials settings. Appearance and shortcuts are stored with the library. Existing custom shortcuts take precedence over defaults; see the [default shortcut definitions](../packages/app/src/shortcut-defaults.json) for the complete list. Shortcuts leave text editing alone except for the configured Post shortcut.

Choose **Check for updates** in Settings to look for a newer published release. **Update** prepares the matching package while you continue reviewing; **Restart to update** saves pending work and installs it. Reopen Settings to return to the update. Builds from before the in-app installer need one manual upgrade using the release's included installer.

## Older libraries

Libraries from before the Moment-only format retain their existing one-time conversion: legacy timed comments become completed drawings on the final included instant of their clip, with original records archived for recovery. Existing Moment comments remain unchanged. New Play comments use source-clock sample times. After upgrading, older GamePack versions refuse the newer library format.

Close GamePack before backing up the library folder, especially before trying a new build. ZIP import/export is not available.
