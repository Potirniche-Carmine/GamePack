# Release notice collection

After installing the locked npm dependencies and building the Rust dependencies, run from the repository root:

```sh
node scripts/collect-notices.mjs stage/Notices
```

For a cross-platform or cross-architecture release, select the Rust target used by that build:

```sh
node scripts/collect-notices.mjs stage/Notices --target x86_64-pc-windows-msvc
```

The default target is `CARGO_BUILD_TARGET`, or the `rustc -vV` host. Cargo metadata runs with `--locked --offline --filter-platform`; missing registry sources produce an error with setup instructions. The collector does not download notices or dependency sources.

The output contains the root GamePack license, conventional root `LICENSE`/`LICENCE`, `COPYING`, `NOTICE`, `UNLICENSE`, and `COPYRIGHT` files from installed production npm lockfile entries, reachable Cargo normal/build dependencies and declared `license_file` paths, and generated CocoaPods acknowledgement Markdown/plist files when present. npm development-only entries and missing optional entries are skipped. Installed npm versions must match the lockfile.

`manifest.json` records exact package versions, supplied license metadata, copied filenames, and missing notice-file observations. The inventory does not determine license obligations or prove that every bundled component was covered. CocoaPods acknowledgement files are included as generated; run `pod install` before collecting a macOS release's notices.

The destination must be empty or have a manifest from this collector. A successful rerun replaces the collector's previous output; failures preserve the previous output. Packaging scripts should place the resulting `Notices` directory beside the application or inside its distributable bundle.
