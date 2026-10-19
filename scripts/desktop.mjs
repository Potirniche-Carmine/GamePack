import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [operation, ...arguments_] = process.argv.slice(2);
try {
  if (!['build', 'install', 'package'].includes(operation)) throw new Error('Choose build, install, or package.');
  if (arguments_.length && (arguments_.length !== 2 || arguments_[0] !== '--arch' || !['x64', 'arm64'].includes(arguments_[1]))) {
    throw new Error('Optional argument: --arch x64 or --arch arm64');
  }
  const windowsArchitecture = (process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE || '').toLowerCase();
  const hostArchitecture = process.platform !== 'win32' ? process.arch
    : windowsArchitecture === 'arm64' ? 'arm64'
      : ['amd64', 'x64'].includes(windowsArchitecture) ? 'x64' : process.arch;
  const architecture = arguments_[1] || hostArchitecture;
  const run = (command, args, env = process.env) => {
    const result = spawnSync(command, args, {cwd: root, stdio: 'inherit', env});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  };
  if (process.platform === 'darwin') {
    if (architecture !== process.arch) throw new Error('Build macOS packages on a Mac with the matching architecture. CI builds both.');
    if (operation === 'install') run('bash', ['scripts/install-macos.sh']);
    else {
      run('bash', ['scripts/build-macos.sh']);
      if (operation === 'package') run('bash', ['scripts/package-macos.sh']);
    }
  } else if (process.platform === 'win32') {
    const invoke = (script, extra = []) => run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `scripts/windows/${script}.ps1`, '-Architecture', architecture, ...extra]);
    if (operation === 'install') invoke('install', ['-Build', '-Launch']);
    else {
      invoke('build');
      if (operation === 'package') invoke('package');
    }
  } else {
    throw new Error('Native GamePack builds require macOS or Windows. Run npm run typecheck and npm run test:ui on this platform.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
