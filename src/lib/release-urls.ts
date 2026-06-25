import {
  DESKTOP_RELEASE_BRANCH,
  DESKTOP_RELEASE_REPOSITORY,
  DESKTOP_UPDATER_BRANCH,
} from '@/lib/desktop-release';
import { getRuntimeConfig } from '@/lib/runtime-config';

const DEFAULT_RELEASE_REPOSITORY = DESKTOP_RELEASE_REPOSITORY;
const DEFAULT_RELEASE_BRANCH = DESKTOP_RELEASE_BRANCH;
const DEFAULT_UPDATER_BRANCH = DESKTOP_UPDATER_BRANCH;
const DESKTOP_RELEASE_PROXY_PATHS = {
  releases: '/api/desktop/releases',
  updaterVersion: '/api/desktop/updater/version',
  updaterManifest: '/api/desktop/updater/latest',
  updaterDownload: '/api/desktop/updater/download',
} as const;

function readNextPublicEnvValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function normalizeBaseUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.replace(/\/+$/, '') : '';
}

function toSearchParams(
  searchParams: Record<string, string | null | undefined>
) {
  const nextSearchParams = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
    const normalizedValue = value?.trim();
    if (!normalizedValue) {
      return;
    }

    nextSearchParams.set(key, normalizedValue);
  });

  return nextSearchParams;
}

export function getReleaseRepository() {
  return (
    readNextPublicEnvValue('NEXT_PUBLIC_RELEASE_REPOSITORY') ||
    DEFAULT_RELEASE_REPOSITORY
  );
}

export function getReleaseBranch() {
  return (
    readNextPublicEnvValue('NEXT_PUBLIC_RELEASE_BRANCH') ||
    DEFAULT_RELEASE_BRANCH
  );
}

export function getUpdaterBranch() {
  return (
    readNextPublicEnvValue('NEXT_PUBLIC_UPDATER_BRANCH') ||
    DEFAULT_UPDATER_BRANCH
  );
}

export function getDesktopReleaseProxyBaseUrl() {
  return normalizeBaseUrl(
    getRuntimeConfig().DESKTOP_RELEASE_PROXY_BASE_URL ||
      readNextPublicEnvValue('NEXT_PUBLIC_DESKTOP_RELEASE_PROXY_BASE_URL')
  );
}

function buildDesktopReleaseProxyUrl(
  path: string,
  searchParams: Record<string, string | null | undefined>,
  baseUrl = getDesktopReleaseProxyBaseUrl()
) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return '';
  }

  const queryString = toSearchParams(searchParams).toString();
  return `${normalizedBaseUrl}${path}${queryString ? `?${queryString}` : ''}`;
}

export function getProjectPageUrl(repository = getReleaseRepository()) {
  return `https://github.com/${repository}`;
}

export function getReleasePageUrl(repository = getReleaseRepository()) {
  return `${getProjectPageUrl(repository)}/releases`;
}

export function getVersionFileUrl(
  repository = getReleaseRepository(),
  branch = getUpdaterBranch()
) {
  return `https://raw.githubusercontent.com/${repository}/${branch}/VERSION.txt`;
}

export function getChangelogFileUrl(
  locale: 'zh-CN' | 'en' = 'zh-CN',
  repository = getReleaseRepository(),
  branch = getReleaseBranch()
) {
  const changelogFile = locale === 'en' ? 'CHANGELOG.en' : 'CHANGELOG';
  return `https://raw.githubusercontent.com/${repository}/${branch}/${changelogFile}`;
}

export function getLatestUpdaterManifestUrl(
  repository = getReleaseRepository(),
  branch = getUpdaterBranch()
) {
  return `https://raw.githubusercontent.com/${repository}/${branch}/latest.json`;
}

export function getDesktopReleaseTagName(version: string) {
  const normalizedVersion = version.trim();
  return normalizedVersion ? `desktop-v${normalizedVersion}` : '';
}

export function getDesktopReleaseHistoryProxyUrl(
  baseUrl = getDesktopReleaseProxyBaseUrl(),
  repository = getReleaseRepository()
) {
  return buildDesktopReleaseProxyUrl(
    DESKTOP_RELEASE_PROXY_PATHS.releases,
    {
      repo: repository,
    },
    baseUrl
  );
}

export function getDesktopUpdaterVersionProxyUrl(
  baseUrl = getDesktopReleaseProxyBaseUrl(),
  repository = getReleaseRepository(),
  branch = getUpdaterBranch()
) {
  return buildDesktopReleaseProxyUrl(
    DESKTOP_RELEASE_PROXY_PATHS.updaterVersion,
    {
      repo: repository,
      branch,
    },
    baseUrl
  );
}

export function getDesktopUpdaterManifestProxyUrl({
  baseUrl = getDesktopReleaseProxyBaseUrl(),
  repository = getReleaseRepository(),
  branch,
  tagName,
}: {
  baseUrl?: string;
  repository?: string;
  branch?: string;
  tagName?: string;
}) {
  return buildDesktopReleaseProxyUrl(
    DESKTOP_RELEASE_PROXY_PATHS.updaterManifest,
    {
      repo: repository,
      branch: tagName ? null : branch || getUpdaterBranch(),
      tag: tagName || null,
    },
    baseUrl
  );
}

export function getDesktopUpdaterDownloadProxyUrl({
  baseUrl = getDesktopReleaseProxyBaseUrl(),
  repository = getReleaseRepository(),
  targetUrl,
}: {
  baseUrl?: string;
  repository?: string;
  targetUrl: string;
}) {
  return buildDesktopReleaseProxyUrl(
    DESKTOP_RELEASE_PROXY_PATHS.updaterDownload,
    {
      repo: repository,
      target: targetUrl,
    },
    baseUrl
  );
}
