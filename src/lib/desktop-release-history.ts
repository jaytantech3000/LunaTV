import { getReleaseRepository } from '@/lib/release-urls';
import { compareSemver } from '@/lib/semver';

const DESKTOP_RELEASE_TAG_PREFIX = 'desktop-v';
const DESKTOP_RELEASE_MANIFEST_NAME = 'latest.json';
const GITHUB_API_BASE = 'https://api.github.com';

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

function isRepositorySlug(value: string) {
  return /^[^/\s]+\/[^/\s]+$/.test(value.trim());
}

function readGithubApiErrorMessage(payload: unknown, fallback: string) {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof payload.message === 'string'
  ) {
    return payload.message;
  }

  return fallback;
}

function tryParseJson<T>(value: string): T | null {
  if (!value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch (_) {
    return null;
  }
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

export function getDesktopReleaseGithubApiUrl(
  repository = getReleaseRepository()
) {
  return `${GITHUB_API_BASE}/repos/${repository}/releases?per_page=100`;
}

export async function fetchDesktopReleaseHistoryFromGithub({
  signal,
  repository = getReleaseRepository(),
}: {
  signal?: AbortSignal;
  repository?: string;
} = {}): Promise<DesktopReleaseHistoryItem[]> {
  if (!isRepositorySlug(repository)) {
    throw new Error('Invalid desktop release repository configuration.');
  }

  const response = await fetch(getDesktopReleaseGithubApiUrl(repository), {
    signal,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });
  const responseText = await response.text();
  const payload = tryParseJson<unknown>(responseText);

  if (!response.ok) {
    throw new Error(
      `GitHub API error ${response.status}: ${readGithubApiErrorMessage(
        payload,
        responseText.slice(0, 500) || `HTTP ${response.status}`
      )}`
    );
  }

  if (!Array.isArray(payload)) {
    throw new Error('Unexpected desktop release payload.');
  }

  return normalizeDesktopReleaseHistory(payload as GithubReleasePayload[]);
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
