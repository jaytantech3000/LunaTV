import { createHmac, timingSafeEqual } from 'crypto';

export type DesktopAssetKey =
  | 'mac-arm64'
  | 'mac-x64'
  | 'win-x64-setup'
  | 'win-x64-portable';

export type LocalServicePlatformKey =
  | 'mac-arm64'
  | 'mac-x64'
  | 'linux-x64'
  | 'linux-arm64'
  | 'win-x64';

export interface GitHubReleaseAsset {
  browser_download_url: string;
  content_type?: string;
  id: number;
  name: string;
  size: number;
}

export interface GitHubRelease {
  assets: GitHubReleaseAsset[];
  created_at?: string;
  id: number;
  name?: string | null;
  prerelease: boolean;
  published_at?: string | null;
  tag_name: string;
  target_commitish?: string | null;
}

export interface DesktopReleaseConfig {
  repo: string;
  tagPrefix?: string;
  targetCommitish?: string;
}

export interface DesktopReleaseAssetInfo {
  asset: GitHubReleaseAsset;
  key: DesktopAssetKey;
  label: string;
}

interface LocalServiceReleaseConfig {
  repo: string;
  tag: string;
}

interface DesktopAssetRule {
  key: DesktopAssetKey;
  label: string;
  matcher: (name: string) => boolean;
}

interface DesktopDownloadSignatureInput {
  assetId: number;
  expires: number;
  releaseId: number;
}

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_TIMEOUT_MS = 10000;
const DEFAULT_SIGNED_DOWNLOAD_TTL_MS = 10 * 60 * 1000;
const DEFAULT_LOCAL_SERVICE_RELEASE_TAG = 'local-service-latest';
const LOCAL_SERVICE_RELEASE_CHANNELS = ['luna', 'nova'] as const;

const DESKTOP_ASSET_RULES: DesktopAssetRule[] = [
  {
    key: 'mac-arm64',
    label: 'macOS Apple Silicon',
    matcher: (name) => name.includes('aarch64.dmg'),
  },
  {
    key: 'mac-x64',
    label: 'macOS Intel',
    matcher: (name) => name.includes('x64.dmg'),
  },
  {
    key: 'win-x64-setup',
    label: 'Windows 安装包',
    matcher: (name) => name.includes('x64-setup.exe'),
  },
  {
    key: 'win-x64-portable',
    label: 'Windows 便携版',
    matcher: (name) => name.includes('portable.zip'),
  },
];

const LOCAL_SERVICE_PLATFORM_LABELS: Record<LocalServicePlatformKey, string> = {
  'linux-arm64': 'Linux ARM64',
  'linux-x64': 'Linux x64',
  'mac-arm64': 'macOS Apple Silicon',
  'mac-x64': 'macOS Intel',
  'win-x64': 'Windows x64',
};

const LOCAL_SERVICE_URL_ENV_MAP: Record<LocalServicePlatformKey, string> = {
  'linux-arm64': 'LOCAL_SERVICE_RELEASE_URL_LINUX_ARM64',
  'linux-x64': 'LOCAL_SERVICE_RELEASE_URL_LINUX_X64',
  'mac-arm64': 'LOCAL_SERVICE_RELEASE_URL_MAC_ARM64',
  'mac-x64': 'LOCAL_SERVICE_RELEASE_URL_MAC_X64',
  'win-x64': 'LOCAL_SERVICE_RELEASE_URL_WIN_X64',
};

const LOCAL_SERVICE_RELEASE_ASSET_NAMES: Record<
  LocalServicePlatformKey,
  string
> = {
  'linux-arm64': 'lunatv-server-linux-arm64',
  'linux-x64': 'lunatv-server-linux-x64',
  'mac-arm64': 'lunatv-server-mac-arm64',
  'mac-x64': 'lunatv-server-mac-x64',
  'win-x64': 'lunatv-server-win-x64.exe',
};

function getClientDownloadSigningSecret(): string | null {
  const explicit = process.env.CLIENT_DOWNLOAD_SIGNING_SECRET?.trim();
  if (explicit) {
    return explicit;
  }

  return process.env.NODE_ENV === 'production'
    ? null
    : 'dev-client-download-signing-secret';
}

function base64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildDesktopDownloadSignaturePayload(
  input: DesktopDownloadSignatureInput
): string {
  return `desktop\n${input.releaseId}\n${input.assetId}\n${input.expires}`;
}

function normalizeAssetName(name: string): string {
  return name.trim().toLowerCase();
}

