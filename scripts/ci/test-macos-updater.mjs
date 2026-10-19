import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';

const [harness, rawDirectory, packagedArchive, packagedApp] = process.argv.slice(2);
const directory = fs.realpathSync(rawDirectory);
let checks = 0;
function run(command, args, expected = 0) {
  const result = spawnSync(command, args, {encoding: 'utf8', env: {...process.env, COPYFILE_DISABLE: '1'}});
  assert.equal(result.status, expected, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
function check(args, passes = true) { checks++; return run(harness, args, passes ? 0 : 1); }
function octal(buffer, offset, length, value) { buffer.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length); }
function entry(name, data = '', type = '0', link = '', options = {}) {
  data = Buffer.from(data);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100); octal(header, 100, 8, 0o755); octal(header, 124, 12, options.size ?? data.length);
  header.fill(32, 148, 156); header.write(type, 156); header.write(link, 157, 100); header.write('ustar\0', 257); header.write('00', 263);
  if (options.magic) header.write(options.magic, 257);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  octal(header, 148, 8, checksum + (options.corruptChecksum ? 1 : 0));
  return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}
function pax(values) {
  let text = '';
  for (const [key, value] of Object.entries(values)) {
    const line = ` ${key}=${value}\n`;
    let length = Buffer.byteLength(line) + 1;
    while (String(length).length + Buffer.byteLength(line) !== length) length = String(length).length + Buffer.byteLength(line);
    text += `${length}${line}`;
  }
  return entry('PaxHeader', text, 'x');
}
const info = entry('GamePack.app/Contents/Info.plist', 'fixture');
function archive(name, entries, options = {}) {
  const tar = Buffer.concat([...entries, options.ending ?? Buffer.alloc(1024)]);
  const data = gzipSync(tar);
  const file = path.join(directory, `${name}.tar.gz`);
  fs.writeFileSync(file, options.truncate ? data.subarray(0, data.length - options.truncate) : data);
  return file;
}
function extraction(name, entries, passes, options) {
  const file = archive(name, entries, options);
  check(['extract', file, path.join(directory, `out-${name}`)], passes);
  return file;
}
const valid = extraction('valid', [entry('GamePack.app/', '', '5'), info, entry('Install.command', 'never run this'), entry('README.txt', 'release')], true);
assert.equal(fs.existsSync(path.join(directory, 'out-valid/Install.command')), false);
extraction('framework', [info, entry('GamePack.app/Contents/Frameworks/Test.framework/Versions/A/Test', 'binary'), entry('GamePack.app/Contents/Frameworks/Test.framework/Versions/Current', '', '2', 'A'), entry('GamePack.app/Contents/Frameworks/Test.framework/Test', '', '2', 'Versions/Current/Test')], true);
extraction('pax-valid', [pax({path: 'GamePack.app/Contents/Info.plist', size: '7'}), entry('short', 'fixture')], true);
for (const [name, entries] of [
  ['traversal', [entry('../escape', 'bad')]],
  ['absolute', [entry('/private/tmp/escape', 'bad')]],
  ['app-traversal', [entry('GamePack.app/../escape', 'bad')]],
  ['backslash', [entry('GamePack.app/Contents\\escape', 'bad')]],
  ['unexpected', [info, entry('other.txt', 'bad')]],
  ['top-file', [entry('GamePack.app', 'bad'), info]],
  ['duplicate', [info, info]],
  ['case-alias', [info, entry('gamepack.app/contents/info.plist', 'bad')]],
  ['unicode-alias', [info, entry('GamePack.app/é', 'x'), entry('GamePack.app/e\u0301', 'x')]],
  ['hardlink', [info, entry('GamePack.app/link', '', '1', 'Contents/Info.plist')]],
  ['device', [info, entry('GamePack.app/device', '', '3')]],
  ['outside-link', [info, entry('GamePack.app/link', '', '2', '../outside')]],
  ['absolute-link', [info, entry('GamePack.app/link', '', '2', '/tmp')]],
  ['broken-link', [info, entry('GamePack.app/link', '', '2', 'missing')]],
  ['cyclic-link', [info, entry('GamePack.app/a', '', '2', 'b'), entry('GamePack.app/b', '', '2', 'a')]],
  ['ancestor-link', [info, entry('GamePack.app/alias', '', '2', 'Contents'), entry('GamePack.app/alias/file', 'bad')]],
  ['pax-path', [pax({path: '../escape'}), info]],
  ['pax-linkpath', [info, pax({linkpath: '../../escape'}), entry('GamePack.app/link', '', '2', 'Contents')]],
  ['pax-empty-size', [pax({size: ''}), info]],
  ['pax-huge-size', [pax({size: '99999999999999999999999999'}), info]],
  ['pax-negative-size', [pax({size: '-1'}), info]],
  ['pax-sparse', [pax({'GNU.sparse.size': '7'}), info]],
  ['pax-duplicate', [entry('PaxHeader', '10 size=1\n10 size=2\n', 'x'), info]],
  ['pax-bad-length', [entry('PaxHeader', '99 path=hi\n', 'x'), info]],
  ['pax-unused', [info, pax({path: 'GamePack.app/unused'})]],
  ['oversize-file', [entry('GamePack.app/huge', '', '0', '', {size: 512 * 1024 * 1024 + 1})]],
  ['bad-checksum', [entry('GamePack.app/Contents/Info.plist', 'x', '0', '', {corruptChecksum: true})]],
  ['bad-format', [entry('GamePack.app/Contents/Info.plist', 'x', '0', '', {magic: 'bad!!!'})]],
  ['missing-app', [entry('README.txt', 'only readme')]],
  ['nonzero-directory', [info, entry('GamePack.app/dir', 'bad', '5')]],
]) extraction(name, entries, false);
extraction('incomplete-body', [entry('GamePack.app/Contents/Info.plist', 'x', '0', '', {size: 4096})], false);
extraction('single-end-block', [info], false, {ending: Buffer.alloc(512)});
extraction('bad-end-block', [info], false, {ending: Buffer.concat([Buffer.alloc(512), Buffer.alloc(512, 1)])});
extraction('trailing-entry', [info], false, {ending: Buffer.concat([Buffer.alloc(1024), entry('extra', 'bad')])});
extraction('truncated-gzip', [info], false, {truncate: 5});
extraction('too-much-padding', [info], false, {ending: Buffer.alloc(2 * 1024 * 1024)});
extraction('too-many-entries', [info, ...Array.from({length: 30000}, (_, n) => entry(`GamePack.app/${n}`, '', '5'))], false);
const digest = createHash('sha256').update(fs.readFileSync(valid)).digest('hex');
check(['verify', valid, digest]); check(['verify', valid, '0'.repeat(64)], false); check(['verify', valid, 'invalid'], false);
const linkArchive = path.join(directory, 'link-archive'); fs.symlinkSync(valid, linkArchive); check(['verify', linkArchive, digest], false);
check(['extract', valid, path.join(directory, 'out-valid')], false);

