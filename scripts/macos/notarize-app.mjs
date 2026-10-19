#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {execute, requireDistributionSignature, signingPlan} from './sign-app.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function notarizeApp(appPath, {profile = process.env.GAMEPACK_NOTARY_PROFILE, run = execute,
  submit = (args) => spawnSync('/usr/bin/xcrun', args, {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, shell: false}),
  outputDirectory = path.join(repository, 'artifacts/local/notarization', randomUUID())} = {}) {
  if (typeof profile !== 'string' || !profile.trim()) throw new Error('Set GAMEPACK_NOTARY_PROFILE to an existing notarytool keychain profile. Credentials are not read from files or command-line passwords.');
  const targets = signingPlan(appPath), app = targets.at(-1);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  for (const target of targets) requireDistributionSignature(run('/usr/bin/codesign', ['--display', '--verbose=4', target]));
  fs.mkdirSync(outputDirectory, {recursive: true, mode: 0o700});
  const archive = path.join(outputDirectory, 'GamePack-notarization.zip'), receipt = path.join(outputDirectory, 'submission.json');
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, archive]);
  const result = submit(['notarytool', 'submit', archive, '--keychain-profile', profile, '--wait', '--timeout', '30m', '--output-format', 'json']);
  fs.writeFileSync(receipt, result.stdout || '', {mode: 0o600});
  let submission;
  try { submission = JSON.parse(result.stdout); } catch { /* Preserve the exact response for diagnosis. */ }
  const id = typeof submission?.id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(submission.id) ? submission.id : null;
  if (result.error || result.status !== 0 || submission?.status !== 'Accepted' || !id) {
    if (id && submission?.status === 'Invalid') {
      try { run('/usr/bin/xcrun', ['notarytool', 'log', id, '--keychain-profile', profile, path.join(outputDirectory, 'notary-log.json')]); } catch { /* Retain the original submission failure. */ }
    }
    throw new Error(`Notarization was not accepted${id ? ` (submission ${id})` : ''}. ${submission?.status || result.error?.message || result.stderr?.trim() || 'Check the keychain profile and Apple account access.'} Diagnostics: ${receipt}. An upload may still be processing; check its status before submitting again.`);
  }
  // Staple before creating the distributable tarball so offline Macs receive
  // Apple's ticket. Never re-sign or mutate app resources after this point.
  run('/usr/bin/xcrun', ['stapler', 'staple', app]);
  run('/usr/bin/xcrun', ['stapler', 'validate', app]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  return {id, receipt, status: 'Accepted', stapled: true, assessment: 'accepted'};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length < 3 || process.argv.length > 4 || (process.argv[3] && process.argv[3] !== '--json')) throw new Error('Usage: node scripts/macos/notarize-app.mjs /path/GamePack.app [--json]');
    const result = notarizeApp(process.argv[2]);
    console.log(process.argv[3] === '--json' ? JSON.stringify(result) : `Notarization accepted and ticket verified (${result.id}). Receipt: ${result.receipt}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
