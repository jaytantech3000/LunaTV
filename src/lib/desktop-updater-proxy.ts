import { getDesktopUpdaterDownloadProxyUrl } from '@/lib/release-urls';

export interface DesktopUpdaterManifestPlatform {
  signature?: string;
  url?: string;
  [key: string]: unknown;
}

export interface DesktopUpdaterManifest {
  version?: string;
  notes?: string;
  pub_date?: string;
  platforms?: Record<string, DesktopUpdaterManifestPlatform>;
  [key: string]: unknown;
}

const GITHUB_RELEASES_HOST = 'github.com';
const RELEASE_DOWNLOAD_SEGMENT = '/releases/download/';

export function isRepositorySlug(value: string | null | undefined) {
  return /^[^/\s]+\/[^/\s]+$/.test(value?.trim() || '');
}

export function normalizeRepositorySlug(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim();
  return typeof normalized === 'string' && isRepositorySlug(normalized)
    ? normalized
    : null;
}

export function normalizeGithubRef(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || /\s/.test(normalized)) {
    return null;
  }

  return normalized;
}

export function buildGithubRawBranchFileUrl(
  repository: string,
  branch: string,
  filePath: string
) {
  return `https://raw.githubusercontent.com/${repository}/${branch}/${filePath}`;
}

export function buildGithubReleaseDownloadUrl(
  repository: string,
  tagName: string,
  assetName: string
) {
  return `https://github.com/${repository}/releases/download/${tagName}/${assetName}`;
}

export function isAllowedGithubReleaseAssetUrl(
  targetUrl: string,
  repository: string
) {
  try {
    const parsedUrl = new URL(targetUrl);
    if (
      parsedUrl.protocol !== 'https:' ||
      parsedUrl.host !== GITHUB_RELEASES_HOST
    ) {
      return false;
    }

    return parsedUrl.pathname.startsWith(
      `/${repository}${RELEASE_DOWNLOAD_SEGMENT}`
    );
  } catch (_) {
    return false;
  }
}

export function parseDesktopUpdaterManifest(
  payload: string
): DesktopUpdaterManifest {
  const parsed = JSON.parse(payload) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Unexpected desktop updater manifest payload.');
  }

  return parsed as DesktopUpdaterManifest;
}

export function rewriteDesktopUpdaterManifestUrls(
  manifest: DesktopUpdaterManifest,
  {
    proxyBaseUrl,
    repository,
  }: {
    proxyBaseUrl: string;
    repository: string;
  }
): DesktopUpdaterManifest {
  if (!manifest.platforms || typeof manifest.platforms !== 'object') {
    return manifest;
  }

  const nextPlatforms = Object.fromEntries(
    Object.entries(manifest.platforms).map(([platformKey, platformValue]) => {
      if (!platformValue || typeof platformValue !== 'object') {
        return [platformKey, platformValue];
      }

      const targetUrl =
        typeof platformValue.url === 'string' ? platformValue.url.trim() : '';
      if (!targetUrl) {
        return [platformKey, platformValue];
      }

      return [
        platformKey,
        {
          ...platformValue,
          url: getDesktopUpdaterDownloadProxyUrl({
            baseUrl: proxyBaseUrl,
            repository,
            targetUrl,
          }),
        },
      ];
    })
  );

  return {
    ...manifest,
    platforms: nextPlatforms,
  };
}
