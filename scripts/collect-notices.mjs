#!/usr/bin/env node
// Usage: node scripts/collect-notices.mjs <output-directory> [--target <Rust triple>]
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generator = 'gamepack-collect-notices-v1';
const noticeName = /^(?:licen[sc]es?|copying|notice|unlicense|copyright)(?:$|[._-])/i;
const warnings = [];
const records = [];
let temporary;

function fail(text) { throw new Error(text); }
function safe(text) { return text.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'); }
function slash(text) { return text.split(path.sep).join('/'); }
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function json(file, context) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { fail(`${context}: ${error.message}`); }
}
function run(program, args, explanation) {
  const result = spawnSync(program, args, {cwd: repository, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false});
  if (result.error || result.status !== 0)
    fail(`${explanation}\n${result.error?.message || result.stderr.trim() || `${program} exited ${result.status}`}`);
  return result.stdout;
}
async function copyFile(source, destination) {
  await fs.mkdir(path.dirname(destination), {recursive: true});
  await fs.copyFile(source, destination);
}
async function copyNoticeTree(source, destination, files, base) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) {
    // Copy only a link's file contents; never walk an unexpected directory tree.
    const target = await fs.stat(source);
    if (!target.isFile()) { warnings.push(`Skipped notice directory symlink: ${slash(path.relative(repository, source))}`); return; }
  } else if (stat.isDirectory()) {
    for (const name of (await fs.readdir(source)).sort())
      await copyNoticeTree(path.join(source, name), path.join(destination, name), files, base);
    return;
  } else if (!stat.isFile()) return;
  await copyFile(source, destination);
  files.push(slash(path.relative(base, destination)));
}
async function collectRootNotices(directory, destination, explicitLicense) {
  const files = [];
  const seen = new Set();
  for (const name of (await fs.readdir(directory)).sort()) {
    if (!noticeName.test(name)) continue;
    const source = path.join(directory, name);
    seen.add(path.resolve(source));
    await copyNoticeTree(source, path.join(destination, name), files, temporary);
  }
  if (explicitLicense) {
    const source = path.resolve(directory, explicitLicense);
    if (!await exists(source)) fail(`Declared Cargo license_file is missing: ${source}. Restore the locked dependency source before packaging.`);
    if (!seen.has(source)) await copyNoticeTree(source, path.join(destination, 'declared-license', path.basename(source)), files, temporary);
  }
  return files.sort();
}
function destination(ecosystem, name, version, locator) {
  const hash = createHash('sha256').update(locator).digest('hex').slice(0, 10);
  return path.join(temporary, ecosystem, `${safe(name)}-${safe(version)}-${hash}`);
}

async function collectNpm() {
  const lock = await json(path.join(repository, 'package-lock.json'), 'Cannot read npm lockfile. Run npm ci before collecting notices');
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages)
    fail('package-lock.json must contain npm lockfile v2/v3 packages metadata. Regenerate it with the project npm version and run npm ci.');
  for (const [locator, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
    if (!locator || entry.dev) continue;
    const directory = path.resolve(repository, locator);
    const relative = path.relative(repository, directory);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail(`npm lockfile package path escapes the repository: ${locator}`);
    if (!await exists(directory)) {
      if (entry.optional || entry.devOptional) { warnings.push(`Optional npm package is not installed: ${locator}`); continue; }
      fail(`Locked production npm package is missing: ${locator}. Run npm ci for this release platform before collecting notices.`);
    }
    const metadata = await json(path.join(directory, 'package.json'), `Missing or invalid package metadata at ${locator}. Run npm ci`);
    const locked = entry.link ? lock.packages[entry.resolved] : entry;
    if (!metadata.name || !metadata.version || !locked?.version)
      fail(`Incomplete name/version metadata for locked npm package ${locator}. Reinstall with npm ci and keep the exact lockfile.`);
    if (metadata.version !== locked.version)
      fail(`npm version mismatch at ${locator}: installed ${metadata.version}, locked ${locked.version}. Run npm ci before packaging.`);
    const license = metadata.license ?? locked.license ?? metadata.licenses ?? null;
    const files = await collectRootNotices(directory, destination('npm', metadata.name, metadata.version, locator));
    if (!files.length) warnings.push(`No conventional root notice file found for npm ${metadata.name}@${metadata.version} (${locator}).`);
    records.push({ecosystem: 'npm', name: metadata.name, version: metadata.version, license, lockfilePath: locator, files});
  }
}

