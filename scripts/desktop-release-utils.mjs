#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DESKTOP_RELEASE_METADATA_PATH = path.join(
  'src',
  'config',
  'desktop-release.json'
);

const SEMVER_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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

export function parseSemver(version) {
  const normalizedVersion = version.trim();
  const match = normalizedVersion.match(SEMVER_PATTERN);
  if (!match) {
    throw new Error(`Invalid version: ${version}`);
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: parsePrerelease(match[4]),
  };
}

export function compareSemver(leftVersion, rightVersion) {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);

  if (left.major !== right.major) {
    return compareNumbers(left.major, right.major);
  }

  if (left.minor !== right.minor) {
    return compareNumbers(left.minor, right.minor);
  }

  if (left.patch !== right.patch) {
    return compareNumbers(left.patch, right.patch);
  }

  return comparePrerelease(left.prerelease, right.prerelease);
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

export function tryParseReleaseVersionFromTag(tag) {
  try {
    return parseReleaseVersionFromTag(tag);
  } catch {
    return null;
  }
}

function compareNumbers(left, right) {
  if (left > right) {
    return 1;
  }

  if (left < right) {
    return -1;
  }

  return 0;
}

function parsePrerelease(rawPrerelease) {
  if (!rawPrerelease) {
    return [];
  }

  return rawPrerelease.split('.').map((identifier) => {
    if (/^\d+$/.test(identifier)) {
      return Number.parseInt(identifier, 10);
    }

    return identifier;
  });
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }

  if (left.length === 0) {
    return 1;
  }

  if (right.length === 0) {
    return -1;
  }

  const limit = Math.max(left.length, right.length);

  for (let index = 0; index < limit; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];

    if (leftIdentifier === undefined) {
      return -1;
    }

    if (rightIdentifier === undefined) {
      return 1;
    }

    if (leftIdentifier === rightIdentifier) {
      continue;
    }

    const leftIsNumeric = typeof leftIdentifier === 'number';
    const rightIsNumeric = typeof rightIdentifier === 'number';

    if (leftIsNumeric && rightIsNumeric) {
      return compareNumbers(leftIdentifier, rightIdentifier);
    }

    if (leftIsNumeric) {
      return -1;
    }

    if (rightIsNumeric) {
      return 1;
    }

    return leftIdentifier > rightIdentifier ? 1 : -1;
  }

  return 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