function isValidGitHubRepo(repo: string): boolean {
  const repoParts = repo.split('/');
  return (
    repoParts.length === 2 && repoParts.every((part) => Boolean(part.trim()))
  );
}

function normalizeLocalServiceReleaseChannel(
  value: string | null | undefined
): (typeof LOCAL_SERVICE_RELEASE_CHANNELS)[number] | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return (
    LOCAL_SERVICE_RELEASE_CHANNELS.find((channel) => channel === normalized) ||
    null
  );
}

function getAutoLocalServiceReleaseChannel():
  | (typeof LOCAL_SERVICE_RELEASE_CHANNELS)[number]
  | null {
  const explicitChannel = normalizeLocalServiceReleaseChannel(
    process.env.LOCAL_SERVICE_RELEASE_CHANNEL
  );
  if (explicitChannel) {
    return explicitChannel;
  }

  const deploymentBranch =
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.CF_PAGES_BRANCH ||
    process.env.RAILWAY_GIT_BRANCH ||
    process.env.GITHUB_REF_NAME;

  return normalizeLocalServiceReleaseChannel(deploymentBranch);
}

function getReleaseTimestamp(release: GitHubRelease): number {
  const source = release.published_at || release.created_at;
  if (!source) {
    return 0;
  }

  const timestamp = Date.parse(source);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function fetchGitHubJson<T>(pathname: string): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS);

  try {
    const response = await fetch(`${GITHUB_API_BASE}${pathname}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'LunaTV',
      },
      signal: controller.signal,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getDesktopReleaseConfig(): DesktopReleaseConfig | null {
  const repo = process.env.DESKTOP_RELEASE_REPO?.trim();
  const targetCommitish = process.env.DESKTOP_RELEASE_TARGET_COMMITISH?.trim();
  const tagPrefix = process.env.DESKTOP_RELEASE_TAG_PREFIX?.trim();

  if (!repo || (!targetCommitish && !tagPrefix)) {
    return null;
  }

  if (!isValidGitHubRepo(repo)) {
    return null;
  }

  return {
    repo,
    tagPrefix: tagPrefix || undefined,
    targetCommitish: targetCommitish || undefined,
  };
}

export function matchesDesktopReleaseConfig(
  release: GitHubRelease,
  config: DesktopReleaseConfig
): boolean {
  if (!release.prerelease) {
    return false;
  }

  if (config.tagPrefix && !release.tag_name.startsWith(config.tagPrefix)) {
    return false;
  }

  if (config.targetCommitish) {
    return (release.target_commitish || '').trim() === config.targetCommitish;
  }

  return Boolean(config.tagPrefix);
}

export function selectLatestDesktopRelease(
  releases: GitHubRelease[],
  config: DesktopReleaseConfig
): GitHubRelease | null {
  const matchingReleases = releases
    .filter((release) => matchesDesktopReleaseConfig(release, config))
    .sort(
      (left, right) => getReleaseTimestamp(right) - getReleaseTimestamp(left)
    );

  return matchingReleases[0] || null;
}

export function getDesktopAssetKeyForName(
  name: string
): DesktopAssetKey | null {
  const normalizedName = normalizeAssetName(name);
  const rule = DESKTOP_ASSET_RULES.find((candidate) =>
    candidate.matcher(normalizedName)
  );
  return rule?.key || null;
}

export function getDesktopAssetLabel(key: DesktopAssetKey): string {
  const match = DESKTOP_ASSET_RULES.find((candidate) => candidate.key === key);
  return match?.label || key;
}

export function listDesktopReleaseAssets(release: GitHubRelease): {
  assets: DesktopReleaseAssetInfo[];
  missingAssetKeys: DesktopAssetKey[];
} {
  const assets: DesktopReleaseAssetInfo[] = [];
  const missingAssetKeys: DesktopAssetKey[] = [];

  for (const rule of DESKTOP_ASSET_RULES) {
    const asset = release.assets.find(
      (candidate) => getDesktopAssetKeyForName(candidate.name) === rule.key
    );

    if (!asset) {
      missingAssetKeys.push(rule.key);
      continue;
    }

    assets.push({
      asset,
      key: rule.key,
      label: rule.label,
    });
  }

  return { assets, missingAssetKeys };
}

function getLocalServiceReleaseConfig(): LocalServiceReleaseConfig | null {
  const repo =
    process.env.LOCAL_SERVICE_RELEASE_REPO?.trim() ||
    process.env.DESKTOP_RELEASE_REPO?.trim();
  const explicitTag = process.env.LOCAL_SERVICE_RELEASE_TAG?.trim();
  const autoChannel = getAutoLocalServiceReleaseChannel();
  const tag =
    explicitTag ||
    (autoChannel ? `local-service-${autoChannel}-latest` : null) ||
    DEFAULT_LOCAL_SERVICE_RELEASE_TAG;

  if (!repo || !tag || !isValidGitHubRepo(repo)) {
    return null;
  }

  return { repo, tag };
}

function buildLocalServiceReleaseAssetUrl(
  platform: LocalServicePlatformKey,
  config: LocalServiceReleaseConfig
): string {
  const assetName = LOCAL_SERVICE_RELEASE_ASSET_NAMES[platform];
  return `https://github.com/${
    config.repo
  }/releases/download/${encodeURIComponent(config.tag)}/${encodeURIComponent(
    assetName
  )}`;
}

export function isLocalServicePlatformKey(
  value: string | null | undefined
): value is LocalServicePlatformKey {
  if (!value) {
    return false;
  }

  return value in LOCAL_SERVICE_PLATFORM_LABELS;
}

export function getLocalServicePlatformLabel(
  platform: LocalServicePlatformKey
): string {
  return LOCAL_SERVICE_PLATFORM_LABELS[platform];
}

export function resolveLocalServiceBinaryUrl(
  platform: LocalServicePlatformKey
): string | null {
  const envKey = LOCAL_SERVICE_URL_ENV_MAP[platform];
  const value = process.env[envKey]?.trim();
  if (value) {
    return value;
  }

  const releaseConfig = getLocalServiceReleaseConfig();
  if (!releaseConfig) {
    return null;
  }

  return buildLocalServiceReleaseAssetUrl(platform, releaseConfig);
}

export function getConfiguredLocalServicePlatforms(): LocalServicePlatformKey[] {
  return (
    Object.keys(LOCAL_SERVICE_URL_ENV_MAP) as LocalServicePlatformKey[]
  ).filter((platform) => Boolean(resolveLocalServiceBinaryUrl(platform)));
}

export function signDesktopDownload(
  input: DesktopDownloadSignatureInput
): string | null {
  const secret = getClientDownloadSigningSecret();
  if (!secret) {
    return null;
  }

  return base64Url(
    createHmac('sha256', secret)
      .update(buildDesktopDownloadSignaturePayload(input))
      .digest()
  );
}

export function verifySignedDesktopDownload(
  input: DesktopDownloadSignatureInput & {
    signature: string | null | undefined;
  }
): boolean {
  if (!input.signature) {
    return false;
  }

  const expectedSignature = signDesktopDownload(input);
  if (
    !expectedSignature ||
    expectedSignature.length !== input.signature.length
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(input.signature)
  );
}

export function buildSignedDesktopDownloadPath(input: {
  assetId: number;
  expires?: number;
  releaseId: number;
  ttlMs?: number;
}): string | null {
  const expires =
    input.expires ??
    Date.now() + (input.ttlMs ?? DEFAULT_SIGNED_DOWNLOAD_TTL_MS);
  const signature = signDesktopDownload({
    assetId: input.assetId,
    expires,
    releaseId: input.releaseId,
  });

  if (!signature) {
    return null;
  }

  const searchParams = new URLSearchParams({
    assetId: String(input.assetId),
    expires: String(expires),
    kind: 'desktop',
    releaseId: String(input.releaseId),
    sig: signature,
  });

  return `/api/client-download?${searchParams.toString()}`;
}

export async function fetchDesktopReleaseList(): Promise<GitHubRelease[]> {
  const config = getDesktopReleaseConfig();
  if (!config) {
    throw new Error('Desktop release config missing');
  }

  const releases = await fetchGitHubJson<GitHubRelease[]>(
    `/repos/${config.repo}/releases`
  );
  return Array.isArray(releases) ? releases : [];
}

export async function fetchLatestDesktopRelease(): Promise<GitHubRelease | null> {
  const config = getDesktopReleaseConfig();
  if (!config) {
    return null;
  }

  const releases = await fetchDesktopReleaseList();
  return selectLatestDesktopRelease(releases, config);
}

export async function fetchDesktopReleaseById(
  releaseId: number
): Promise<GitHubRelease | null> {
  const config = getDesktopReleaseConfig();
  if (!config) {
    return null;
  }

  return fetchGitHubJson<GitHubRelease>(
    `/repos/${config.repo}/releases/${releaseId}`
  );
}
