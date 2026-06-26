#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

import {
  assertValidSemver,
  parseCliArgs,
  parseReleaseVersionFromTag,
  readDesktopReleaseMetadata,
} from './desktop-release-utils.mjs';

const GITHUB_API_BASE = 'https://api.github.com';

function readEnvValue(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getAccessToken() {
  return readEnvValue('GITHUB_TOKEN') || readEnvValue('GH_TOKEN');
}

function getRepository(metadata, args) {
  return (
    args.get('repo') ||
    readEnvValue('GITHUB_REPOSITORY') ||
    readEnvValue('LUNATV_RELEASE_REPOSITORY') ||
    metadata.releaseRepository
  );
}

function buildHeaders(token, extraHeaders = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'LunaTV-Desktop-Release-Asset-Normalizer',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extraHeaders,
  };
}

async function githubRequest(url, token, options = {}) {
  const headers = buildHeaders(token, options.headers);
  const hasRawBody =
    options.body instanceof Uint8Array || Buffer.isBuffer(options.body);
  const body =
    options.body === undefined
      ? undefined
      : hasRawBody
      ? options.body
      : JSON.stringify(options.body);

  if (options.body !== undefined && !hasRawBody && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body,
  });

  if (response.ok) {
    return response;
  }

  if (response.status === 404) {
    return null;
  }

  const message = await response.text();
  throw new Error(
    `GitHub API request failed (${response.status} ${response.statusText}): ${message}`
  );
}

async function getReleaseByTag(repository, tag, token) {
  const response = await githubRequest(
    `${GITHUB_API_BASE}/repos/${repository}/releases/tags/${encodeURIComponent(
      tag
    )}`,
    token
  );

  if (!response) {
    throw new Error(`Release not found for tag: ${tag}`);
  }

  return response.json();
}

