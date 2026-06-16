#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  assertValidSemver,
  parseCliArgs,
  parseReleaseVersionFromTag,
  readDesktopReleaseMetadata,
} from './desktop-release-utils.mjs';

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function writeJson(filePath, document) {
  await fs.writeFile(
    filePath,
    `${JSON.stringify(document, null, 2)}\n`,
    'utf8'
  );
}

async function syncWorkspaceCargoVersion(projectRoot, version) {
  const cargoTomlPath = path.join(projectRoot, 'Cargo.toml');
  const content = await fs.readFile(cargoTomlPath, 'utf8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  let inWorkspacePackage = false;
  let updated = false;

  const updatedLines = lines.map((line) => {
    const trimmedLine = line.trim();

    if (/^\[.*\]$/.test(trimmedLine)) {
      inWorkspacePackage = trimmedLine === '[workspace.package]';
      return line;
    }

    if (inWorkspacePackage && /^\s*version\s*=\s*"/.test(line) && !updated) {
      updated = true;
      return line.replace(/(\s*version\s*=\s*")[^"]+(".*)/, `$1${version}$2`);
    }

    return line;
  });

  if (!updated) {
    throw new Error('Could not find [workspace.package] version field');
  }

  await fs.writeFile(cargoTomlPath, updatedLines.join(eol), 'utf8');
}

async function syncVersionModule(projectRoot, version) {
  const versionModulePath = path.join(projectRoot, 'src', 'lib', 'version.ts');
  const content = `/* eslint-disable no-console */\n\nconst CURRENT_VERSION = '${version}';\n\nexport { CURRENT_VERSION };\n`;

  await fs.writeFile(versionModulePath, content, 'utf8');
}

async function syncVersionText(projectRoot, version) {
  const versionTextPath = path.join(projectRoot, 'VERSION.txt');
  await fs.writeFile(versionTextPath, `${version}\n`, 'utf8');
}

function resolveVersion(args, metadata) {
  const explicitVersion = args.get('version');
  if (explicitVersion) {
    return assertValidSemver(explicitVersion, 'desktop release version');
  }

  const releaseTag = args.get('tag');
  if (releaseTag) {
    return assertValidSemver(
      parseReleaseVersionFromTag(releaseTag),
      'desktop release version'
    );
  }

  return assertValidSemver(metadata.desktopVersion, 'desktop base version');
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const metadata = await readDesktopReleaseMetadata(projectRoot);
  const version = resolveVersion(args, metadata);

  const packageJsonPath = path.join(projectRoot, 'package.json');
  const tauriConfigPath = path.join(
    projectRoot,
    'src-tauri',
    'tauri.conf.json'
  );
  const packageJson = await readJson(packageJsonPath);
  const tauriConfig = await readJson(tauriConfigPath);

  packageJson.version = version;
  tauriConfig.version = version;

  await Promise.all([
    writeJson(packageJsonPath, packageJson),
    writeJson(tauriConfigPath, tauriConfig),
    syncWorkspaceCargoVersion(projectRoot, version),
    syncVersionModule(projectRoot, version),
    syncVersionText(projectRoot, version),
  ]);

  console.log(`Synced desktop version: ${version}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
