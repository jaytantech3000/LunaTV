#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DESKTOP_RELEASE_METADATA_PATH = path.join(
  'src',
  'config',
  'desktop-release.json'
);

const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseCliArgs(argv) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const nextToken = argv[index + 1];
    if (!nextToken || nextToken.startsWith('--')) {
      args.set(key, 'true');
      continue;
    }

    args.set(key, nextToken);
    index += 1;
  }

  return args;
}

export async function readDesktopReleaseMetadata(projectRoot = process.cwd()) {
  const metadataPath = path.join(projectRoot, DESKTOP_RELEASE_METADATA_PATH);
  const content = await fs.readFile(metadataPath, 'utf8');
  return JSON.parse(content);
}

export function isValidSemver(version) {
  return SEMVER_PATTERN.test(version);
}

export function assertValidSemver(version, label = 'version') {
  if (!isValidSemver(version)) {
    throw new Error(`Invalid ${label}: ${version}`);
  }

  return version;
}

export function parseReleaseVersionFromTag(tag) {
  const normalizedTag = tag.trim();
  const desktopMatch = normalizedTag.match(/^desktop-v(.+)$/);
  if (desktopMatch) {
    return desktopMatch[1];
  }

  const plainMatch = normalizedTag.match(/^v(.+)$/);
  if (plainMatch) {
    return plainMatch[1];
  }

  throw new Error(`Unsupported desktop release tag: ${tag}`);
}

export function buildDesktopReleaseTag(version) {
  return `desktop-v${version}`;
}

export function buildDesktopPrereleaseTitle(version, sequence) {
  return `LunaTV Desktop ${version} Beta ${sequence}`;
}

export function extractDesktopPrereleaseSequence(tag, baseVersion) {
  const match = tag.match(
    new RegExp(`^desktop-v${escapeRegExp(baseVersion)}-beta\\.(\\d+)$`)
  );
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