async function downloadReleaseAssetText(asset, token) {
  const response = await fetch(asset.url, {
    method: 'GET',
    headers: buildHeaders(token, {
      Accept: 'application/octet-stream',
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Failed to download ${asset.name} (${response.status} ${response.statusText}): ${message}`
    );
  }

  return response.text();
}

async function renameReleaseAsset(repository, assetId, nextName, token) {
  const response = await githubRequest(
    `${GITHUB_API_BASE}/repos/${repository}/releases/assets/${assetId}`,
    token,
    {
      method: 'PATCH',
      body: {
        name: nextName,
      },
    }
  );

  return response.json();
}

async function deleteReleaseAsset(repository, assetId, token) {
  await githubRequest(
    `${GITHUB_API_BASE}/repos/${repository}/releases/assets/${assetId}`,
    token,
    {
      method: 'DELETE',
    }
  );
}

async function uploadReleaseAsset(release, name, content, token) {
  const uploadBaseUrl = String(release.upload_url || '').replace(/\{.*$/, '');
  if (!uploadBaseUrl) {
    throw new Error('Release upload URL is unavailable');
  }

  const response = await fetch(
    `${uploadBaseUrl}?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: buildHeaders(token, {
        'Content-Type': 'application/json; charset=utf-8',
      }),
      body: Buffer.from(content, 'utf8'),
    }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Failed to upload ${name} (${response.status} ${response.statusText}): ${message}`
    );
  }

  return response.json();
}

function isPlatformNormalizedAssetName(name) {
  return (
    name.includes('_macos-arm64') ||
    name.includes('_macos-x64') ||
    name.includes('_windows-arm64') ||
    name.includes('_windows-x64')
  );
}

function normalizeArchitecture(architecture) {
  switch (architecture) {
    case 'aarch64':
    case 'arm64':
      return 'arm64';
    case 'x86_64':
    case 'x64':
      return 'x64';
    default:
      return null;
  }
}

function normalizeSuffix(suffix) {
  if (suffix === '_portable.zip') {
    return '-portable.zip';
  }

  return suffix;
}

function resolvePlatformFromSuffix(suffix) {
  if (suffix === '.dmg' || suffix.startsWith('.app.tar.gz')) {
    return 'macos';
  }

  if (
    suffix.startsWith('-setup.exe') ||
    suffix.startsWith('.msi') ||
    suffix.endsWith('portable.zip')
  ) {
    return 'windows';
  }

  return null;
}

function buildNormalizedAssetName(assetName, releaseVersion) {
  if (!assetName.startsWith('LunaTV.Desktop_')) {
    return null;
  }

  if (isPlatformNormalizedAssetName(assetName)) {
    return assetName;
  }

  const match = assetName.match(
    /^LunaTV\.Desktop_(?:(.+?)_)?(aarch64|arm64|x64|x86_64)(\.dmg|\.app\.tar\.gz(?:\.sig)?|-setup\.exe(?:\.sig)?|\.msi(?:\.sig)?|-portable\.zip|_portable\.zip)$/
  );
  if (!match) {
    return null;
  }

  const [, embeddedVersion, rawArchitecture, rawSuffix] = match;
  const architecture = normalizeArchitecture(rawArchitecture);
  const platform = resolvePlatformFromSuffix(rawSuffix);
  if (!architecture || !platform) {
    return null;
  }

  const version = embeddedVersion || releaseVersion;
  const suffix = normalizeSuffix(rawSuffix);
  return `LunaTV.Desktop_${version}_${platform}-${architecture}${suffix}`;
}

function buildRenamePlan(assets, releaseVersion) {
  const currentNames = new Set(assets.map((asset) => asset.name));
  const plannedNames = new Set();

  return assets.flatMap((asset) => {
    const nextName = buildNormalizedAssetName(asset.name, releaseVersion);
    if (!nextName || nextName === asset.name) {
      return [];
    }

    if (currentNames.has(nextName)) {
      throw new Error(
        `Release already contains a conflicting normalized asset name: ${nextName}`
      );
    }

    if (plannedNames.has(nextName)) {
      throw new Error(`Duplicate normalized asset name detected: ${nextName}`);
    }

    plannedNames.add(nextName);
    return [
      {
        asset,
        nextName,
      },
    ];
  });
}

function replaceAssetNameInUrl(url, renameMap) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/');
    const currentName = decodeURIComponent(segments.at(-1) || '');
    const nextName = renameMap.get(currentName);
    if (!nextName) {
      return url;
    }

    segments[segments.length - 1] = encodeURIComponent(nextName);
    parsed.pathname = segments.join('/');
    return parsed.toString();
  } catch {
    return url;
  }
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function updateLatestJsonUrls(sourceText, renameMap) {
  const parsed = JSON.parse(sourceText);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid latest.json payload');
  }

  const platforms =
    parsed.platforms && typeof parsed.platforms === 'object'
      ? parsed.platforms
      : {};

  for (const entry of Object.values(platforms)) {
    if (!entry || typeof entry !== 'object' || typeof entry.url !== 'string') {
      continue;
    }

    entry.url = replaceAssetNameInUrl(entry.url, renameMap);
  }

  return serializeJson(parsed);
}

function logRenamePlan(renamePlan) {
  if (renamePlan.length === 0) {
    console.log('No desktop release assets require normalization.');
    return;
  }

  console.log('Desktop release asset normalization plan:');
  for (const entry of renamePlan) {
    console.log(`- ${entry.asset.name} -> ${entry.nextName}`);
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.has('help')) {
    console.log(
      'Usage: node scripts/normalize-desktop-release-assets.mjs --tag <desktop-release-tag> [--version <version>] [--repo <owner/name>] [--dry-run]'
    );
    return;
  }

  const token = getAccessToken();
  if (!token) {
    throw new Error('Missing GITHUB_TOKEN or GH_TOKEN');
  }

  const metadata = await readDesktopReleaseMetadata(process.cwd());
  const repository = getRepository(metadata, args);
  const releaseTag = args.get('tag') || readEnvValue('GITHUB_REF_NAME');
  if (!releaseTag) {
    throw new Error('Missing release tag. Pass --tag or set GITHUB_REF_NAME.');
  }

  const releaseVersion = assertValidSemver(
    args.get('version') || parseReleaseVersionFromTag(releaseTag),
    'desktop release version'
  );
  const dryRun = args.get('dry-run') === 'true';

  const release = await getReleaseByTag(repository, releaseTag, token);
  const latestJsonAsset = release.assets.find(
    (asset) => asset.name === 'latest.json'
  );
  if (!latestJsonAsset) {
    throw new Error(`Release ${releaseTag} does not contain latest.json`);
  }

  const renamePlan = buildRenamePlan(release.assets, releaseVersion);
  const renameMap = new Map(
    renamePlan.map((entry) => [entry.asset.name, entry.nextName])
  );
  const latestJsonSource = await downloadReleaseAssetText(
    latestJsonAsset,
    token
  );
  const nextLatestJsonSource = updateLatestJsonUrls(
    latestJsonSource,
    renameMap
  );
  const latestJsonChanged = nextLatestJsonSource !== latestJsonSource;

  logRenamePlan(renamePlan);
  if (!latestJsonChanged) {
    console.log('latest.json already references normalized asset URLs.');
  } else {
    console.log(
      'latest.json URLs will be rewritten to the normalized asset names.'
    );
  }

  if (dryRun) {
    console.log('Dry run complete. No release assets were modified.');
    return;
  }

  for (const entry of renamePlan) {
    await renameReleaseAsset(repository, entry.asset.id, entry.nextName, token);
  }

  if (latestJsonChanged) {
    await deleteReleaseAsset(repository, latestJsonAsset.id, token);
    await uploadReleaseAsset(
      release,
      'latest.json',
      nextLatestJsonSource,
      token
    );
  }

  console.log(
    `Normalized ${renamePlan.length} desktop release asset(s) for ${releaseTag}.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
