#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const isRelease = process.argv.includes('--release');
const targetTriple = execFileSync('rustc', ['--print', 'host-tuple'], {
  cwd: projectRoot,
  encoding: 'utf8',
}).trim();

const profile = isRelease ? 'release' : 'debug';
const sidecarName = process.platform === 'win32'
  ? 'moontv-local-service.exe'
  : 'moontv-local-service';

execFileSync(
  'cargo',
  ['build', '-p', 'moontv-local-service', ...(isRelease ? ['--release'] : [])],
  {
    cwd: projectRoot,
    stdio: 'inherit',
  }
);

const builtBinaryPath = join(projectRoot, 'target', profile, sidecarName);
if (!existsSync(builtBinaryPath)) {
  throw new Error(`Missing built sidecar binary: ${builtBinaryPath}`);
}

const outputDir = join(projectRoot, 'src-tauri', 'binaries');
mkdirSync(outputDir, { recursive: true });

const outputBinaryPath = join(
  outputDir,
  `moontv-local-service-${targetTriple}${process.platform === 'win32' ? '.exe' : ''}`
);

copyFileSync(builtBinaryPath, outputBinaryPath);
if (process.platform !== 'win32') {
  chmodSync(outputBinaryPath, 0o755);
}

console.log(`Synced desktop sidecar to ${outputBinaryPath}`);
