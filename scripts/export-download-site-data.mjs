#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import downloadSiteDataModule from './download-site-data.js';
import {
  parseCliArgs,
  readDesktopReleaseMetadata,
} from './desktop-release-utils.mjs';

const GITHUB_API_BASE = 'https://api.github.com';
const { buildDownloadSitePayload } = downloadSiteDataModule;

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

function getOutputPath(args) {
  return (
    args.get('output') ||
    path.join(process.cwd(), 'download-site-dist', 'data', 'releases.json')
  );
}

function buildHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LunaTV-Download-Site-Exporter',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchGithubReleases(repository, token) {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${repository}/releases?per_page=100`,
    {
      headers: buildHeaders(token),
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Failed to fetch GitHub releases (${response.status} ${response.statusText}): ${message}`
    );
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error('Unexpected GitHub releases payload.');
  }

  return payload;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.has('help')) {
    console.log(
      'Usage: node scripts/export-download-site-data.mjs [--repo <owner/name>] [--output <path>]'
    );
    return;
  }

  const metadata = await readDesktopReleaseMetadata(process.cwd());
  const repository = getRepository(metadata, args);
  const outputPath = getOutputPath(args);
  const releases = await fetchGithubReleases(repository, getAccessToken());
  const payload = buildDownloadSitePayload({
    repository,
    releases,
  });

  await mkdir(path.dirname(outputPath), {
    recursive: true,
  });
  await writeFile(`${outputPath}`, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        outputPath,
        releaseCount: payload.releases.length,
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
