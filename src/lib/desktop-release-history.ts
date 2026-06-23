import { compareSemver } from '@/lib/semver';

const DESKTOP_RELEASE_TAG_PREFIX = 'desktop-v';
const DESKTOP_RELEASE_MANIFEST_NAME = 'latest.json';

export interface GithubReleaseAssetPayload {
  name?: string | null;
  browser_download_url?: string | null;
}

export interface GithubReleasePayload {
  id?: number | string | null;
  tag_name?: string | null;
  name?: string | null;
  body?: string | null;
  draft?: boolean | null;
  prerelease?: boolean | null;
  published_at?: string | null;
  created_at?: string | null;
  html_url?: string | null;
  assets?: GithubReleaseAssetPayload[] | null;
}

export interface DesktopReleaseHistoryItem {
  id: string;
  version: string;
  tagName: string;
  name: string;
  notes: string | null;
  prerelease: boolean;
  publishedAt: string | null;
  htmlUrl: string | null;
  manifestUrl: string;
}

export function extractDesktopReleaseVersion(
  tagName: string | null | undefined
) {
  const normalizedTag = tagName?.trim();
  if (!normalizedTag?.startsWith(DESKTOP_RELEASE_TAG_PREFIX)) {
    return null;
  }

  const version = normalizedTag.slice(DESKTOP_RELEASE_TAG_PREFIX.length).trim();
  if (!version) {
    return null;
  }

  try {
    compareSemver(version, version);
    return version;
  } catch (_) {
    return null;
  }
}

export function findDesktopReleaseManifestUrl(
  assets: GithubReleaseAssetPayload[] | null | undefined
) {
  if (!Array.isArray(assets)) {
    return null;
  }

  const asset = assets.find(
    (item) =>
      item?.name?.trim() === DESKTOP_RELEASE_MANIFEST_NAME &&
      typeof item.browser_download_url === 'string' &&
      item.browser_download_url.trim().length > 0
  );

  return asset?.browser_download_url?.trim() || null;
}

export function normalizeDesktopReleaseHistory(
  releases: GithubReleasePayload[]
): DesktopReleaseHistoryItem[] {
  return releases
    .flatMap((release) => {
      if (release?.draft) {
        return [];
      }

      const tagName = release.tag_name?.trim() || '';
      const version = extractDesktopReleaseVersion(tagName);
      const manifestUrl = findDesktopReleaseManifestUrl(release.assets);

      if (!version || !manifestUrl) {
        return [];
      }

      return [
        {
          id: String(release.id ?? tagName),
          version,
          tagName,
          name: release.name?.trim() || tagName,
          notes: release.body?.trim() || null,
          prerelease: release.prerelease === true,
          publishedAt:
            release.published_at?.trim() || release.created_at?.trim() || null,
          htmlUrl: release.html_url?.trim() || null,
          manifestUrl,
        },
      ];
    })
    .sort((left, right) => {
      const versionOrder = compareSemver(right.version, left.version);
      if (versionOrder !== 0) {
        return versionOrder;
      }

      const leftPublishedAt = left.publishedAt
        ? Date.parse(left.publishedAt)
        : Number.NEGATIVE_INFINITY;
      const rightPublishedAt = right.publishedAt
        ? Date.parse(right.publishedAt)
        : Number.NEGATIVE_INFINITY;

      return rightPublishedAt - leftPublishedAt;
    });
}
