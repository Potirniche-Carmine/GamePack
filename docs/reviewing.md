# Reviewing video

[← GamePack](../README.md) · [Build from source](development.md)

## Library

Choose **New project**, open it, then **Add video**. Projects can hold videos directly or group them into one level of folders. Search applies to the current location.

The breadcrumb returns to a project or folder. The GamePack mark opens all projects, and the video title opens the video list for the current folder. Item menus let you rename projects and folders, move videos within their project, or delete items. Removing a folder returns its videos to the project without changing their comments.

Imported footage is copied into GamePack's managed library. Original files are read-only. Deleting a project or video removes its comments and drafts after confirmation, but retains the original and managed media; this does not reclaim storage space.

## Watch and Review

Click empty video space with the pointer selected, or press **Space**, to play or pause.

- **Watch** plays continuously and hides drawings, comments, review shortcuts, and comment markers.
- **Review** stops at commented frames and waits for Play. Conversations on the same frame share a stop. Seeking backward lets you review those moments again.

Press **R** to switch modes. Use **← / →** to step frames, **Shift + ← / →** to seek five seconds, or **J / K / L** to shuttle backward, stop, and shuttle forward.

## Draw and post

In Review, choose **Pen**, **Arrow**, or **Ellipse** to start a comment on a frozen frame. All marks use the same blue ink. A conversation stores completed drawings at one instant; drawing while footage plays and timed stroke replay are not supported.

Add text and choose **Post**, or press **Command/Control + Enter**. Set your display name when prompted. New conversations require at least one drawing; replies can contain only text. The laser pointer (**B**) is temporary and is not posted.

Posted comments cannot be edited or individually deleted. Deleting their video or project removes them along with associated drafts.

## Drafts

Playing or seeking away saves the current draft at its original timestamp. **Discard** removes the active draft and its drawings; **Post** publishes them.

Draft recovery is incomplete in the current interface. Choosing **Reply** again can restore a saved reply for that comment, but there is no control to reopen an unfinished new conversation after leaving it. Post or discard a new conversation before playing, seeking, or changing videos. Saved drafts do not currently appear as filmstrip markers.

Use **Command/Control + Z** and **Command/Control + Shift + Z** to undo and redo unposted drawings.

## Conversations

Drawings and conversations appear together once the video has paused on their frame. Comments stay on the right; selecting a card emphasizes its drawings. Frames with multiple conversations number those cards from 1. A lone conversation has no number. Filmstrip markers show a dot for one comment and a count for grouped comments.

Choose **Reply** to open a composer at the same frame. Replies remain nested in the conversation. Expand or collapse them with the reply control, or use **Command/Control + Shift + R** for all replies. Scroll the right-hand column for more comments.

## Zoom and fullscreen

At **Fit**, the entire video frame fits the workspace without cropping. Use the Fit/percentage control, mouse wheel, or trackpad pinch to zoom. Wheel and pinch gestures zoom around the point under the cursor. Footage and drawings scale together while comment cards keep their position and size. Fit resets the view. Playback speed has its own control.

Press **F** for fullscreen. In fullscreen Review, **↑ / ↓** or **Page Up / Page Down** moves between original comments. Press **Space** to resume playback. **Escape** dismisses a menu, leaves text focus, or exits fullscreen, depending on the current interaction.

## Preferences

Open the settings cog to choose **System**, **Light**, or **Dark** appearance and edit shortcuts. Select a binding and press its replacement. Conflicts and reserved system or text-editing keys are rejected. You can clear a binding or restore defaults.

The profile avatar opens your name and initials settings. Appearance and shortcuts are stored with the library. Existing custom shortcuts take precedence over defaults; see the [default shortcut definitions](../packages/app/src/shortcut-defaults.json) for the complete list. Shortcuts leave text editing alone except for the configured Post shortcut.

## Older libraries

Legacy timed comments are converted once to a completed drawing on the final included instant of their clip. Original posted records are retained for recovery. New comments use a single frame with no intervals or timed stroke replay.

Close GamePack before backing up the library folder, especially before trying a new build. ZIP import/export is not available.
