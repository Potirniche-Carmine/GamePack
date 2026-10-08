# Hosted builds and release packages

GitHub Actions builds the project on standard hosted runners. This repository is
public; GitHub documents standard hosted runner use as free and unlimited for
public repositories. These workflows do not use larger paid runners or self-hosted
machines. [GitHub hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

| Package | Standard runner | Contents |
| --- | --- | --- |
| `GamePack-macos-arm64.tar.gz` | `macos-15` | Apple silicon desktop app and `Install.command` |
| `GamePack-macos-x64.tar.gz` | `macos-15-intel` | Intel desktop app and `Install.command` |
| `GamePack-windows-x64.zip` | `windows-2022` | Windows desktop app package and installation instructions |
| `GamePack-windows-arm64.zip` | `windows-2022` | ARM64 Windows desktop package, cross-compiled on x64 |

The Mac runners build each architecture natively; neither package is a universal
binary. macOS requires version 14 or later. React Native desktop hosts target
macOS and Windows.

The standard Apple silicon runner has three CPU cores and 7 GB of memory; the
standard Intel runner has four CPU cores and 14 GB. Native compilation uses three
and four workers respectively, matching those CPU counts without larger runners.
[Runner resource specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

`macos.yml` and `windows.yml` run on pushes to `main`, pull requests, manual
dispatches, and reusable workflow calls. Rust formatting, contract tests, and
Clippy run before packaging. Shared TypeScript types are checked; desktop packages
embed JavaScript and the Rust static library. CI uploads downloadable `release-*`
artifacts for seven days. Failed Mac builds retain compiler logs separately.
CocoaPods verifies the locked dependency graph, versions, and sources after
installation; only evaluated local podspec checksums may vary by runner tooling.
JavaScript source packages remain pinned by npm's integrity-checked lockfile.

Pushing a version tag such as `v0.1.3` starts `release.yml`. A fast Windows PowerShell 5 protocol check must pass first. It then calls both platform
workflows against that tag, waits for all packages, downloads only `release-*`
artifacts, and verifies their SHA-256 checksums before publishing a GitHub release.
The publisher uses the workflow's built-in `GITHUB_TOKEN` with `contents: write`;
build jobs have read-only repository access. No personal access token or signing
secret is required. A manual release dispatch must select an existing `v*` tag;
dispatches against branches do not publish. GitHub supports calling repository
workflows through `workflow_call`. [Reusable workflow documentation](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)

Mac packages carry an ad hoc signature and are not notarized. Windows packages are
unsigned and include installation guidance. A hosted build verifies compilation,
Rust contracts, bundling, and package production; interactive playback and gesture
behavior still need native application testing.

For a focused Windows transport check, manually dispatch `windows.yml` with `contract_only: true`. This builds the Rust CLI and tests the native JSON payloads without compiling either desktop UI.
