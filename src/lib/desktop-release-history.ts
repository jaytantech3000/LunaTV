import { changelog } from '@/lib/changelog';
import { DESKTOP_UPSTREAM_VERSION } from '@/lib/desktop-release';
import { buildGithubReleaseDownloadUrl } from '@/lib/desktop-updater-proxy';
import {
  getDesktopReleaseTagName,
  getDesktopUpdaterManifestProxyUrl,
  getProjectPageUrl,
  getReleaseRepository,
} from '@/lib/release-urls';
import { compareSemver } from '@/lib/semver';

const DESKTOP_RELEASE_TAG_PREFIX = 'desktop-v';
const DESKTOP_RELEASE_MANIFEST_NAME = 'latest.json';
const GITHUB_API_BASE = 'https://api.github.com';
const DESKTOP_RELEASE_HISTORY_REQUEST_TIMEOUT_MS = 3000;

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

function isValidSemverVersion(value: string | null | undefined) {
  const normalizedValue = value?.trim();
  if (!normalizedValue) {
    return false;
  }

  try {
    compareSemver(normalizedValue, normalizedValue);
    return true;
  } catch (_) {
    return false;
  }
}

export function isDesktopReleaseLineVersion(value: string | null | undefined) {
  const normalizedValue = value?.trim();
  if (!normalizedValue || !isValidSemverVersion(normalizedValue)) {
    return false;
  }

  try {
    return compareSemver(normalizedValue, DESKTOP_UPSTREAM_VERSION) > 0;
  } catch (_) {
    return false;
  }
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

function createTimedAbortSignal(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, DESKTOP_RELEASE_HISTORY_REQUEST_TIMEOUT_MS);
  const abortFromParent = () => {
    controller.abort();
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else if (parentSignal) {
    parentSignal.addEventListener('abort', abortFromParent, {
      once: true,
    });
  }

  return {
    signal: controller.signal,
    cleanup() {
      globalThis.clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
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

function compareDesktopReleaseHistoryItems(
  left: DesktopReleaseHistoryItem,
  right: DesktopReleaseHistoryItem
) {
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
}

function normalizePublishedAtDate(value: string | null | undefined) {
  const normalizedValue = value?.trim();
  if (!normalizedValue) {
    return null;
  }

  const timestamp = Date.parse(`${normalizedValue}T00:00:00Z`);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

export function buildLocalDesktopReleaseHistoryFallback({
  currentVersion,
  repository = getReleaseRepository(),
  manifestProxyBaseUrl,
}: {
  currentVersion?: string | null;
  repository?: string;
  manifestProxyBaseUrl?: string;
} = {}): DesktopReleaseHistoryItem[] {
  if (!isRepositorySlug(repository)) {
    return [];
  }

  const releaseMetadata = new Map<string, string | null>();

  changelog.forEach((entry) => {
    if (!isDesktopReleaseLineVersion(entry.version)) {
      return;
    }

    releaseMetadata.set(
      entry.version,
      normalizePublishedAtDate(entry.date) || null
    );
  });

  const normalizedCurrentVersion = currentVersion?.trim();
  if (
    normalizedCurrentVersion &&
    isDesktopReleaseLineVersion(normalizedCurrentVersion) &&
    !releaseMetadata.has(normalizedCurrentVersion)
  ) {
    releaseMetadata.set(normalizedCurrentVersion, null);
  }

  return Array.from(releaseMetadata.entries())
    .map(([version, publishedAt]) => {
      const tagName = getDesktopReleaseTagName(version);
      const manifestUrl =
        getDesktopUpdaterManifestProxyUrl({
          baseUrl: manifestProxyBaseUrl,
          repository,
          tagName,
        }) ||
        buildGithubReleaseDownloadUrl(
          repository,
          tagName,
          DESKTOP_RELEASE_MANIFEST_NAME
        );

      return {
        id: tagName,
        version,
        tagName,
        name: `v${version}`,
        notes: null,
        prerelease: version.includes('-'),
        publishedAt,
        htmlUrl: `${getProjectPageUrl(repository)}/releases/tag/${tagName}`,
        manifestUrl,
      };
    })
    .sort(compareDesktopReleaseHistoryItems);
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

  const request = createTimedAbortSignal(signal);

  try {
    const response = await fetch(getDesktopReleaseGithubApiUrl(repository), {
      signal: request.signal,
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
  } finally {
    request.cleanup();
  }
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
    .sort(compareDesktopReleaseHistoryItems);
}
