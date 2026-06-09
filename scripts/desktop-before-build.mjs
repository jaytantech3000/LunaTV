#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportGitHubError } from './ci-annotations.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const nodeCommand = process.execPath;

function runScript(scriptName, args = []) {
  execFileSync(nodeCommand, [join(__dirname, scriptName), ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  });
}

try {
  runScript('build-desktop-frontend.mjs');
  runScript('sync-desktop-sidecar.mjs', ['--release']);
} catch (error) {
  reportGitHubError('desktop-before-build', error);
  process.exit(error?.status ?? 1);
}