function plist(version) {
  return `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.gamepack.desktop</string><key>CFBundleExecutable</key><string>GamePack</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`;
}
const source = path.join(directory, 'fixture.c'); fs.writeFileSync(source, '#include <unistd.h>\nint main(){sleep(120);return 0;}\n');
function appFixture(parent, version) {
  const app = path.join(parent, 'GamePack.app'); fs.mkdirSync(path.join(app, 'Contents/MacOS'), {recursive: true});
  fs.writeFileSync(path.join(app, 'Contents/Info.plist'), plist(version));
  run('xcrun', ['clang', source, '-o', path.join(app, 'Contents/MacOS/GamePack')]);
  run('codesign', ['--force', '--sign', '-', app]); return app;
}
const candidate = appFixture(path.join(directory, 'candidate'), '1.0.1');
const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
check(['validate', candidate, '1.0.1', architecture]);
check(['validate', candidate, '1.0.0', architecture], false);
check(['validate', candidate, '1.0.1', architecture === 'arm64' ? 'x64' : 'arm64'], false);
check(['quarantine', candidate]);
fs.writeFileSync(path.join(candidate, 'Contents/Info.plist'), plist('1.0.2'));
check(['validate', candidate, '1.0.2', architecture], false);
fs.writeFileSync(path.join(candidate, 'Contents/Info.plist'), plist('1.0.1')); run('codesign', ['--force', '--sign', '-', candidate]);
const root = path.join(directory, 'managed root'); fs.mkdirSync(path.join(root, 'app'), {recursive: true});
const current = appFixture(path.join(root, 'app'), '1.0.0');
const fixtureArchive = path.join(directory, 'candidate.tar.gz');
run('/usr/bin/tar', ['-czf', fixtureArchive, '-C', path.dirname(candidate), 'GamePack.app']);
const fixtureDigest = createHash('sha256').update(fs.readFileSync(fixtureArchive)).digest('hex');
const jobDirectory = check(['stage', fixtureArchive, fixtureDigest, root, 'v1.0.1']);
const readPlist = file => JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]));
assert.equal(readPlist(path.join(root, 'updates/state.plist')).status, 'ready');
assert.equal(readPlist(path.join(jobDirectory, 'prepared.plist')).sha256, fixtureDigest);
check(['stage', fixtureArchive, fixtureDigest, root, 'v1.0.0'], false);
check(['stage', fixtureArchive, '0'.repeat(64), root, 'v1.0.1'], false);
const library = path.join(root, 'gamepack.sqlite3'); fs.writeFileSync(library, 'library sentinel');
const child = spawn(path.join(current, 'Contents/MacOS/GamePack'), [], {stdio: 'ignore'});
try {
  await delay(100);
  const identity = JSON.parse(check(['identity', String(child.pid)]));
  const job = {root, destination: current, staged: path.join(jobDirectory, 'payload/GamePack.app'), version: '1.0.1', process: identity};
  const jobPath = path.join(jobDirectory, 'job.plist');
  const saveJob = value => { fs.writeFileSync(jobPath, JSON.stringify(value)); run('/usr/bin/plutil', ['-convert', 'binary1', jobPath]); };
  saveJob({...job, process: {...identity, seconds: identity.seconds + 1}}); check(['install-job', jobPath], false);
  saveJob({...job, destination: candidate}); check(['install-job', jobPath], false);
  saveJob({...job, version: '1.0.0'}); check(['install-job', jobPath], false);
  saveJob(job);
  const helper = spawn(harness, ['install-job', jobPath], {stdio: 'ignore'});
  const done = new Promise(resolve => helper.once('exit', resolve));
  for (let n = 0; n < 100 && !fs.existsSync(path.join(jobDirectory, 'helper-ready.plist')); n++) await delay(50);
  assert.ok(fs.existsSync(path.join(jobDirectory, 'helper-ready.plist')), 'helper handshake');
  const helperIdentity = readPlist(path.join(jobDirectory, 'helper-ready.plist')).process;
  const permit = path.join(jobDirectory, 'install-permitted.plist');
  fs.writeFileSync(permit, JSON.stringify({helper: helperIdentity, parent: identity}));
  run('/usr/bin/plutil', ['-convert', 'binary1', permit]);
  // A manual upgrade while the helper waits must never be overwritten.
  fs.writeFileSync(path.join(current, 'Contents/Info.plist'), plist('2.0.0'));
  child.kill(); assert.equal(await done, 1); checks++;
  assert.equal(readPlist(path.join(current, 'Contents/Info.plist')).CFBundleShortVersionString, '2.0.0');
  assert.match(readPlist(path.join(root, 'updates/state.plist')).error, /installed app changed/);
  assert.equal(fs.existsSync(path.join(jobDirectory, 'previous.app')), false);
  assert.equal(fs.readFileSync(library, 'utf8'), 'library sentinel');
} finally { child.kill(); }

