import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {prepareVersion, repositoryRoot} from './version.mjs';

try {
  if (process.argv.length !== 3) throw new Error('Usage: npm run version:prepare -- 1.2.3');
  const version = prepareVersion(process.argv[2]);
  console.log(`Updated every package to ${version}.`);
  const notes = `docs/releases/${version}.md`;
  console.log(`${existsSync(resolve(repositoryRoot, notes)) ? 'Review' : 'Add'} ${notes}, then commit the version changes and open a pull request.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
