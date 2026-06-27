#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseCliArgs } from './desktop-release-utils.mjs';

function getOutputPath(args) {
  return args.get('output') || path.join(process.cwd(), 'download-site-dist');
}

function getDataPath(args) {
  return (
    args.get('data') ||
    path.join(process.cwd(), 'download-site', 'assets', 'releases.template.json')
  );
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.has('help')) {
    console.log(
      'Usage: node scripts/build-download-site.mjs [--data <releases.json>] [--output <dir>]'
    );
    return;
  }

  const projectRoot = process.cwd();
  const sourceRoot = path.join(projectRoot, 'download-site');
  const outputRoot = path.resolve(projectRoot, getOutputPath(args));
  const dataPath = path.resolve(projectRoot, getDataPath(args));

  await rm(outputRoot, {
    force: true,
    recursive: true,
  });
  await mkdir(outputRoot, {
    recursive: true,
  });

  await cp(sourceRoot, outputRoot, {
    recursive: true,
  });
  await mkdir(path.join(outputRoot, 'data'), {
    recursive: true,
  });
  await cp(dataPath, path.join(outputRoot, 'data', 'releases.json'));
  await writeFile(path.join(outputRoot, '.nojekyll'), '\n', 'utf8');

  const data = await readFile(path.join(outputRoot, 'data', 'releases.json'), 'utf8');
  const parsed = JSON.parse(data);
  console.log(
    JSON.stringify(
      {
        outputRoot,
        releaseCount: Array.isArray(parsed.releases) ? parsed.releases.length : 0,
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