async function collectCargo(target) {
  const raw = run('cargo', ['metadata', '--locked', '--offline', '--format-version', '1', '--filter-platform', target],
    `Cannot obtain locked Cargo metadata for ${target}. Install Rust, build/fetch the locked dependencies for this target, and rerun. This collector does not fetch missing packages.`);
  let metadata;
  try { metadata = JSON.parse(raw); } catch (error) { fail(`Cargo returned invalid metadata JSON: ${error.message}`); }
  if (!metadata.packages || !metadata.resolve?.nodes || !metadata.workspace_members)
    fail('Cargo metadata is missing package or dependency-graph information. Use a complete cargo metadata --locked result; --no-deps is insufficient.');
  const packages = new Map(metadata.packages.map(value => [value.id, value]));
  const nodes = new Map(metadata.resolve.nodes.map(value => [value.id, value]));
  // Include normal and build dependencies reachable from workspace members;
  // test-only dependencies are not part of this release inventory.
  const reachable = new Set();
  const queue = [...metadata.workspace_members];
  while (queue.length) {
    const id = queue.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = nodes.get(id);
    if (!node) fail(`Cargo dependency graph is missing ${id}. Regenerate complete locked Cargo metadata.`);
    for (const dependency of node.deps)
      if (dependency.dep_kinds.some(kind => kind.kind !== 'dev')) queue.push(dependency.pkg);
  }
  for (const id of [...reachable].sort()) {
    const item = packages.get(id);
    if (!item?.manifest_path || !item.name || !item.version) fail(`Cargo package metadata is incomplete for ${id}. Restore the locked registry or workspace source.`);
    const directory = path.dirname(item.manifest_path);
    if (!await exists(directory)) fail(`Cargo source is missing for ${item.name}@${item.version}: ${directory}. Build/fetch locked dependencies before packaging.`);
    const files = await collectRootNotices(directory, destination('cargo', item.name, item.version, id), item.license_file);
    if (!files.length) warnings.push(`No conventional root notice file found for Cargo ${item.name}@${item.version}.`);
    records.push({ecosystem: 'cargo', name: item.name, version: item.version, license: item.license ?? null, files});
  }
}

async function collectPods() {
  const directory = path.join(repository, 'macos', 'Pods', 'Target Support Files');
  if (!await exists(directory)) return;
  for (const target of (await fs.readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!target.isDirectory()) continue;
    const files = [];
    for (const name of (await fs.readdir(path.join(directory, target.name))).sort()) {
      if (!/-acknowledgements\.(?:markdown|plist)$/i.test(name)) continue;
      const destination = path.join(temporary, 'cocoapods', safe(target.name), name);
      await copyFile(path.join(directory, target.name, name), destination);
      files.push(slash(path.relative(temporary, destination)));
    }
    if (files.length) records.push({ecosystem: 'cocoapods', name: target.name, files});
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    console.log('Usage: node scripts/collect-notices.mjs <output-directory> [--target <Rust triple>]');
    if (!args.length) process.exitCode = 1;
    return;
  }
  const output = path.resolve(args.shift());
  let target = process.env.CARGO_BUILD_TARGET;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--target' || !args[1]) fail('Expected only an output directory and optional --target <Rust triple>.');
    target = args[1];
  }
  if (!target) {
    const rust = run('rustc', ['-vV'], 'Cannot determine the Rust host target. Install Rust and ensure rustc is on PATH, or pass --target <Rust triple>.');
    target = /^host:\s*(\S+)/m.exec(rust)?.[1];
    if (!target) fail('rustc -vV did not report a host target. Pass --target <Rust triple>.');
  }
  if (await exists(output)) {
    const stat = await fs.lstat(output);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`Output must be a real directory: ${output}`);
    const names = await fs.readdir(output);
    if (names.length) {
      const manifest = await json(path.join(output, 'manifest.json'), `Refusing to replace nonempty output ${output}; choose an empty directory`);
      if (manifest.generator !== generator) fail(`Refusing to replace output not created by this collector: ${output}`);
    }
  }
  const staging = `${output}.tmp-${process.pid}`;
  if (await exists(staging)) fail(`Temporary output already exists: ${staging}. Remove that stale collector directory and retry.`);
  temporary = staging;
  await fs.mkdir(temporary, {recursive: true});
  const license = path.join(repository, 'LICENSE');
  if (!await exists(license)) fail('Root LICENSE is missing. Restore it before packaging.');
  await copyFile(license, path.join(temporary, 'GamePack-LICENSE'));
  records.push({ecosystem: 'project', name: 'GamePack', files: ['GamePack-LICENSE']});
  await collectNpm();
  await collectCargo(target);
  await collectPods();
  const manifest = {generator, cargoTarget: target, packages: records, warnings};
  await fs.writeFile(path.join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(temporary, 'README.txt'),
    'GamePack dependency notices\n\n' +
    'Copied from the installed locked dependency sources and generated CocoaPods acknowledgements available when this directory was built.\n' +
    'manifest.json records package versions, supplied license metadata, copied files, and packages without a conventional root notice file.\n' +
    'This collection is an inventory of existing files, not a legal determination or an exhaustive dependency audit.\n');
  if (await exists(output)) await fs.rm(output, {recursive: true});
  await fs.rename(temporary, output);
  temporary = undefined;
  const files = records.reduce((sum, item) => sum + item.files.length, 0);
  console.log(`Collected ${files} notice files from ${records.length} package records into ${output}.`);
  if (warnings.length) console.log(`${warnings.length} inventory notes are recorded in manifest.json.`);
}

main().catch(async error => {
  if (temporary) await fs.rm(temporary, {recursive: true, force: true}).catch(() => undefined);
  console.error(`Notice collection failed: ${error.message}`);
  process.exitCode = 1;
});
