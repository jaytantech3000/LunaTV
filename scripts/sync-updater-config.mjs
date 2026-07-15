#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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

function isJsonPropertyNamed(property, name) {
  return (
    ts.isPropertyAssignment(property) &&
    ((ts.isIdentifier(property.name) && property.name.text === name) ||
      (ts.isStringLiteral(property.name) && property.name.text === name))
  );
}

function readUniqueJsonProperty(object, name, pathDescription, filePath) {
  const properties = object.properties.filter((property) =>
    isJsonPropertyNamed(property, name)
  );

  if (properties.length !== 1) {
    const problem = properties.length === 0 ? 'missing' : 'duplicate';
    throw new Error(
      `Could not resolve an unambiguous ${pathDescription}.${name} in ${filePath}: ${problem} property`
    );
  }

  return properties[0].initializer;
}

function readUpdaterEndpointsField(filePath, content) {
  try {
    JSON.parse(content);
  } catch {
    throw new Error(`Could not parse strict JSON in ${filePath}`);
  }

  const sourceFile = ts.parseJsonText(filePath, content);
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`Could not parse JSON in ${filePath}`);
  }

  const rootObject = sourceFile.statements[0]?.expression;
  if (!rootObject || !ts.isObjectLiteralExpression(rootObject)) {
    throw new Error(`Could not resolve an unambiguous plugins structure in ${filePath}`);
  }

  const plugins = readUniqueJsonProperty(rootObject, 'plugins', 'root', filePath);
  if (!ts.isObjectLiteralExpression(plugins)) {
    throw new Error(`Invalid plugins structure in ${filePath}: expected an object`);
  }

  const updater = readUniqueJsonProperty(plugins, 'updater', 'plugins', filePath);
  if (!ts.isObjectLiteralExpression(updater)) {
    throw new Error(
      `Invalid plugins.updater structure in ${filePath}: expected an object`
    );
  }

  const endpoints = readUniqueJsonProperty(
    updater,
    'endpoints',
    'plugins.updater',
    filePath
  );
  if (!ts.isArrayLiteralExpression(endpoints)) {
    throw new Error(
      `Invalid plugins.updater.endpoints structure in ${filePath}: expected an array`
    );
  }

  if (!endpoints.elements.every(ts.isStringLiteral)) {
    throw new Error(
      `Invalid plugins.updater.endpoints structure in ${filePath}: expected string endpoints`
    );
  }

  return {
    end: endpoints.end,
    start: endpoints.getStart(sourceFile),
    values: endpoints.elements.map((element) => element.text),
  };
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
  const currentEndpoints = readUpdaterEndpointsField(configPath, content);

  if (
    currentEndpoints.values.length === endpoints.length &&
    currentEndpoints.values.every((endpoint, index) => endpoint === endpoints[index])
  ) {
    console.log(`Synced updater endpoints: ${endpoints.join(', ')}`);
    return;
  }

  await fs.writeFile(
    configPath,
    `${content.slice(0, currentEndpoints.start)}${JSON.stringify(
      endpoints
    )}${content.slice(currentEndpoints.end)}`,
    'utf8'
  );

  console.log(`Synced updater endpoints: ${endpoints.join(', ')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
