# Windows source installation

GamePack targets Windows 10 2004 or later, x64 and ARM64. The UI is the shared React Native app, embedded in the installed package. Release builds do not need Metro or another server. The host is a native Win32 window with a Windows XAML island and React Native Windows 0.81.6's Paper renderer; video is Windows MediaPlayerElement with a native Canvas vector overlay.

## Downloadable development package

Windows CI uploads `release-windows-x64` and `release-windows-arm64`, each containing `GamePack-windows-<architecture>.zip` and its SHA-256 checksum. Choose ARM64 for Windows on ARM, or x64 for Intel and AMD PCs. Extract it, enable Windows Developer Mode, then run `powershell.exe -ExecutionPolicy Bypass -File .\install.ps1 -Launch` from the extracted folder. Node, Rust, and Visual Studio are not needed to install this compiled package. The ZIP includes the app layout, embedded JavaScript, Microsoft runtime dependencies, and installer. This is an unsigned development package; a public production package requires a trusted signature.

## Build and install

Install [App Installer](https://apps.microsoft.com/detail/9nblggh4nns1) for `winget`. In an elevated PowerShell terminal, run:

```powershell
.\scripts\windows\bootstrap.ps1 -EnableDeveloperMode
```

This installs Node LTS, Rust/MSVC and Visual Studio 2022 Build Tools with desktop C++, UWP C++ and SDK 10.0.22621.0, including ARM64 cross-compilers. Existing Build Tools installations receive any missing components through an additive Visual Studio Installer modify operation. The optional switch enables Windows Developer Mode for source package registration. If Visual Studio installation requests a restart, complete that first. Open a new PowerShell terminal, then:

```powershell
.\scripts\windows\build.ps1
.\scripts\windows\install.ps1 -Launch
# For Windows on ARM64, cross-build on an x64 Windows machine:
.\scripts\windows\build.ps1 -Architecture arm64
# Copy the ARM64 ZIP to the ARM64 machine and run its included installer.
.\scripts\windows\package.ps1 -Architecture arm64
```

The build runs Rust tests, TypeScript checking, and Windows/Rust protocol fixtures for drawing IDs and shape endpoints, builds the Rust static library and CXX bridge, bundles the shared JavaScript, then compiles the Windows solution and generates an unsigned MSIX development layout. The installer installs Microsoft runtime dependencies as needed, copies the complete app layout into `GAMEPACK_HOME\app\windows` or `%USERPROFILE%\.gamepack\app\windows`, then registers that stable layout. The checkout and downloaded ZIP are no longer needed after installation. Packaging checks the PE machine type of the executable and RN Windows DLL, the embedded JavaScript bundle, and the identities, versions, and CPU architectures of all declared runtime framework dependencies. No new signing certificate is trusted. Remove with `Get-AppxPackage GamePack | Remove-AppxPackage`; this does not delete your GamePack library.

If dependencies are already installed, run only build and install. Visual Studio **2022** is selected explicitly; a machine with only VS 2026 needs the 2022 C++ build tools alongside it. For an ordinary distributable package, sign the MSIX with your organization's trusted code-signing certificate. The source workflow intentionally uses Developer Mode registration.

## Storage and playback

All GamePack library data is in `%USERPROFILE%\.gamepack`, or the absolute directory named by `GAMEPACK_HOME`. The native module supplies that root on every Rust request. This includes SQLite, managed media copies, cache, temporary files, and configuration. Originals remain untouched. The installer records the selected library root beside the executable so Start menu launches keep using it. A process environment override has highest priority. To change the root for all future launches, set a user environment variable:

```powershell
[Environment]::SetEnvironmentVariable('GAMEPACK_HOME', 'D:\GamePackLibrary', 'User')
```

Windows needs the appropriate installed codec for the selected video. A decode error is reported in the UI. H.264/AAC in MP4 is a useful first smoke-test clip. The aspect-fit overlay uses normalized coordinates and the native playback clock, captures pointer drags, ends a stroke on seek, and replays time-filtered samples for an interval. Only the selected scene is rendered. Paused samples retain the same media timestamp.

## Validation status

The Windows implementation is authored on macOS. [Baseline CI run 37837750750](https://github.com/Potirniche-Carmine/GamePack/actions/runs/37837750750) compiled x64 and ARM64 native hosts, passed the Windows Rust tests, and uploaded both installable development ZIPs. Their checksums, executable CPU types, embedded JavaScript, and bundled framework identities were inspected. [Windows PowerShell 5 protocol preflight 37842896179](https://github.com/Potirniche-Carmine/GamePack/actions/runs/37842896179) passed the drawing ID, shape endpoint, and source preservation fixtures. [Run 37842879885](https://github.com/Potirniche-Carmine/GamePack/actions/runs/37842879885) additionally passed both native builds, 12 Rust tests per architecture, protocol fixtures, PE/framework checks, and notice collection; ZIP creation then exposed an old dependency-notice timestamp. Staged timestamps are now bounded to the ZIP format's supported range. That fix and the subsequent native appearance/capture changes await a fresh full CI run.

CI uses standard `windows-2022` runners, cross-compiling ARM64 with Rust `aarch64-pc-windows-msvc` and the Visual Studio ARM64 tools. Build and package checks do not establish interactive visual or playback correctness. The unsigned packages are development builds; interactive Windows testing remains outstanding. Install a package on each target architecture and check: import and restart persistence; pause/play/seek/rate; pen/arrow/ellipse capture; live Save and progressive replay with end exclusion; aspect-fit geometry after resize; review-end pause; light/dark/system appearance; profile and immutable post; original-file preservation; and custom `GAMEPACK_HOME`. No interactive Windows desktop check has been claimed as passed.

## Version and architecture references

- [RN Windows 0.81.6 package metadata](https://registry.npmjs.org/react-native-windows/0.81.6) declares React `^19.1.4` and React Native `^0.81.0`; this repository pins RN 0.81.6 and React 19.1.4.
- [Pinned RN Windows native NuGet](https://www.nuget.org/packages/Microsoft.ReactNative/0.81.6) includes both x64 and ARM64 Paper binaries.
- [Visual Studio installer CLI](https://learn.microsoft.com/en-us/visualstudio/install/use-command-line-parameters-to-install-visual-studio?view=vs-2022) documents the additive `modify --add` operation.
- [Visual Studio Build Tools component IDs](https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools?view=vs-2022) lists the bootstrap workloads and C++ UWP/SDK components.
- [Microsoft architecture documentation](https://microsoft.github.io/react-native-windows/docs/new-architecture/) describes the Paper/UWP renderer and its removal in 0.82. Keep RN Windows pinned to 0.81.6 for this host.
- [Microsoft XAML Islands host guide](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/xaml-islands/using-the-xaml-hosting-api) documents desktop HWND hosting through WindowsXamlManager and DesktopWindowXamlSource.
- [Microsoft package activation documentation](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-application) describes `Windows.FullTrustApplication`. GamePack uses desktop full trust so Rust filesystem access reaches the real library directory.

The checked-in package images originate from Microsoft's MIT-licensed React Native Windows template. Host and player code is GamePack code.
