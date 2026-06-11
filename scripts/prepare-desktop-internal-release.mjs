#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
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

function buildAssetName(artifactName, relativePath, assets) {
  const baseName = path.posix.basename(relativePath);
  if (!assets.some(asset => asset.assetName === baseName)) {
    return baseName;
  }

  return `${artifactName}--${relativePath.replaceAll('/', '--')}`;
}

function isPublishedReleaseAsset(relativePath) {
  return (
    relativePath.endsWith('.dmg') ||
    relativePath.endsWith('.exe') ||
    relativePath.endsWith('.msi') ||
    relativePath.endsWith('.AppImage') ||
    relativePath.endsWith('.deb') ||
    relativePath.endsWith('.rpm')
  );
}

async function stageFile({
  artifactName,
  sourcePath,
  relativePath,
  assetsDir,
  assets,
}) {
  const assetName = buildAssetName(artifactName, relativePath, assets);
  const outputPath = path.join(assetsDir, assetName);

  await fs.copyFile(sourcePath, outputPath);

  const stat = await fs.stat(outputPath);
  assets.push({
    artifactName,
    sourcePath: relativePath,
    assetName,
    size: stat.size,
  });
}

async function collectAssets({
  rootDir,
  currentDir,
  artifactName,
  assetsDir,
  assets,
}) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);
    const relativePath = path
      .relative(rootDir, entryPath)
      .split(path.sep)
      .join('/');

    if (entry.isDirectory()) {
      if (entry.name.endsWith('.app')) {
        continue;
      }

      await collectAssets({
        rootDir,
        currentDir: entryPath,
        artifactName,
        assetsDir,
        assets,
      });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (entry.name === '.DS_Store' || entry.name.endsWith('.sig')) {
      continue;
    }

    if (!isPublishedReleaseAsset(relativePath)) {
      continue;
    }

    await stageFile({
      artifactName,
      sourcePath: entryPath,
      relativePath,
      assetsDir,
      assets,
    });
  }
}

function readJson(filePath) {
  return fs.readFile(filePath, 'utf8').then(content => JSON.parse(content));
}

function getMetadata(version) {
  const runNumber = process.env.GITHUB_RUN_NUMBER || 'local';
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1';
  const runId = process.env.GITHUB_RUN_ID || 'local';
  const repository = process.env.GITHUB_REPOSITORY || 'unknown/unknown';
  const refName = process.env.GITHUB_REF_NAME || 'local';
  const commit = process.env.GITHUB_SHA || 'local';
  const shortCommit = commit.slice(0, 7);
  const tag = `desktop-v${version}-internal-run${runNumber}-a${runAttempt}`;
  const title = `LunaTV Desktop ${version} Internal #${runNumber}.${runAttempt}`;
  const runUrl =
    repository === 'unknown/unknown'
      ? ''
      : `https://github.com/${repository}/actions/runs/${runId}`;

  return {
    version,
    tag,
    title,
    repository,
    refName,
    commit,
    shortCommit,
    runId,
    runNumber,
    runAttempt,
    runUrl,
  };
}

async function writeReleaseOutputs(githubOutputPath, outputs) {
  if (!githubOutputPath) {
    return;
  }

  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  await fs.appendFile(githubOutputPath, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const artifactsRoot = path.resolve(
    projectRoot,
    args.get('artifacts-root') || '.desktop-release/artifacts'
  );
  const outputDir = path.resolve(
    projectRoot,
    args.get('output-dir') || '.desktop-release/dist'
  );
  const githubOutputPath = args.get('github-output') || process.env.GITHUB_OUTPUT || '';
  const assetsDir = path.join(outputDir, 'assets');

  const tauriConfig = await readJson(path.join(projectRoot, 'src-tauri', 'tauri.conf.json'));
  const metadata = getMetadata(tauriConfig.version);

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(assetsDir, { recursive: true });

  const artifactEntries = await fs.readdir(artifactsRoot, { withFileTypes: true });
  const artifactDirs = artifactEntries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (artifactDirs.length === 0) {
    throw new Error(`No downloaded build artifacts found in ${artifactsRoot}`);
  }

  const assets = [];

  for (const artifactName of artifactDirs) {
    await collectAssets({
      rootDir: path.join(artifactsRoot, artifactName),
      currentDir: path.join(artifactsRoot, artifactName),
      artifactName,
      assetsDir,
      assets,
    });
  }

  if (assets.length === 0) {
    throw new Error(`No releasable desktop assets found in ${artifactsRoot}`);
  }

  assets.sort((left, right) => left.assetName.localeCompare(right.assetName));

  const notesLines = [
    '# LunaTV Desktop Internal Release',
    '',
    '> This release is unsigned and intended for internal testing only.',
    '',
    '## Build Metadata',
    '',
    `- Version: \`${metadata.version}\``,
    `- Tag: \`${metadata.tag}\``,
    `- Branch: \`${metadata.refName}\``,
    `- Commit: \`${metadata.shortCommit}\``,
    `- Workflow Run: ${metadata.runUrl || 'local run'}`,
    '- Signing: not applied',
    '- Notarization: not applied',
    '',
    '## Install Notes',
    '',
    '- macOS builds are unsigned and not notarized. Gatekeeper prompts are expected.',
    '- Windows installers are unsigned. SmartScreen warnings are expected.',
    '',
    '## Assets',
    '',
    '- This internal release only includes end-user install packages.',
    ...assets.map(asset => `- \`${asset.assetName}\` (${asset.size} bytes)`),
    '',
  ];

  await fs.writeFile(
    path.join(outputDir, 'RELEASE_NOTES.md'),
    `${notesLines.join('\n')}`,
    'utf8'
  );

  await writeReleaseOutputs(githubOutputPath, {
    tag: metadata.tag,
    title: metadata.title,
    version: metadata.version,
    asset_dir: assetsDir,
  });

  console.log(`Prepared ${assets.length} release assets in ${assetsDir}`);
  console.log(`Release tag: ${metadata.tag}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
