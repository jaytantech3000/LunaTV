#!/usr/bin/env node

import desktopReleaseTagModule from './desktop-release-tag.js';
import {
  parseCliArgs,
  readDesktopReleaseMetadata,
} from './desktop-release-utils.mjs';

const GITHUB_API_BASE = 'https://api.github.com';
const { buildDesktopReleaseDescriptor } = desktopReleaseTagModule;

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

function getReleaseTag(args) {
  return args.get('tag') || readEnvValue('GITHUB_REF_NAME');
}

function getTargetCommitish(metadata, args) {
  return (
    args.get('target') ||
    readEnvValue('GITHUB_SHA') ||
    readEnvValue('GITHUB_REF_NAME') ||
    metadata.releaseBranch
  );
}

function buildHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'LunaTV-Desktop-Release-Ensurer',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubRequest(url, token, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: buildHeaders(token),
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

async function getReleaseByTag(repository, tagName, token) {
  const response = await githubRequest(
    `${GITHUB_API_BASE}/repos/${repository}/releases/tags/${encodeURIComponent(
      tagName
    )}`,
    token
  );

  if (!response) {
    return null;
  }

  return response.json();
}

async function createRelease({
  repository,
  tagName,
  targetCommitish,
  descriptor,
  token,
}) {
  const response = await githubRequest(
    `${GITHUB_API_BASE}/repos/${repository}/releases`,
    token,
    {
      method: 'POST',
      body: {
        tag_name: tagName,
        target_commitish: targetCommitish,
        name: descriptor.title,
        draft: descriptor.draft,
        prerelease: descriptor.prerelease,
        generate_release_notes: true,
      },
    }
  );

  if (!response) {
    throw new Error(`Failed to create release for tag: ${tagName}`);
  }

  return response.json();
}

async function updateRelease({
  repository,
  releaseId,
  tagName,
  targetCommitish,
  descriptor,
  token,
}) {
  const response = await githubRequest(
    `${GITHUB_API_BASE}/repos/${repository}/releases/${releaseId}`,
    token,
    {
      method: 'PATCH',
      body: {
        tag_name: tagName,
        target_commitish: targetCommitish,
        name: descriptor.title,
        draft: descriptor.draft,
        prerelease: descriptor.prerelease,
      },
    }
  );

  if (!response) {
    throw new Error(`Failed to update release ${releaseId} for tag: ${tagName}`);
  }

  return response.json();
}

async function writeGithubOutput(outputPath, entries) {
  if (!outputPath) {
    return;
  }

  const { appendFile } = await import('node:fs/promises');
  const serializedOutput = Object.entries(entries)
    .map(([key, value]) => `${key}=${String(value)}\n`)
    .join('');
  await appendFile(outputPath, serializedOutput, 'utf8');
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.has('help')) {
    console.log(
      'Usage: node scripts/ensure-desktop-release.mjs --tag <desktop-release-tag> [--repo <owner/name>] [--target <commit-ish>] [--github-output <path>]'
    );
    return;
  }

  const token = getAccessToken();
  if (!token) {
    throw new Error('Missing GITHUB_TOKEN or GH_TOKEN');
  }

  const metadata = await readDesktopReleaseMetadata(process.cwd());
  const repository = getRepository(metadata, args);
  const tagName = getReleaseTag(args);
  if (!tagName) {
    throw new Error('Missing desktop release tag. Pass --tag or set GITHUB_REF_NAME.');
  }

  const descriptor = buildDesktopReleaseDescriptor({ tagName });
  const targetCommitish = getTargetCommitish(metadata, args);
  const existingRelease = await getReleaseByTag(repository, tagName, token);
  const ensuredRelease = existingRelease
    ? await updateRelease({
        repository,
        releaseId: existingRelease.id,
        tagName,
        targetCommitish,
        descriptor,
        token,
      })
    : await createRelease({
        repository,
        tagName,
        targetCommitish,
        descriptor,
        token,
      });

  await writeGithubOutput(args.get('github-output') || process.env.GITHUB_OUTPUT, {
    release_id: ensuredRelease.id,
    release_tag: tagName,
    release_version: descriptor.version,
    release_name: descriptor.title,
    release_prerelease: descriptor.prerelease,
  });

  console.log(
    JSON.stringify(
      {
        id: ensuredRelease.id,
        tagName,
        version: descriptor.version,
        title: descriptor.title,
        prerelease: descriptor.prerelease,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
