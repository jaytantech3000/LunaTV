#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  assertValidSemver,
  buildDesktopPrereleaseTitle,
  buildDesktopReleaseTag,
  extractDesktopPrereleaseSequence,
  parseCliArgs,
  readDesktopReleaseMetadata,
} from './desktop-release-utils.mjs';

function readEnvValue(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getRepository(metadata, args) {
  return (
    args.get('repo') ||
    readEnvValue('GITHUB_REPOSITORY') ||
    readEnvValue('LUNATV_RELEASE_REPOSITORY') ||
    metadata.releaseRepository
  );
}

function getTargetRef(metadata, args) {
  return (
    args.get('target') ||
    readEnvValue('GITHUB_SHA') ||
    readEnvValue('GITHUB_REF_NAME') ||
    metadata.releaseBranch
  );
}

async function resolveGhExecutable() {
  const explicitPath = readEnvValue('GH_PATH');
  if (explicitPath) {
    return explicitPath;
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const candidate = path.join(
        localAppData,
        'Microsoft',
        'WinGet',
        'Packages',
        'GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe',
        'bin',
        'gh.exe'
      );

      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Fall back to PATH lookup below.
      }
    }
  }

  return 'gh';
}

async function runGhJson(command, args) {
  const { spawn } = await import('node:child_process');
  const ghExecutable = await resolveGhExecutable();

  return new Promise((resolve, reject) => {
    const child = spawn(ghExecutable, [command, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(stderr.trim() || `gh ${command} failed with code ${code}`)
        );
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function runGh(command, args) {
  const { spawn } = await import('node:child_process');
  const ghExecutable = await resolveGhExecutable();

  return new Promise((resolve, reject) => {
    const child = spawn(ghExecutable, [command, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`gh ${command} failed with code ${code}`));
        return;
      }

      resolve();
    });
  });
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.has('help')) {
    console.log(
      'Usage: node scripts/create-desktop-prerelease.mjs [--version <baseVersion>] [--repo <owner/name>] [--target <ref>] [--dry-run]'
    );
    return;
  }

  const metadata = await readDesktopReleaseMetadata(process.cwd());
  const baseVersion = assertValidSemver(
    args.get('version') || metadata.desktopVersion,
    'desktop base version'
  );
  const repository = getRepository(metadata, args);
  const targetRef = getTargetRef(metadata, args);
  const releases = await runGhJson('release', [
    'list',
    '--repo',
    repository,
    '--limit',
    '200',
    '--json',
    'tagName,isPrerelease',
  ]);

  const nextSequence =
    releases
      .filter((release) => release.isPrerelease)
      .map((release) =>
        extractDesktopPrereleaseSequence(release.tagName, baseVersion)
      )
      .filter((sequence) => Number.isInteger(sequence))
      .reduce((maxSequence, sequence) => Math.max(maxSequence, sequence), 0) +
    1;

  const prereleaseVersion = `${baseVersion}-beta.${nextSequence}`;
  const tag = buildDesktopReleaseTag(prereleaseVersion);
  const title = buildDesktopPrereleaseTitle(baseVersion, nextSequence);

  if (args.has('dry-run')) {
    console.log(
      JSON.stringify(
        {
          version: prereleaseVersion,
          tag,
          title,
          repository,
          targetRef,
        },
        null,
        2
      )
    );
    return;
  }

  await runGh('release', [
    'create',
    tag,
    '--repo',
    repository,
    '--target',
    targetRef,
    '--title',
    title,
    '--generate-notes',
    '--prerelease',
  ]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
