#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_RELEASE_REPOSITORY = 'jaytantech3000/LunaTV';

function readEnvValue(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getReleaseRepository() {
  return (
    readEnvValue('LUNATV_RELEASE_REPOSITORY') ||
    readEnvValue('NEXT_PUBLIC_RELEASE_REPOSITORY') ||
    readEnvValue('GITHUB_REPOSITORY') ||
    DEFAULT_RELEASE_REPOSITORY
  );
}

async function main() {
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, 'src-tauri', 'tauri.conf.json');
  const repository = getReleaseRepository();
  const endpoint = `https://github.com/${repository}/releases/latest/download/latest.json`;
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
