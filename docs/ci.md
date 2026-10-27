# CI and releases

Pull requests target `main`. Keep feature and fix branches focused; agent branches use `codex/`. Merge after **CI required** passes. That aggregate check fails if any shared check fails or is cancelled, and remains present on documentation-only PRs. `main` requires pull requests, an up-to-date passing `CI required` check from GitHub Actions, and resolved conversations. Force pushes and deletion are disabled. A second reviewer is optional for solo maintenance; repository administrators retain their emergency bypass.

## Checks and native builds

The `CI` workflow runs on pull requests, pushes to `main`, and manual dispatches. It checks TypeScript, UI behavior, matching package versions, Rust formatting/tests/Clippy on Linux and Windows, Windows PowerShell transport and updater rollback fixtures, release/version and installer regression tests, native geometry/update contracts, and workflow syntax with actionlint.

On `main`, a small change-selection job starts macOS ARM64/Intel and Windows ARM64/x64 in parallel with shared checks. Release preparation still requires the entire source CI run to succeed, including every shared and native job. Each platform validates its packaged app against the updater. macOS runs updater failure/rollback tests before compiling, then verifies the final package, mounts the DMG, compares its signed app with the update archive, and installs/reinstalls it into an isolated library without launching it. Documentation/test-only pushes skip native packages. Manually dispatch `CI` on `main` to build all four packages regardless of changed paths. CI runs finish independently so delayed events and retries cannot cancel a newer commit's running or pending checks. Several commits can therefore build at once. PRs never run packaging or release jobs.

## Caches

| Dependency or output | Cache and invalidation |
| --- | --- |
| npm downloads | setup-node, keyed by OS, architecture, and `package-lock.json`; `npm ci` always recreates the installation. |
| Rust registry, Git dependencies, compiled dependencies | rust-cache, separated by platform/job/target, Cargo manifests, lockfile, compiler and build environment; PRs restore without saving. |
| Ruby gems | setup-ruby Bundler cache with `Gemfile.lock`, Ruby version, OS and architecture. |
| CocoaPods and downloaded pod sources | OS/architecture, Xcode, npm lockfile, Gemfile lockfile and Podfile/lock; `pod install` always reconciles the restored cache and verifies the dependency graph. |
| macOS C/C++ compilation | ccache through Xcode's C/C++ compiler launchers; 500 MB per architecture, keyed by Xcode/dependencies/commit with dependency-matched fallback. Statistics appear in each build. |
| Xcode intermediates and module cache | Architecture, Xcode, dependency fingerprint, build script and commit, with a matching-dependency fallback; Xcode reconciles source changes on every build. |
| Windows NuGet packages | OS, target architecture, npm lockfile, native projects, props and NuGet configuration; MSBuild always restores and resolves dependencies. |

Caches are disposable accelerators; a cold run must still build successfully. Xcode reuses valid intermediate outputs; final apps are staged, signed and verified on every run, and `npm ci` recreates JavaScript installations. The Mac dependency fingerprint includes the complete npm dependency graph, Gemfile lock, Podfile and Podfile lock, omitting only the app's own npm version so patch releases retain their dependency caches. npm/Rust use their checked-in locks. Rust is pinned in `rust-toolchain.toml`, Node in `.node-version`, and CocoaPods in `Gemfile.lock`. CI selects Xcode 26.3 for the macOS 26 SDK needed by the existing glass views while retaining the macOS 14 deployment target. Third-party workflow actions use immutable commit revisions. Update the pins and their version comments together.

Packages are retained for 14 days. Compressed archives upload without redundant compression. Compiler diagnostics upload on failure and expire after 7 days. The first run populates caches; compare later runs before claiming a speed improvement.

## Prepare a release

1. Run `npm run version:prepare -- 1.2.3` with the intended stable version. It updates npm, Rust, macOS, and Windows versions together, including the compiled Windows version used by update checks. It does not commit, tag, or publish. Run `npm run check:version` and `npm run test:release`.
2. Add `docs/releases/<version>.md` with the release notes and installation requirements. Add a matching entry at the top of `CHANGELOG.md`, with concise patch notes and a link to the detailed version notes.
3. Merge into `main` and wait for a successful `CI` run containing all four native packages. Exercise the native app on the platforms being released; CI package checks do not verify interactive playback or visual behavior.
4. On the Mac containing the Developer ID certificate and notarization profile, run the signed preparation command below with that exact commit's CI run.
5. Review the draft's notes and six assets: two Mac DMGs, two Mac app-only archives for existing automatic updaters, and two Windows ZIPs. Checksums stay in CI/local staging; GitHub's asset digests verify published downloads. Publishing remains a separate, explicit maintainer action. A draft is not offered by the app's update checker.

```bash
npm run release:prepare -- --ci-run 123456789 \
  --sign-identity YOUR_40_CHARACTER_CERTIFICATE_SHA1 \
  --notary-profile GamePack-DeveloperID
```

The command verifies the CI workflow identity, event, branch, commit, success, versions and checksums. It downloads all four CI packages, signs both Mac architectures locally, submits them to Apple, staples their notarization tickets, and verifies Gatekeeper acceptance before creating the draft. Windows archives remain byte-for-byte identical to CI. It does not rebuild the native apps, export your private key, or put credentials in GitHub. Install PowerShell 7 on the release Mac for Windows package validation; use `--powershell /absolute/path/to/pwsh` if needed.

