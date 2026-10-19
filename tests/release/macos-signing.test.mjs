import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {signingPlan, resolveSigner, signApp, requireDistributionSignature} from '../../scripts/macos/sign-app.mjs';
import {notarizeApp} from '../../scripts/macos/notarize-app.mjs';

const fingerprint = '1234567890ABCDEF1234567890ABCDEF12345678';
const name = 'Developer ID Application: Example Developer (ABCDEFGHIJ)';
const identities = `  1) ${fingerprint} "${name}"\n  1 valid identities found\n`;
const metadata = `Authority=${name}\nTeamIdentifier=ABCDEFGHIJ\nCodeDirectory v=20500 flags=0x10000(runtime)\nTimestamp=Oct 19, 2026 at 1:00:00 PM\n`;
function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gamepack-signing-')));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const app = path.join(directory, 'With spaces', 'GamePack.app');
  for (const relative of ['Contents/MacOS/GamePack', 'Contents/Helpers/GamePackUpdateHelper', 'Contents/Frameworks/hermes.framework/Versions/0/hermes']) {
    const file = path.join(app, relative); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, Buffer.from('cffaedfe00000000', 'hex'));
  }
  fs.symlinkSync('0', path.join(app, 'Contents/Frameworks/hermes.framework/Versions/Current'));
  fs.mkdirSync(path.join(app, 'Contents/Resources/privacy.bundle'), {recursive: true});
  fs.writeFileSync(path.join(app, 'Contents/Resources/privacy.bundle/Info.plist'), 'resource-only');
  return {app, directory};
}

