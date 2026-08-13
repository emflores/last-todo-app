import type { UpdateStatus } from '../../shared/contracts';

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
}

export type UpdatePlatform = 'darwin' | 'linux' | 'win32';
export type UpdateArchitecture = 'x64' | 'arm64';

const PLATFORM_DOWNLOADS: Record<
  UpdatePlatform,
  { extension: string; label: string; name: string }
> = {
  darwin: { extension: '.dmg', label: 'DMG', name: 'macOS' },
  linux: { extension: '.deb', label: 'DEB', name: 'Linux' },
  win32: { extension: '.exe', label: 'Windows installer', name: 'Windows' },
};

function parseVersion(value: string): [number, number, number] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid release version: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  for (let index = 0; index < next.length; index += 1) {
    const difference = next[index]! - installed[index]!;
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function parseRelease(value: unknown): GitHubRelease {
  if (!value || typeof value !== 'object')
    throw new Error('GitHub returned an invalid release.');
  const release = value as Record<string, unknown>;
  if (typeof release.tag_name !== 'string' || !Array.isArray(release.assets))
    throw new Error('GitHub returned an invalid release.');

  const assets = release.assets.flatMap((asset): GitHubAsset[] => {
    if (!asset || typeof asset !== 'object') return [];
    const candidate = asset as Record<string, unknown>;
    return typeof candidate.name === 'string' &&
      typeof candidate.browser_download_url === 'string'
      ? [
          {
            name: candidate.name,
            browser_download_url: candidate.browser_download_url,
          },
        ]
      : [];
  });
  return { tag_name: release.tag_name, assets };
}

function trustedAssetUrl(value: string, extension: string): string | null {
  try {
    const url = new URL(value);
    const expectedPath = '/emflores/last-todo-app/releases/download/';
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith(expectedPath) &&
      url.pathname.toLowerCase().endsWith(extension)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function updateStatusFromRelease(
  value: unknown,
  currentVersion: string,
  checkedAt: string,
  platform: UpdatePlatform,
  architecture: UpdateArchitecture,
): UpdateStatus {
  const release = parseRelease(value);
  const latestVersion = release.tag_name.replace(/^v/, '');
  const updateAvailable = isNewerVersion(latestVersion, currentVersion);
  const target = PLATFORM_DOWNLOADS[platform];
  const platformAssets = release.assets.filter((candidate) =>
    candidate.name.toLowerCase().endsWith(target.extension),
  );
  const asset = updateAvailable
    ? platform === 'darwin'
      ? (platformAssets.find((candidate) =>
          candidate.name
            .toLowerCase()
            .endsWith(`-${architecture}${target.extension}`),
        ) ??
        platformAssets.find(
          (candidate) => !/-(?:arm64|x64)\.dmg$/i.test(candidate.name),
        ))
      : platformAssets[0]
    : undefined;
  const downloadUrl = asset
    ? trustedAssetUrl(asset.browser_download_url, target.extension)
    : null;

  return {
    currentVersion,
    latestVersion,
    updateAvailable: updateAvailable && Boolean(downloadUrl),
    downloadUrl,
    downloadLabel: downloadUrl
      ? platform === 'darwin'
        ? architecture === 'arm64'
          ? 'Apple Silicon DMG'
          : 'Intel DMG'
        : target.label
      : null,
    checkedAt,
    error:
      updateAvailable && !downloadUrl
        ? `Version ${latestVersion} is available, but its ${target.name} download is not ready yet.`
        : null,
  };
}
