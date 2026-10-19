import {parseReleaseArgs, prepareRelease} from './release.mjs';

const help = `Usage: npm run release:prepare -- --ci-run ID --sign-identity SHA1 --notary-profile NAME [--powershell PATH]

Prepare a draft from all four artifacts of a successful CI run for the exact current main commit.
Signs and notarizes both Mac packages locally; Windows packages remain unchanged.
Requires a clean tracked checkout, macOS/Xcode tools, authenticated gh, PowerShell (pwsh),
and an existing Developer ID Application certificate/private key and Keychain notary profile.
Keeps verification files under artifacts/local. Never publishes, creates a Git tag, or exports keys.`;

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) console.log(help);
  else await prepareRelease(parseReleaseArgs(args));
} catch (error) {
  console.error(error.message);
  console.error('Release preparation stopped. Any existing draft remains unpublished; review retained local files before retrying.');
  process.exitCode = 1;
}
