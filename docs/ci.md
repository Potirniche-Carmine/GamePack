# CI and releases

Pull requests target `main`. Keep feature and fix branches focused; agent branches use `codex/`. Merge after **CI required** passes. That aggregate check fails if any shared check fails or is cancelled, and remains present on documentation-only PRs. `main` requires pull requests, an up-to-date passing `CI required` check from GitHub Actions, and resolved conversations. Force pushes and deletion are disabled. A second reviewer is optional for solo maintenance; repository administrators retain their emergency bypass.

## Checks and native builds

The `CI` workflow runs on pull requests, pushes to `main`, and manual dispatches. It checks TypeScript, UI behavior, matching package versions, Rust formatting/tests/Clippy on Linux and Windows, Windows PowerShell transport fixtures, release/version and installer regression tests, native geometry/update contracts, and workflow syntax with actionlint.

After shared checks pass, `main` builds macOS ARM64/Intel and Windows ARM64/x64 in parallel. macOS also runs its Rust tests and installs/reinstalls each packaged app into an isolated library without launching it. Documentation/test-only pushes skip native packages. Manually dispatch `CI` on `main` to build all four packages regardless of changed paths. CI runs finish independently so delayed events and retries cannot cancel a newer commit's running or pending checks. Several commits can therefore build at once. PRs never run packaging or release jobs.

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

1. Run `npm run version:prepare -- 1.2.3` with the intended stable version. It updates npm, Rust, macOS, and Windows versions together, including the compiled Windows version used by update checks. It does not commit, tag, or publish. Run `npm run check:version` and `npm run test:release`.
2. Add `docs/releases/<version>.md` with the release notes and installation requirements.
3. Merge into `main` and wait for a successful `CI` run containing all four native packages. Exercise the native app on the platforms being released; CI package checks do not verify interactive playback or visual behavior.
4. Dispatch **Prepare draft release** on `main`, with `version_tag` (for example `v1.0.0`) and `ci_run_id` from that exact commit's CI run.
5. Review the draft's notes and eight assets (four archives and four checksums). Publishing remains a separate, explicit maintainer action. A draft is not offered by the app's update checker.

The draft workflow verifies the CI workflow identity, event, branch, commit, success, versions and checksums. It reuses the existing packages instead of rebuilding them. It can refresh a draft for the same commit, but refuses to replace a published release or a draft targeting another commit. If artifacts have expired or the checkout moved, dispatch CI again for the intended `main` commit. It does not trigger on tags and never automatically publishes a release.

Downloads currently use ad hoc macOS signing (no notarization) and unsigned Windows layouts requiring Developer Mode. Signing and store distribution are separate work.

## Validate an update

The release names are part of the updater contract: `GamePack-macos-{arm64,x64}.tar.gz` and `GamePack-windows-{arm64,x64}.zip`, each accompanied by `.sha256`. Keep them stable. The packaged app version must match `package.json`; packaging rejects a different app version.

Before preparing a draft:

1. Confirm the exact `main` commit has a successful complete `CI` run with all four native jobs and `release-*` artifacts. A successful documentation-only run is insufficient. If needed, dispatch `CI` on `main` manually.
2. Download the matching artifact and verify its SHA-256 checksum. Use a temporary absolute `GAMEPACK_HOME` for native checks. Install an older supported version there, import a small clip, create a project/comment/drawing/draft, and change a setting. Quit the app and copy the library before testing the upgrade.
3. Extract the new package and run its installer with the same `GAMEPACK_HOME`. Confirm the new version, existing project/media/comments/drawings/drafts/settings, and playback. Inspect both themes. Reinstall the same version and check the library again. Do not run an older app against the upgraded library; restore the backup for another older-version test.
4. Exercise the Settings update check with the current published release. The checker must select the operating system and hardware architecture, ignore drafts/prereleases and older versions, and open the matching download only on request. Automated fixtures cover newer, equal, and older release versions plus malformed or unavailable releases; no published test release is needed.

`npm run test:release` covers version synchronization and macOS installer replacement/rollback/data preservation using isolated filesystem fixtures. Shared UI and native contract tests cover release selection and URL construction. These checks supplement installation and playback on real macOS/Windows hosts; report the tested OS and architecture.
