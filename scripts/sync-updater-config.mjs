#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readDesktopReleaseMetadata } from './desktop-release-utils.mjs';

const DEFAULT_DESKTOP_RELEASE_PROXY_BASE_URL = 'https://hkcu.qzz.io';

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

function normalizeBaseUrl(value) {
  const normalized = value?.trim();
  return normalized ? normalized.replace(/\/+$/, '') : '';
}

function getDesktopReleaseProxyBaseUrl() {
  return (
    normalizeBaseUrl(
      readEnvValue('LUNATV_DESKTOP_RELEASE_PROXY_BASE_URL') ||
        readEnvValue('NEXT_PUBLIC_DESKTOP_RELEASE_PROXY_BASE_URL') ||
        readEnvValue('SITE_BASE')
    ) || DEFAULT_DESKTOP_RELEASE_PROXY_BASE_URL
  );
}

async function main() {
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, 'src-tauri', 'tauri.conf.json');
  const metadata = await readDesktopReleaseMetadata(projectRoot);
  const repository = getReleaseRepository(metadata);
  const updaterBranch = getUpdaterBranch(metadata);
  const desktopReleaseProxyBaseUrl = getDesktopReleaseProxyBaseUrl();
  const directEndpoint = `https://raw.githubusercontent.com/${repository}/${updaterBranch}/latest.json`;
  const proxyEndpoint = desktopReleaseProxyBaseUrl
    ? `${desktopReleaseProxyBaseUrl}/api/desktop/updater/latest?repo=${encodeURIComponent(
        repository
      )}&branch=${encodeURIComponent(updaterBranch)}`
    : '';
  const endpoints = Array.from(
    new Set([directEndpoint, proxyEndpoint].filter(Boolean))
  );
  const content = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(content);
  const currentEndpoints = config.plugins?.updater?.endpoints;

  if (
    Array.isArray(currentEndpoints) &&
    currentEndpoints.length === endpoints.length &&
    currentEndpoints.every((endpoint, index) => endpoint === endpoints[index])
  ) {
    console.log(`Synced updater endpoints: ${endpoints.join(', ')}`);
    return;
  }

  if (!config.plugins) {
    config.plugins = {};
  }

  if (!config.plugins.updater) {
    config.plugins.updater = {};
  }

  config.plugins.updater.endpoints = endpoints;

  await fs.writeFile(
    configPath,
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8'
  );

  console.log(`Synced updater endpoints: ${endpoints.join(', ')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
