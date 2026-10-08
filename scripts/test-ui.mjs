import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ts from 'typescript';

const directory = new URL('../tests/', import.meta.url);
const names = readdirSync(directory).filter(name => name.endsWith('.test.mjs')).sort();
if (!names.length) throw new Error('No UI behavior tests were found.');
const stage = mkdtempSync(join(tmpdir(), 'gamepack-ui-tests-'));
let status = 1;
try {
  const output = join(stage, 'packages/app/src');
  mkdirSync(output, {recursive: true});
  mkdirSync(join(stage, 'tests'));
  const source = new URL('../packages/app/src/', import.meta.url);
  for (const name of readdirSync(source).filter(name => name.endsWith('.ts'))) {
    const result = ts.transpileModule(readFileSync(new URL(name, source), 'utf8'), {
      fileName: name, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    });
    writeFileSync(join(output, name.replace(/\.ts$/, '.js')), result.outputText);
  }
  const tests = names.map(name => {
    const path = join(stage, 'tests', name);
    const source = readFileSync(new URL(name, directory), 'utf8')
      .replace(/(from\s+['"]\.\.?\/[^'"]+)\.ts(['"])/g, '$1.js$2');
    writeFileSync(path, source);
    return path;
  });
  const result = spawnSync(process.execPath, ['--test', ...tests], {stdio: 'inherit'});
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally {
  rmSync(stage, {recursive: true, force: true});
}
process.exit(status);
