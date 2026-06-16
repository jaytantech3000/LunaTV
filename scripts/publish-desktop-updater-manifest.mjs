#!/usr/bin/env node

import { Buffer } from 'node:buffer';

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

function getUpdaterBranch(metadata, args) {
  return (
    args.get('branch') ||
    readEnvValue('LUNATV_UPDATER_BRANCH') ||
    readEnvValue('NEXT_PUBLIC_UPDATER_BRANCH') ||
    metadata.updaterBranch
  );
}

function buildHeaders(token, extraHeaders = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'LunaTV-Desktop-Updater-Publisher',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extraHeaders,
  };
}

async function githubRequest(url, token, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: buildHeaders(token, options.headers),
    body: options.body ? JSON.stringify(options.body) : undefined,
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

async function getRepositoryInfo(repository, token) {
  const response = await githubRequest(
    `${GITHUB_API_BASE}/repos/${repository}`,
    token
  );
  return response.json();
}

async function getBranchRef(repository, branch, token) {
  const response = await githubRequest(
    `${GITHUB_API_BASE}/repos/${repository}/git/ref/heads/${encodeURIComponent(
      branch
    )}`,
    token
  );

  if (!response) {
    return null;
  }

  return response.json();
}

async function ensureUpdaterBranch(repository, branch, token) {
  const existingRef = await getBranchRef(repository, branch, token);
  if (existingRef) {
    return existingRef;
  }

  const repositoryInfo = await getRepositoryInfo(repository, token);
  const defaultBranch = repositoryInfo.default_branch;
  const defaultBranchRef = await getBranchRef(repository, defaultBranch, token);

  if (!defaultBranchRef?.object?.sha) {
    throw new Error(`Unable to resolve default branch head for ${repository}`);
  }

  const response = await githubRequest(
    `${GITHUB_API_BASE}/repos/${repository}/git/refs`,
    token,
    {
      method: 'POST',
      body: {
        ref: `refs/heads/${branch}`,
        sha: defaultBranchRef.object.sha,
      },
    }
  );

  return response.json();
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

async function downloadReleaseAsset(asset, token) {
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

async function getContentSha(repository, branch, filePath, token) {
  const response = await githubRequest(
    `${GITHUB_API_BASE}/repos/${repository}/contents/${filePath}?ref=${encodeURIComponent(
      branch
    )}`,
    token
  );

  if (!response) {
    return null;
  }

  const payload = await response.json();
  return typeof payload.sha === 'string' ? payload.sha : null;
}

async function upsertBranchFile({
  repository,
  branch,
  filePath,
  content,
  message,
  token,
}) {
  const sha = await getContentSha(repository, branch, filePath, token);
  await githubRequest(
    `${GITHUB_API_BASE}/repos/${repository}/contents/${filePath}`,
    token,
    {
      method: 'PUT',
      body: {
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
      },
    }
  );
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.has('help')) {
    console.log(
      'Usage: node scripts/publish-desktop-updater-manifest.mjs --tag <desktop-release-tag> [--version <version>] [--repo <owner/name>] [--branch <updater-branch>]'
    );
    return;
  }

  const token = getAccessToken();
  if (!token) {
    throw new Error('Missing GITHUB_TOKEN or GH_TOKEN');
  }

  const metadata = await readDesktopReleaseMetadata(process.cwd());
  const repository = getRepository(metadata, args);
  const updaterBranch = getUpdaterBranch(metadata, args);
  const releaseTag = args.get('tag') || readEnvValue('GITHUB_REF_NAME');

  if (!releaseTag) {
    throw new Error('Missing release tag. Pass --tag or set GITHUB_REF_NAME.');
  }

  const version = assertValidSemver(
    args.get('version') || parseReleaseVersionFromTag(releaseTag),
    'desktop release version'
  );
  const release = await getReleaseByTag(repository, releaseTag, token);
  const latestJsonAsset = release.assets.find(
    (asset) => asset.name === 'latest.json'
  );

  if (!latestJsonAsset) {
    throw new Error(`Release ${releaseTag} does not contain latest.json`);
  }

  await ensureUpdaterBranch(repository, updaterBranch, token);

  const latestJson = await downloadReleaseAsset(latestJsonAsset, token);
  const manifestMetadata = {
    version,
    upstreamVersion: metadata.upstreamVersion,
    releaseTag,
    publishedAt: release.published_at || release.created_at || null,
    prerelease: release.prerelease === true,
  };

  await Promise.all([
    upsertBranchFile({
      repository,
      branch: updaterBranch,
      filePath: 'latest.json',
      content: latestJson.endsWith('\n') ? latestJson : `${latestJson}\n`,
      message: `chore(desktop): publish updater manifest for ${version}`,
      token,
    }),
    upsertBranchFile({
      repository,
      branch: updaterBranch,
      filePath: 'VERSION.txt',
      content: `${version}\n`,
      message: `chore(desktop): publish version marker for ${version}`,
      token,
    }),
    upsertBranchFile({
      repository,
      branch: updaterBranch,
      filePath: 'desktop-release.json',
      content: `${JSON.stringify(manifestMetadata, null, 2)}\n`,
      message: `chore(desktop): publish release metadata for ${version}`,
      token,
    }),
  ]);

  console.log(
    `Published desktop updater manifest for ${version} to ${repository}@${updaterBranch}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