// A later ordinary quit must not install after a failed/missing restart commit.
fs.writeFileSync(path.join(current, 'Contents/Info.plist'), plist('1.0.0'));
run('codesign', ['--force', '--sign', '-', current]);
const uncommitted = spawn(path.join(current, 'Contents/MacOS/GamePack'), [], {stdio: 'ignore'});
try {
  await delay(100);
  const identity = JSON.parse(check(['identity', String(uncommitted.pid)]));
  for (const name of ['helper-ready.plist', 'install-permitted.plist']) fs.rmSync(path.join(jobDirectory, name), {force: true});
  const jobPath = path.join(jobDirectory, 'job.plist');
  fs.writeFileSync(jobPath, JSON.stringify({root, destination: current, staged: path.join(jobDirectory, 'payload/GamePack.app'), version: '1.0.1', process: identity}));
  run('/usr/bin/plutil', ['-convert', 'binary1', jobPath]);
  const helper = spawn(harness, ['install-job', jobPath], {stdio: 'ignore'});
  const done = new Promise(resolve => helper.once('exit', resolve));
  for (let n = 0; n < 100 && !fs.existsSync(path.join(jobDirectory, 'helper-ready.plist')); n++) await delay(50);
  assert.ok(fs.existsSync(path.join(jobDirectory, 'helper-ready.plist')));
  uncommitted.kill(); assert.equal(await done, 1); checks++;
  assert.match(readPlist(path.join(root, 'updates/state.plist')).error, /cancelled/);
  assert.equal(readPlist(path.join(current, 'Contents/Info.plist')).CFBundleShortVersionString, '1.0.0');
} finally { uncommitted.kill(); }

if (packagedArchive) {
  const archive = path.resolve(packagedArchive), output = path.join(directory, 'real-package');
  check(['extract', archive, output]);
  const app = path.resolve(packagedApp);
  const version = readPlist(path.join(app, 'Contents/Info.plist')).CFBundleShortVersionString;
  check(['validate', path.join(output, 'GamePack.app'), version, architecture, app]);
  assert.ok(fs.statSync(path.join(output, 'GamePack.app/Contents/Helpers/GamePackUpdateHelper')).mode & 0o111);
}
console.log(`macOS update validation passed (${checks} checks)`);
