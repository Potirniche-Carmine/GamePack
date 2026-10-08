# Windows source installation

GamePack targets Windows 10 2004 or later, x64. The UI is the shared React Native app, embedded in the installed package. Release builds do not need Metro or another server. The host is a native Win32 window with a Windows XAML island and React Native Windows 0.81.6's Paper renderer; video is Windows MediaPlayerElement with a native Canvas vector overlay.

## Build and install

Install [App Installer](https://apps.microsoft.com/detail/9nblggh4nns1) for `winget`. In an elevated PowerShell terminal, run:

```powershell
.\scripts\windows\bootstrap.ps1 -EnableDeveloperMode
```

This installs Node LTS, Rust/MSVC and Visual Studio 2022 Build Tools with desktop C++, UWP C++ and SDK 10.0.22621.0. The optional switch enables Windows Developer Mode for source package registration. If Visual Studio installation requests a restart, complete that first. Open a new PowerShell terminal, then:

```powershell
.\scripts\windows\build.ps1
.\scripts\windows\install.ps1 -Launch
```

The build runs Rust tests and TypeScript checking, builds the Rust static library and CXX bridge, bundles the shared JavaScript, then compiles the Windows solution and generates an unsigned MSIX development layout. The installer registers that layout and its Microsoft runtime dependencies. Keep the checkout and build output in place while the development package is installed. No new signing certificate is trusted. Remove with `Get-AppxPackage GamePack | Remove-AppxPackage`; this does not delete your GamePack library.

If dependencies are already installed, run only build and install. Visual Studio **2022** is selected explicitly; a machine with only VS 2026 needs the 2022 C++ build tools alongside it. For an ordinary distributable package, sign the MSIX with your organization's trusted code-signing certificate. The source workflow intentionally uses Developer Mode registration.

## Storage and playback

All GamePack library data is in `%USERPROFILE%\.gamepack`, or the absolute directory named by `GAMEPACK_HOME`. The native module supplies that root on every Rust request. This includes SQLite, managed media copies, cache, temporary files, and configuration. Originals remain untouched. Set a user environment variable before launching from Start if using a custom root:

```powershell
[Environment]::SetEnvironmentVariable('GAMEPACK_HOME', 'D:\GamePackLibrary', 'User')
```

Windows needs the appropriate installed codec for the selected video. A decode error is reported in the UI. H.264/AAC in MP4 is a useful first smoke-test clip. The aspect-fit overlay uses normalized coordinates and the native playback clock, captures pointer drags, ends a stroke on seek, and replays time-filtered samples for an interval. Only the selected scene is rendered. Paused samples retain the same media timestamp.

## Validation status

The Windows implementation is authored on macOS and has not been executed on Windows locally. The `Windows native build` GitHub Actions workflow compiles the Rust bridge, JavaScript bundle, C++ host, and package on `windows-2022`; its result is the build authority. A successful compile does not establish visual or playback correctness. Before distributing a Windows release, install the layout on Windows and test: import and restart persistence; pause/play/seek/rate; pen/arrow/ellipse capture; interval progressive replay and end exclusion; aspect-fit geometry after resize; review-end pause; profile and immutable post; original-file preservation; and custom `GAMEPACK_HOME`.

## Version and architecture references

- [RN Windows 0.81.6 package metadata](https://registry.npmjs.org/react-native-windows/0.81.6) declares React `^19.1.4` and React Native `^0.81.0`; this repository pins RN 0.81.6 and React 19.1.4.
- [Visual Studio Build Tools component IDs](https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools?view=vs-2022) lists the bootstrap workloads and C++ UWP/SDK components.
- [Microsoft architecture documentation](https://microsoft.github.io/react-native-windows/docs/new-architecture/) describes the Paper/UWP renderer and its removal in 0.82. Keep RN Windows pinned to 0.81.6 for this host.
- [Microsoft XAML Islands host guide](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/xaml-islands/using-the-xaml-hosting-api) documents desktop HWND hosting through WindowsXamlManager and DesktopWindowXamlSource.
- [Microsoft package activation documentation](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-application) describes `Windows.FullTrustApplication`. GamePack uses desktop full trust so Rust filesystem access reaches the real library directory.

The checked-in package images originate from Microsoft's MIT-licensed React Native Windows template. Host and player code is GamePack code.
