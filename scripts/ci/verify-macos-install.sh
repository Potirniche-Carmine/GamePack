#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 ]] || { printf 'Usage: verify-macos-install.sh <installer.dmg> <update.tar.gz> <temporary-directory>\n' >&2; exit 1; }
cd "$(dirname "$0")/../.."
image="$1"
archive="$2"
verification="$3"
[[ "$verification" == /* && ! -e "$verification" ]] || { printf 'Use a new absolute verification directory.\n' >&2; exit 1; }
mkdir -p "$verification/package" "$verification/library" "$verification/mounted"
tar -xzf "$archive" -C "$verification/package"
# Mount the actual user download and ensure it contains only the app and the
# standard Applications shortcut. Both distribution formats must carry the
# same signed bundle, including its offline notarization ticket when present.
mounted=0
cleanup() {
  if [[ "$mounted" == 1 ]]; then hdiutil detach -quiet "$verification/mounted"; fi
}
trap cleanup EXIT
hdiutil verify -quiet "$image"
hdiutil attach -quiet -readonly -nobrowse -mountpoint "$verification/mounted" "$image"
mounted=1
test "$(readlink "$verification/mounted/Applications")" = /Applications
for entry in "$verification/mounted/"*; do
  case "$(basename "$entry")" in GamePack.app|Applications) ;; *) printf 'Unexpected disk image content: %s\n' "$entry" >&2; exit 1 ;; esac
done
test ! -e "$verification/package/Install.command"
test ! -e "$verification/package/README.txt"
node --input-type=module - "$verification/package/GamePack.app" "$verification/mounted/GamePack.app" <<'JAVASCRIPT'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [archive, image] = process.argv.slice(2), pending = [''];
while (pending.length) {
  const relative = pending.pop(), left = path.join(archive, relative), right = path.join(image, relative);
  const a = fs.lstatSync(left), b = fs.lstatSync(right);
  assert.equal(a.mode & 0o170111, b.mode & 0o170111, `Different bundle entry type or executable permission: ${relative}`);
  if (a.isSymbolicLink()) assert.equal(fs.readlinkSync(left), fs.readlinkSync(right), `Different bundle link: ${relative}`);
  else if (a.isDirectory()) {
    const names = fs.readdirSync(left).sort();
    assert.deepEqual(names, fs.readdirSync(right).sort(), `Different bundle directory: ${relative}`);
    pending.push(...names.map(name => path.join(relative, name)));
  } else {
    assert.ok(a.isFile() && b.isFile(), `Unexpected bundle entry: ${relative}`);
    const hash = async file => {
      const digest = createHash('sha256');
      for await (const part of fs.createReadStream(file)) digest.update(part);
      return digest.digest('hex');
    };
    assert.equal(await hash(left), await hash(right), `Different bundle contents: ${relative}`);
  }
}
JAVASCRIPT
codesign --verify --deep --strict "$verification/mounted/GamePack.app"
export GAMEPACK_HOME="$verification/library"
printf 'existing library data\n' > "$GAMEPACK_HOME/library-fixture.txt"
cp "$GAMEPACK_HOME/library-fixture.txt" "$verification/expected-library.txt"
for attempt in 1 2; do
  bash scripts/macos/install-app.sh "$verification/mounted/GamePack.app" --no-launch
  codesign --verify --deep --strict "$GAMEPACK_HOME/app/GamePack.app"
  test -s "$GAMEPACK_HOME/app/GamePack.app/Contents/Resources/Notices/manifest.json"
  test -x "$GAMEPACK_HOME/Launch GamePack.command"
  cmp "$verification/expected-library.txt" "$GAMEPACK_HOME/library-fixture.txt"
  test ! -e "$GAMEPACK_HOME/app/GamePack.app/obsolete-resource.txt"
  if [[ "$attempt" == 1 ]]; then
    # Model a resource present in an older app but absent from the new package.
    printf 'old app resource\n' > "$GAMEPACK_HOME/app/GamePack.app/obsolete-resource.txt"
  fi
done
printf 'Disk image, packaged installation and replacement verified.\n'
