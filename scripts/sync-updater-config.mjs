#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readDesktopReleaseMetadata } from './desktop-release-utils.mjs';

function readEnvValue(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getReleaseRepository(metadata) {
  return (
    readEnvValue('LUNATV_RELEASE_REPOSITORY') ||
    readEnvValue('NEXT_PUBLIC_RELEASE_REPOSITORY') ||
    readEnvValue('GITHUB_REPOSITORY') ||
    metadata.releaseRepository
  );
}

function getUpdaterBranch(metadata) {
  return (
    readEnvValue('LUNATV_UPDATER_BRANCH') ||
    readEnvValue('NEXT_PUBLIC_UPDATER_BRANCH') ||
    metadata.updaterBranch
  );
}

async function main() {
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, 'src-tauri', 'tauri.conf.json');
  const metadata = await readDesktopReleaseMetadata(projectRoot);
  const repository = getReleaseRepository(metadata);
  const updaterBranch = getUpdaterBranch(metadata);
  const endpoint = `https://raw.githubusercontent.com/${repository}/${updaterBranch}/latest.json`;
  const content = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(content);

  if (!config.plugins) {
    config.plugins = {};
  }

  if (!config.plugins.updater) {
    config.plugins.updater = {};
  }

  config.plugins.updater.endpoints = [endpoint];

  await fs.writeFile(
    configPath,
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8'
  );

  console.log(`Synced updater endpoint: ${endpoint}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