The checkout must be clean and match current `main`. Preparation can refresh a draft for the same commit, but refuses to replace a published release or a draft targeting another commit. If artifacts have expired or `main` moved, obtain a successful complete CI run for the new commit. Publishing remains a separate action.

The **Prepare draft release** GitHub workflow is also available for inspecting unnotarized CI packages. It verifies all six payloads and their checksums, then copies only the six payloads into a draft without local signing. It must not overwrite a locally signed draft. Use the local command for the signed release intended for users. Main CI creates packages but never automatically creates or publishes a release; a failed native job prevents release preparation.

### Signing setup

Use a valid **Developer ID Application** certificate with its private key in the Mac's Keychain. An existing certificate and Apple notarization credentials for the same developer team can serve multiple apps. `security find-identity -v -p codesigning` lists available identities. Create a local profile with `xcrun notarytool store-credentials GamePack-DeveloperID` and follow its secure prompts, or use its API-key options. Keep passwords, private keys, and credential files out of the repository.

For a local signed build, set `GAMEPACK_MACOS_SIGN_IDENTITY` when running `npm run build`. Packaging accepts the same variable and `GAMEPACK_NOTARY_PROFILE`; notarization is explicit and uploads the app to Apple. The packaging scripts sign nested code, the update helper, and the app with hardened runtime and timestamps, then staple Apple's ticket before creating the final archive and checksum. A signing or notarization failure stops preparation; it never falls back to ad-hoc signing.

CI artifacts and draft releases are not app updates. Settings checks only GitHub's latest published stable release, and offers it only when its version is newer than the installed app. Keep published releases as download history. When replacing a stale draft, first preserve its notes, source commit, and assets; prepare the replacement from verified CI before removing the superseded draft. Do not reuse or move a published version tag.

Ordinary CI and development Mac builds use ad-hoc signing. Locally prepared distribution packages use Developer ID signing and Apple notarization. Windows layouts remain unsigned and require Developer Mode.

The Windows updater runs only the trusted helper bundled with the installed app. It checks PowerShell policy first and respects explicit restrictions. When all five policy scopes are unset, it uses `Bypass` for that helper process only, as documented for embedded application scripts; it never changes saved policy, Developer Mode, AppLocker, or WDAC. A blocked helper leaves GamePack open. macOS retains download quarantine and uses the normal LaunchServices opening path. It preserves the previous app if operating-system approval prevents the replacement from starting.

## Validate an update

Mac users install `GamePack-macos-{arm64,x64}.dmg` by dragging GamePack into Applications. The disk image contains only the app and an Applications shortcut. Automatic updates support writable `/Applications/GamePack.app`, `~/Applications/GamePack.app`, and the existing `GAMEPACK_HOME/app/GamePack.app` location. App data and configuration remain in `GAMEPACK_HOME` or `~/.gamepack`.

The update payload names remain `GamePack-macos-{arm64,x64}.tar.gz` and `GamePack-windows-{arm64,x64}.zip` for compatibility with installed releases. Mac update archives contain only the app. Each CI payload has a `.sha256` file for pipeline verification, but release preparation uploads only the payloads. Existing update checkers already accept GitHub's asset digest without a checksum attachment. The packaged app version must match `package.json`; packaging rejects a different app version.

Before preparing a draft:

1. Confirm the exact `main` commit has a successful complete `CI` run with all four native jobs and `release-*` artifacts. A successful documentation-only run is insufficient. If needed, dispatch `CI` on `main` manually.
2. Download the matching artifact and verify its SHA-256 checksum. Use a temporary absolute `GAMEPACK_HOME` for native checks. Install an older supported version there, import a small clip, create a project/comment/drawing/draft, and change a setting. Quit the app and copy the library before testing the upgrade.
3. On Mac, mount the DMG and drag the app into Applications. For an isolated managed-installation check, run `GAMEPACK_HOME=/absolute/test/root bash scripts/macos/install-app.sh /Volumes/GamePack/GamePack.app --no-launch` from the source checkout. On Windows, extract the ZIP and run its installer with the same `GAMEPACK_HOME`. Confirm the new version, existing project/media/comments/drawings/drafts/settings, and playback. Inspect both themes. Reinstall the same version and check the library again. Do not run an older app against the upgraded library; restore the backup for another older-version test.
4. Exercise Settings with newer, equal, and older release cases. The checker must select the operating system and hardware architecture and ignore drafts/prereleases. **Update** must verify and stage the package without interrupting review; **Restart to update** must save pending work before handing installation to the bundled helper. Verify library preservation, failure recovery, reopening Settings during preparation, and installation from the normal managed location. Use isolated fixtures before publishing; never publish a test release just to exercise the updater.

`npm run test:release` covers version synchronization and macOS installer replacement/rollback/data preservation using isolated filesystem fixtures. Shared UI and native contract tests cover release selection and URL construction. These checks supplement installation and playback on real macOS/Windows hosts; report the tested OS and architecture.
