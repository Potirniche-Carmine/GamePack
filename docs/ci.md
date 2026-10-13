# CI and releases

Pull requests target `main`. Keep feature and fix branches focused; agent branches use `codex/`. Merge after **CI required** passes. That aggregate check fails if any shared check fails or is cancelled, and remains present on documentation-only PRs. `main` requires pull requests, an up-to-date passing `CI required` check from GitHub Actions, and resolved conversations. Force pushes and deletion are disabled. A second reviewer is optional for solo maintenance; repository administrators retain their emergency bypass.

## Checks and native builds

The `CI` workflow runs on pull requests, pushes to `main`, and manual dispatches. It checks TypeScript, UI behavior, matching package versions, Rust formatting/tests/Clippy on Linux and Windows, Windows PowerShell transport fixtures, and workflow syntax with actionlint.

After shared checks pass, `main` builds macOS ARM64/Intel and Windows ARM64/x64 in parallel. macOS also runs its Rust tests. Documentation/test-only pushes skip native packages. Manually dispatch `CI` on `main` to build all four packages regardless of changed paths. A newer commit cancels obsolete CI runs. PRs never run packaging or release jobs.

## Caches

| Dependency or output | Cache and invalidation |
| --- | --- |
| npm downloads | setup-node, keyed by OS, architecture, and `package-lock.json`; `npm ci` always recreates the installation. |
| Rust registry, Git dependencies, compiled dependencies | rust-cache, separated by platform/job/target, Cargo manifests, lockfile, compiler and build environment; PRs restore without saving. |
| Ruby gems | setup-ruby Bundler cache with `Gemfile.lock`, Ruby version, OS and architecture. |
| CocoaPods and downloaded pod sources | OS/architecture, Xcode, npm lockfile, Gemfile lockfile and Podfile/lock; `pod install` always reconciles the restored cache and verifies the dependency graph. |
| macOS C/C++ compilation | ccache through Xcode's C/C++ compiler launchers; 500 MB per architecture, keyed by Xcode/dependencies/commit with dependency-matched fallback. Statistics appear in each build. |
| Windows NuGet packages | OS, target architecture, npm lockfile, native projects, props and NuGet configuration; MSBuild always restores and resolves dependencies. |

Caches are disposable accelerators; a cold run must still build successfully. Native outputs, signed applications, and JavaScript installations are rebuilt. npm/Rust use their checked-in locks. Rust is pinned in `rust-toolchain.toml`, Node in `.node-version`, and CocoaPods in `Gemfile.lock`. CI selects Xcode 26.3 for the macOS 26 SDK needed by the existing glass views while retaining the macOS 14 deployment target. Third-party workflow actions use immutable commit revisions. Update the pins and their version comments together.

Packages are retained for 14 days. Compressed archives upload without redundant compression. Compiler diagnostics upload on failure and expire after 7 days. The first run populates caches; compare later runs before claiming a speed improvement.

## Prepare a release

1. Update `package.json`, the npm lockfile, the Rust crate and Cargo lockfile, the macOS plist, and the Windows manifest to the same version (Windows adds `.0`). Run `npm run check:version`.
2. Add `docs/releases/<version>.md` with the release notes and installation requirements.
3. Merge into `main` and wait for a successful `CI` run containing all four native packages. Exercise the native app on the platforms being released; CI package checks do not verify interactive playback or visual behavior.
4. Dispatch **Prepare draft release** on `main`, with `version_tag` (for example `v1.0.0`) and `ci_run_id` from that exact commit's CI run.
5. Review the draft's notes and eight assets (four archives and four checksums). Publishing remains a separate, explicit maintainer action.

The draft workflow verifies the CI workflow identity, event, branch, commit, success, versions and checksums. It reuses the existing packages instead of rebuilding them. It can refresh a draft for the same commit, but refuses to replace a published release or a draft targeting another commit. If artifacts have expired or the checkout moved, dispatch CI again for the intended `main` commit. It does not trigger on tags and never automatically publishes a release.

Downloads currently use ad hoc macOS signing (no notarization) and unsigned Windows layouts requiring Developer Mode. Signing and store distribution are separate work.
