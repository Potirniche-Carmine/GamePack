# Hosted builds and release packages

All build and release workflows are currently disabled during rapid development. There are no push, pull-request, or tag triggers. Every job has a literal false guard and a `refs/heads/main` check, including manually dispatched and reusable workflows. Releases, tags, publication, and re-enabling automation require an explicit user request.

The retained workflow definitions use standard hosted runners when authorized to run. This repository is
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

`macos.yml` and `windows.yml` retain manual and reusable entry points, but their jobs cannot run until the hard-off guard is deliberately changed. `release.yml` is manual-only, restricted to `main`, and requires an explicit existing version tag matching that main commit. Its jobs are also hard-disabled. Dispatching a workflow does not override these guards.

Local source builds and tests remain available while automation is paused. No release was created for the settings and review UI changes.

Mac packages carry an ad hoc signature and are not notarized. Windows packages are
unsigned and include installation guidance. A hosted build verifies compilation,
Rust contracts, bundling, and package production; interactive playback and gesture
behavior still need native application testing.

Run `scripts/windows/test-contract.ps1` locally on Windows for the transport fixtures while hosted jobs are disabled.

Release verification: [v0.1.3 workflow run 37848971586](https://github.com/Potirniche-Carmine/GamePack/actions/runs/37848971586) passed the Windows protocol preflight, all four native build/package jobs, and the final checksum/publication job. The [published v0.1.3 release](https://github.com/Potirniche-Carmine/GamePack/releases/tag/v0.1.3) contains all four architecture-specific archives and their four SHA-256 files. macOS jobs also verified the executable architecture, embedded JavaScript, and strict application signatures before packaging.
