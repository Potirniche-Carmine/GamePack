# Development

[← GamePack](../README.md) · [Contributing](../CONTRIBUTING.md)

GamePack uses a shared React Native interface, native desktop media players, and a Rust/SQLite engine connected through CXX. Work from `main`. Build and release automation is paused; run checks locally.

## macOS

Requires macOS 14 or later and Xcode installed and opened once. The build uses Node 20.19.4 or newer, Rust, and CocoaPods. The bootstrap script installs missing tools through Homebrew and rustup, then installs JavaScript and CocoaPods dependencies.

```sh
git clone https://github.com/Potirniche-Carmine/GamePack.git
cd GamePack
git switch main
bash scripts/bootstrap-macos.sh
bash scripts/install-macos.sh
```

The installer builds `dist/GamePack.app` if it does not already exist, copies it to `~/.gamepack/app/GamePack.app`, creates `~/.gamepack/Launch GamePack.command`, and opens the app. The build targets the current Mac's architecture: Apple silicon or Intel.

### Rebuild after a change

The installer reuses an existing `dist/GamePack.app`. Build explicitly before reinstalling an updated checkout:

```sh
bash scripts/build-macos.sh
bash scripts/install-macos.sh
```

The build embeds production JavaScript and the Rust engine. The installed app does not need Node, Cargo, CocoaPods, Metro, or an open terminal. Source builds are ad-hoc signed and are not notarized.

`npm start` and `npm run macos` are available for React Native development. They are not required to launch an installed build.

## Windows

The native Windows host and scripts target Windows 10 version 2004 or later, including Windows 11, on x64 or ARM64. Windows behavior must be built and verified on Windows; a passing macOS build does not establish parity.

Clone the repository and check out `main`. In an **elevated PowerShell terminal**, from the repository root, run:

```powershell
.\scripts\windows\bootstrap.ps1 -EnableDeveloperMode
```

The script needs `winget` from Microsoft's App Installer. It installs Node LTS, Rust, and Visual Studio 2022 Build Tools with C++, UWP, ARM64 tools, and the Windows SDK. The flag enables Developer Mode, which is required to register the unsigned development package. You can instead enable Developer Mode in Windows Settings and omit the flag.

Open a new PowerShell terminal so the installed tools are on `PATH`, return to the repository root, and build and install:

```powershell
.\scripts\windows\build.ps1 -Architecture x64
.\scripts\windows\install.ps1 -Architecture x64 -Launch
```

On Windows ARM64, use `-Architecture arm64` in both commands. The installer copies the native package under the library root, registers it with Windows, and launches it when `-Launch` is supplied. Repeat the build and install commands after source changes.

## Choose a library location

Use an absolute path for `GAMEPACK_HOME`. By default, GamePack uses `~/.gamepack` on macOS and `%USERPROFILE%\.gamepack` on Windows.

On macOS:

```sh
GAMEPACK_HOME="$HOME/GamePack" bash scripts/install-macos.sh
```

Use the generated `Launch GamePack.command` in that folder for later launches so the same root is passed to the app.

On Windows, set the environment variable before installing:

```powershell
$env:GAMEPACK_HOME = Join-Path $env:USERPROFILE 'GamePack'
.\scripts\windows\install.ps1 -Architecture x64 -Launch
```

The Windows installer records the root alongside the installed executable. App-owned SQLite data, profile, settings, managed media, drafts, cache, and temporary files stay under the configured root. OS frameworks may also maintain their usual system caches and preferences.

Close the app before backing up the library. ZIP exchange is not implemented, and the pre-MVP storage format may change.

## Checks

Install dependencies, then run the shared interface and engine checks:

```sh
npm ci
npm run typecheck
npm run test:ui
cargo fmt --all --check
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
```

Build the relevant native host after changes to its integration. Use the commands above for your platform. The macOS build script also runs TypeScript and UI tests; the Windows build script runs shared tests and its PowerShell protocol fixtures by default.

For native UI verification, exercise import, playback, Watch/Review switching, frame stepping, posting and restoring drafts, replies, zoom, fullscreen, and settings. Inspect light and dark themes. Keep footage and verification screenshots in ignored `artifacts/local/`, and report which OS and architecture you actually tested.

## Codebase map

| Location | Responsibility |
| :--- | :--- |
| [`packages/app/src`](../packages/app/src) | Shared React Native UI, interaction logic, themes, and typed native contract. |
| [`native/macos`](../native/macos) | AVPlayer, drawing overlay, file picker, and CXX module. |
| [`macos`](../macos) | Xcode project and macOS application host. |
| [`apps/windows`](../apps/windows) | React Native Windows host, MediaPlayer integration, and package project. |
| [`crates/gamepack-core`](../crates/gamepack-core) | Domain validation, records, SQLite, media identity, migrations, and CLI. |
| [`tests`](../tests) | Shared interface logic tests. |
| [`schemas`](../schemas) | Record schemas and validation fixtures. |
| [`scripts`](../scripts) | Local setup, builds, installation, and packaging tools. |

Media imports use incremental hashing and verified copies, deduplicated by BLAKE3 and byte length. SQLite uses WAL and `synchronous=FULL`; posting writes the comment and its drawings atomically with draft status. Retries use the draft's stable ID.

The [implementation plan](../GamePack-Implementation-Plan-v3.md) records historical design and future directions. Read the current source and [review guide](reviewing.md) for implemented behavior.
