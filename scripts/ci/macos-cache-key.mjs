import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function macosDependencyKey(root) {
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  // Release bumps do not change dependencies. Keep every dependency version,
  // URL, integrity hash and root dependency range in the cache identity.
  delete lock.version;
  delete lock.packages[''].version;
  const hash = createHash('sha256').update(JSON.stringify(lock));
  for (const file of ['Gemfile.lock', 'macos/Podfile', 'macos/Podfile.lock'])
    hash.update(file).update('\0').update(readFileSync(resolve(root, file)));
  return hash.digest('hex');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(macosDependencyKey(process.cwd()));
