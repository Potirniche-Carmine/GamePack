import {appendFileSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
let native = true;
if (process.env.GITHUB_EVENT_NAME === 'push' && /^[0-9a-f]{40}$/.test(event.before) && !/^0+$/.test(event.before)) {
  // Compare the complete push, including merges and pushes with multiple commits.
  try {
    const files = execFileSync('git', ['diff', '--name-only', '-z', event.before, process.env.GITHUB_SHA], {encoding: 'utf8'}).split('\0').filter(Boolean);
    native = files.some(path => !/^(docs\/|\.agents\/|\.codex\/|tests\/)|\.md$|^(LICENSE|skills-lock\.json)$/.test(path));
  } catch {
    // A force push can remove the previous commit from fetched history.
    console.log('Previous commit unavailable; requesting every native package.');
  }
}
appendFileSync(process.env.GITHUB_OUTPUT, `native=${native}\n`);
console.log(native ? 'Native packages requested.' : 'Documentation/test-only push; native packages unchanged.');
