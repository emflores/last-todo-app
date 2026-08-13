import type { UpdateStatus } from '../../shared/contracts';

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
}

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

function trustedDmgUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const expectedPath = '/michael/last-todo-app/releases/download/';
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith(expectedPath) &&
      url.pathname.toLowerCase().endsWith('.dmg')
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
): UpdateStatus {
  const release = parseRelease(value);
  const latestVersion = release.tag_name.replace(/^v/, '');
  const updateAvailable = isNewerVersion(latestVersion, currentVersion);
  const dmg = updateAvailable
    ? release.assets.find((asset) => asset.name.toLowerCase().endsWith('.dmg'))
    : undefined;
  const downloadUrl = dmg ? trustedDmgUrl(dmg.browser_download_url) : null;

  return {
    currentVersion,
    latestVersion,
    updateAvailable: updateAvailable && Boolean(downloadUrl),
    downloadUrl,
    checkedAt,
    error:
      updateAvailable && !downloadUrl
        ? `Version ${latestVersion} is available, but its macOS download is not ready yet.`
        : null,
  };
}
