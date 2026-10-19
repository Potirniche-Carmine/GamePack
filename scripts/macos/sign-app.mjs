#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export function execute(program, args) {
  const result = spawnSync(program, args, {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, shell: false});
  if (result.error || result.status !== 0) throw new Error(`${path.basename(program)} failed: ${result.error?.message || result.stderr?.trim() || result.stdout?.trim() || result.status}`);
  return `${result.stdout || ''}${result.stderr || ''}`;
}
function isMachO(file) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(4);
    return fs.readSync(descriptor, bytes, 0, 4, 0) === 4 && new Set([
      'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca',
    ]).has(bytes.toString('hex'));
  } finally { fs.closeSync(descriptor); }
}
export function signingPlan(appPath) {
  const app = path.resolve(appPath);
  if (fs.lstatSync(app).isSymbolicLink() || !app.endsWith('.app')) throw new Error('Sign a regular .app directory, not a symlink.');
  const root = fs.realpathSync(app), machos = [], bundles = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (!fs.realpathSync(file).startsWith(`${root}${path.sep}`)) throw new Error(`Bundle link escapes the app: ${file}`);
      } else if (entry.isDirectory()) {
        walk(file);
        if (/\.(?:app|framework|xpc|appex|bundle)$/.test(entry.name) || /\.framework\/Versions\/[^/]+$/.test(file)) bundles.push(file);
      } else if (entry.isFile() && isMachO(file)) machos.push(file);
    }
  }
  walk(root);
  const main = path.join(root, 'Contents/MacOS/GamePack'), helper = path.join(root, 'Contents/Helpers/GamePackUpdateHelper');
  if (!machos.includes(main) || !machos.includes(helper)) throw new Error('The GamePack executable or trusted update helper is missing. Rebuild the app.');
  // Resource-only bundles are sealed by the containing app and have no code to sign.
  const codeBundles = bundles.filter(bundle => machos.some(file => file.startsWith(`${bundle}${path.sep}`)));
  const nested = [...machos.filter(file => file !== main), ...codeBundles];
  nested.sort((left, right) => right.split(path.sep).length - left.split(path.sep).length || left.localeCompare(right));
  return [...nested, root];
}
export function resolveSigner(requested, run = execute) {
  if (requested === undefined || requested === '-') return {identity: '-', developerID: false};
  if (!requested.trim()) throw new Error('GAMEPACK_MACOS_SIGN_IDENTITY is empty. Use a Developer ID Application identity or omit it for development.');
  const identities = [...run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']).matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"/gmi)]
    .map(match => ({identity: match[1].toUpperCase(), name: match[2]}))
    .filter(value => value.identity === requested.toUpperCase() || value.name === requested);
  if (identities.length !== 1 || !identities[0].name.startsWith('Developer ID Application: '))
    throw new Error('GAMEPACK_MACOS_SIGN_IDENTITY must exactly identify one valid Developer ID Application certificate with its private key in the keychain. No fallback signing was attempted.');
  const team = /\(([A-Z0-9]{10})\)$/.exec(identities[0].name)?.[1];
  if (!team) throw new Error('The Developer ID certificate has no recognizable team identifier.');
  return {...identities[0], team, developerID: true};
}
export function requireDistributionSignature(metadata, expected) {
  if (!/^Authority=Developer ID Application: /m.test(metadata) || !/^TeamIdentifier=[A-Z0-9]{10}$/m.test(metadata) || !/flags=.*\bruntime\b/.test(metadata) || !/^Timestamp=.+/m.test(metadata))
    throw new Error('Distribution requires a Developer ID Application signature, hardened runtime, and a secure timestamp.');
  if (expected && (!metadata.includes(`Authority=${expected.name}\n`) || !metadata.includes(`TeamIdentifier=${expected.team}\n`)))
    throw new Error('The resulting signature does not match the requested Developer ID identity.');
}
export function signApp(appPath, {identity = process.env.GAMEPACK_MACOS_SIGN_IDENTITY, run = execute} = {}) {
  const targets = signingPlan(appPath), app = targets.at(-1), signer = resolveSigner(identity, run);
  let existing = '';
  try { existing = run('/usr/bin/codesign', ['--display', '--verbose=4', app]); } catch { /* An unsigned build is expected. */ }
  if (!signer.developerID && /^Authority=Developer ID Application: /m.test(existing))
    throw new Error('Refusing to replace a Developer ID signature with ad-hoc signing. Set GAMEPACK_MACOS_SIGN_IDENTITY to the intended Developer ID certificate.');
  for (const target of targets) {
    const args = ['--force', '--sign', signer.identity];
    if (signer.developerID) args.push('--options', 'runtime', '--timestamp');
    if (target === app) args.push('--entitlements', path.join(here, 'GamePack.entitlements'));
    args.push(target);
    // Sign each code object inside-out. --deep is reserved for verification;
    // propagating the app's JIT entitlement into every helper is unnecessary.
    run('/usr/bin/codesign', args);
    run('/usr/bin/codesign', ['--verify', '--strict', target]);
    if (signer.developerID) requireDistributionSignature(run('/usr/bin/codesign', ['--display', '--verbose=4', target]), signer);
  }
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  return signer;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length < 3 || process.argv.length > 4 || (process.argv[3] && process.argv[3] !== '--json')) throw new Error('Usage: node scripts/macos/sign-app.mjs /path/GamePack.app [--json]');
    const signer = signApp(process.argv[2]);
    console.log(process.argv[3] === '--json' ? JSON.stringify({...signer, hardenedRuntime: signer.developerID, secureTimestamp: signer.developerID}) : signer.developerID ? `Signed with ${signer.name}.` : 'Signed for local development (ad-hoc).');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
