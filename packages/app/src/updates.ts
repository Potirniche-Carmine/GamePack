export type AppBuild = {version: string; platform: 'macos' | 'windows'; architecture: 'arm64' | 'x64'};
export type UpdateResult =
  | {kind: 'current'}
  | {kind: 'unpublished'}
  | {kind: 'available'; version: string; tag: string; asset: string | null};

type Version = {core: string[]; prerelease: string[]};
const repository = 'Potirniche-Carmine/GamePack';
export const latestReleaseEndpoint = `https://api.github.com/repos/${repository}/releases/latest`;

// Keep numeric identifiers as strings: SemVer does not impose a safe-integer limit.
export function parseVersion(value: unknown): Version | null {
  if (typeof value !== 'string' || value.length > 256) return null;
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match || match[0] !== value) return null;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) return null;
  return {core: match.slice(1, 4), prerelease};
}

function compareNumber(left: string, right: string): number {
  return left.length === right.length ? (left === right ? 0 : left > right ? 1 : -1) : left.length > right.length ? 1 : -1;
}

export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index++) {
    const order = compareNumber(a.core[index], b.core[index]);
    if (order) return order;
  }
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index], y = b.prerelease[index];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    return xn && yn ? compareNumber(x, y) : xn !== yn ? xn ? -1 : 1 : x > y ? 1 : -1;
  }
  return 0;
}

export function updateAssetName(build: AppBuild): string {
  if ((build.platform !== 'macos' && build.platform !== 'windows') || (build.architecture !== 'arm64' && build.architecture !== 'x64'))
    throw new Error('Updates are not available for this device.');
  return `GamePack-${build.platform}-${build.architecture}.${build.platform === 'macos' ? 'tar.gz' : 'zip'}`;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

export function evaluateRelease(value: unknown, build: AppBuild): UpdateResult {
  if (!parseVersion(build.version)) throw new Error('The installed version could not be read. Reinstall GamePack to check for updates.');
  const assetName = updateAssetName(build);
  if (!record(value)) throw new Error('GitHub returned invalid release information. Try again later.');
  if (value.draft === true || value.prerelease === true) return {kind: 'unpublished'};
  const version = parseVersion(value.tag_name);
  if (!version || value.draft !== false || value.prerelease !== false || typeof value.published_at !== 'string' || !Number.isFinite(Date.parse(value.published_at)))
    throw new Error('GitHub returned invalid release information. Try again later.');
  if (version.prerelease.length) return {kind: 'unpublished'};
  const tag = value.tag_name as string;
  if (compareVersions(tag, build.version)! <= 0) return {kind: 'current'};
  if (!Array.isArray(value.assets)) throw new Error('GitHub returned invalid release information. Try again later.');
  const matching = value.assets.filter(asset => record(asset) && asset.name === assetName);
  const asset = matching.length === 1 && matching[0].state === 'uploaded' && typeof matching[0].size === 'number' && matching[0].size > 0 ? assetName : null;
  // Never follow URLs supplied by the API. The native bridge constructs the
  // release/download URL from a validated tag and its own platform information.
  return {kind: 'available', version: tag.replace(/^v/, ''), tag, asset};
}

export async function checkForUpdates(build: AppBuild, options: {fetch?: typeof fetch; signal?: AbortSignal; timeoutMs?: number} = {}): Promise<UpdateResult> {
  if (!parseVersion(build.version)) throw new Error('The installed version could not be read. Reinstall GamePack to check for updates.');
  updateAssetName(build);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort);
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 15000);
  try {
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(latestReleaseEndpoint, {
        headers: {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'},
        signal: controller.signal,
      });
    } catch {
      if (options.signal?.aborted) throw new Error('Update check cancelled.');
      throw new Error(timedOut ? 'The update check timed out. Try again.' : 'Could not reach GitHub. Check your connection and try again.');
    }
    if (response.status === 404) return {kind: 'unpublished'};
    if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.get('retry-after') !== null)))
      throw new Error('GitHub’s request limit was reached. Try again later.');
    if (!response.ok) throw new Error('GitHub could not check for updates. Try again later.');
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new Error(timedOut ? 'The update check timed out. Try again.' : 'GitHub returned invalid release information. Try again later.'); }
    return evaluateRelease(payload, build);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
