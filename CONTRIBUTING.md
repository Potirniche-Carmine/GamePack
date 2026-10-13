# Contributing to GamePack

GamePack is preparing version 1.0.0. Contributions that make the existing offline review flow clearer, more reliable, or easier to build are especially useful.

## Start with the review flow

Create a project, add a video, pause on a frame, draw, post, reply, and play through it in both Watch and Review. The [review guide](docs/reviewing.md) explains the current behavior.

Useful contributions include:

- Reproducing playback, seeking, drawing, or draft-recovery bugs.
- Testing the native Windows app on x64 or ARM64.
- Improving keyboard access, focus behavior, and light/dark readability.
- Fixing build instructions or documenting a reproducible setup problem.
- Making focused improvements to the React Native interface, native players, or Rust engine.

Check [existing issues](https://github.com/Potirniche-Carmine/GamePack/issues) before opening a new one. Discuss larger features there before investing in an implementation so the scope can be agreed on.

## Report a useful bug

Include your OS version and CPU architecture, the commit you built, steps to reproduce, and what you expected versus what happened. For playback problems, include the media format and whether the issue occurs with other files. Share a short log excerpt if it helps.

Only attach footage or screenshots you have permission to share. Remove private paths and information from logs. Keep demo footage and local verification screenshots out of the repository; use the ignored `artifacts/local/` directory for local evidence.

## Make a change

1. Follow the [development guide](docs/development.md) to build the current `main` checkout.
2. Keep the change focused and follow [AGENTS.md](AGENTS.md). Create a focused feature or fix branch from current `main`, then submit a pull request targeting `main` (from a fork for outside contributors).
3. Run the checks relevant to your change. For changes spanning the interface and engine, use the full check list in the development guide.
4. For UI changes, build and exercise the native app and inspect screenshots in **both light and dark themes**. Shared JavaScript tests alone do not verify native playback or appearance. Windows changes need native Windows verification; state clearly when that is still outstanding.
5. Commit in logical checkpoints. In the pull request, explain the problem, the resulting behavior, how you verified it, and any remaining limitations.

Documentation-only changes need accurate commands, working links, and a readable rendered result. They do not require a native rebuild unless they describe a behavior that still needs verification.

## Keep the app simple

- Keep the video and the review interaction central. Use concise control labels and visible interaction states.
- Avoid extra helper copy, status captions, badges, and promotional sections in the app.
- Keep application data and configuration under `GAMEPACK_HOME` or the default `.gamepack` folder.
- Preserve the single-frame drawing model and the immutable posted-comment contract.
- Do not commit footage, databases, build output, credentials, or local verification screenshots.

GitHub Actions runs shared interface, version, Rust, Windows transport, and workflow checks on pull requests. Require the `CI required` check before merging. Native packages are built after changes reach `main`; release preparation reuses those artifacts and creates a draft. Publication requires an explicit maintainer request. See [CI and releases](docs/ci.md).

## License

GamePack is [MIT licensed](LICENSE). Keep third-party license notices with any code or assets you add.