test('signing order handles framework versions, helper, spaces and resource-only bundles', t => {
  const {app} = fixture(t), plan = signingPlan(app);
  assert.equal(plan.at(-1), app);
  assert.ok(plan.indexOf(path.join(app, 'Contents/Frameworks/hermes.framework/Versions/0/hermes')) < plan.indexOf(path.join(app, 'Contents/Frameworks/hermes.framework/Versions/0')));
  assert.ok(plan.indexOf(path.join(app, 'Contents/Frameworks/hermes.framework/Versions/0')) < plan.indexOf(path.join(app, 'Contents/Frameworks/hermes.framework')));
  assert.ok(plan.includes(path.join(app, 'Contents/Helpers/GamePackUpdateHelper')));
  assert.ok(!plan.some(item => item.endsWith('privacy.bundle') || item.endsWith('Versions/Current')));
  assert.ok(!plan.includes(path.join(app, 'Contents/MacOS/GamePack')));
});
test('signing rejects missing helper and links outside the bundle', t => {
  const {app, directory} = fixture(t);
  fs.symlinkSync(directory, path.join(app, 'Contents/escape'));
  assert.throws(() => signingPlan(app), /escapes/);
  fs.unlinkSync(path.join(app, 'Contents/escape'));
  fs.unlinkSync(path.join(app, 'Contents/Helpers/GamePackUpdateHelper'));
  assert.throws(() => signingPlan(app), /helper is missing/);
});
test('only an exact, unambiguous Developer ID identity may sign distribution code', () => {
  const run = () => identities;
  assert.equal(resolveSigner(fingerprint.toLowerCase(), run).identity, fingerprint);
  assert.equal(resolveSigner(name, run).team, 'ABCDEFGHIJ');
  assert.throws(() => resolveSigner('Example Developer', run), /exactly identify/);
  assert.throws(() => resolveSigner('', run), /empty/);
  assert.throws(() => resolveSigner(fingerprint, () => identities + identities), /exactly identify/);
  assert.throws(() => resolveSigner(fingerprint, () => identities.replace('Developer ID Application:', 'Apple Development:')), /Developer ID Application/);
  assert.equal(resolveSigner(undefined, () => assert.fail('Development must not inspect the keychain')).identity, '-');
});
test('distribution signing timestamps every code object and limits JIT entitlement to GamePack', t => {
  const {app} = fixture(t), calls = [];
  signApp(app, {identity: fingerprint, run: (program, args) => {
    calls.push({program, args});
    return program.endsWith('security') ? identities : args.includes('--display') ? metadata : '';
  }});
  const signs = calls.filter(call => call.args.includes('--sign'));
  assert.equal(signs.length, signingPlan(app).length);
  for (const {args} of signs) {
    assert.ok(args.includes('--timestamp') && args.includes('runtime'));
    assert.equal(args.includes('--deep'), false);
    assert.equal(args.includes('--entitlements'), args.at(-1) === app);
    assert.equal(args[args.indexOf('--sign') + 1], fingerprint);
  }
  assert.deepEqual(calls.at(-1).args, ['--verify', '--deep', '--strict', app]);
});
test('ad-hoc packaging refuses an existing Developer ID signature before modifying it', t => {
  const {app} = fixture(t), calls = [];
  assert.throws(() => signApp(app, {identity: '-', run: (_program, args) => { calls.push(args); return metadata; }}), /Refusing/);
  assert.equal(calls.some(args => args.includes('--sign')), false);
});
test('signing failure stops without any fallback identity', t => {
  const {app} = fixture(t), signs = [];
  assert.throws(() => signApp(app, {identity: fingerprint, run: (program, args) => {
    if (program.endsWith('security')) return identities;
    if (args.includes('--sign')) { signs.push(args); throw new Error('Keychain denied access'); }
    return metadata;
  }}), /Keychain denied/);
  assert.equal(signs.length, 1); assert.ok(!signs[0].includes('-'));
});
test('distribution verification requires runtime, timestamp and requested team', () => {
  requireDistributionSignature(metadata);
  for (const line of ['Authority=', 'TeamIdentifier=', 'CodeDirectory ', 'Timestamp='])
    assert.throws(() => requireDistributionSignature(metadata.split('\n').filter(value => !value.startsWith(line)).join('\n')), /requires/);
  assert.throws(() => requireDistributionSignature(metadata, {name, team: 'XXXXXXXXXX'}), /does not match/);
});
test('notarization refuses missing profile or ad-hoc app before upload', t => {
  const {app, directory} = fixture(t);
  const submit = () => assert.fail('Unexpected submission');
  assert.throws(() => notarizeApp(app, {profile: '', submit}), /keychain profile/);
  assert.throws(() => notarizeApp(app, {profile: 'release', run: () => 'Signature=adhoc', submit, outputDirectory: path.join(directory, 'notary')}), /Distribution requires/);
});
test('accepted notarization staples before verification and never re-signs', t => {
  const {app, directory} = fixture(t), calls = [];
  const receipt = notarizeApp(app, {profile: 'profile with spaces', outputDirectory: path.join(directory, 'notary'),
    run: (program, args) => { calls.push([program, ...args]); return metadata; },
    submit: args => {
      calls.push(['submit', ...args]);
      assert.equal(args[args.indexOf('--keychain-profile') + 1], 'profile with spaces');
      assert.ok(args.includes('--wait') && args.includes('--timeout'));
      return {status: 0, stdout: JSON.stringify({id: '12345678-1234-1234-1234-123456789abc', status: 'Accepted'})};
    },
  });
  assert.ok(fs.existsSync(receipt.receipt));
  assert.equal(calls.some(args => args.includes('--sign')), false);
  const staple = calls.findIndex(args => args.includes('staple'));
  assert.ok(staple > calls.findIndex(args => args[0] === 'submit'));
  assert.ok(calls.findIndex(args => args.includes('validate')) > staple);
  assert.equal(calls.at(-1)[0], '/usr/sbin/spctl');
});
test('notary rejection and timeouts preserve diagnostics without stapling or resubmitting', t => {
  const {app, directory} = fixture(t);
  for (const status of ['Invalid', 'In Progress']) {
    const calls = []; let submissions = 0;
    assert.throws(() => notarizeApp(app, {profile: 'release', outputDirectory: path.join(directory, status), run: (program, args) => { calls.push([program, ...args]); return metadata; },
      submit: () => { submissions++; return {status: status === 'Invalid' ? 0 : 1, stdout: JSON.stringify({id: '12345678-1234-1234-1234-123456789abc', status})}; },
    }), /was not accepted/);
    assert.equal(submissions, 1); assert.equal(calls.some(args => args.includes('staple')), false);
    assert.equal(calls.some(args => args.includes('log')), status === 'Invalid');
    assert.ok(fs.existsSync(path.join(directory, status, 'submission.json')));
  }
});
