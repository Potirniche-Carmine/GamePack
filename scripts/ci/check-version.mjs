import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const version = JSON.parse(read('package.json')).version;
assert.match(version, /^\d+\.\d+\.\d+$/);
const lock = JSON.parse(read('package-lock.json'));
assert.equal(lock.version, version, 'npm lockfile version');
assert.equal(lock.packages[''].version, version, 'npm root package version');
assert.equal(read('crates/gamepack-core/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1], version, 'Rust crate version');
assert.equal(read('Cargo.lock').match(/name = "gamepack-core"\r?\nversion = "([^"]+)"/)?.[1], version, 'Cargo lockfile version');
assert.equal(read('macos/gamepack-macOS/Info.plist').match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1], version, 'macOS bundle version');
assert.equal(read('apps/windows/GamePack.Package/Package.appxmanifest').match(/<Identity\b[^>]*\bVersion="([^"]+)"/s)?.[1], `${version}.0`, 'Windows package version');
if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, `v${version}`, 'release tag version');
console.log(`All package versions match ${version}.`);
