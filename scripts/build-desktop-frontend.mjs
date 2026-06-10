#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { reportGitHubError } from './ci-annotations.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const outputDir = join(projectRoot, 'desktop-shell-dist');
const legacyExportDir = join(projectRoot, 'out');
const tempDir = join(projectRoot, '.desktop-build-temp');
const desktopDistDir = join(projectRoot, '.next-desktop');
const temporarilyMovedPaths = [];

const desktopEnv = {
  ...process.env,
  NEXT_BUILD_TARGET: 'desktop',
  NEXT_PUBLIC_APP_TARGET: 'desktop',
  NEXT_PUBLIC_STORAGE_TYPE: 'localstorage',
  NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8787',
  NEXT_PUBLIC_MEDIA_PROXY_BASE_URL: 'http://127.0.0.1:8787',
  NEXT_PUBLIC_DESKTOP_LOCAL_DOWNLOAD_RUNTIME: 'true',
  NEXT_PUBLIC_FLUID_SEARCH: 'true',
  NEXT_PUBLIC_ENABLE_ADMIN_PANEL: 'false',
};

function moveForDesktopBuild(relativePath, tempName) {
  const sourcePath = join(projectRoot, relativePath);
  if (!existsSync(sourcePath)) {
    return;
  }

  const targetPath = join(tempDir, tempName);
  mkdirSync(dirname(targetPath), { recursive: true });
  rmSync(targetPath, {
    force: true,
    recursive: true,
  });
  renameSync(sourcePath, targetPath);
  temporarilyMovedPaths.push({
    sourcePath,
    targetPath,
  });
}

function restoreMovedPaths() {
  for (const entry of temporarilyMovedPaths.reverse()) {
    if (!existsSync(entry.targetPath)) {
      continue;
    }

    rmSync(entry.sourcePath, {
      force: true,
      recursive: true,
    });
    mkdirSync(dirname(entry.sourcePath), { recursive: true });
    renameSync(entry.targetPath, entry.sourcePath);
  }

  rmSync(tempDir, {
    force: true,
    recursive: true,
  });
}

function resolveDesktopExportDir() {
  if (existsSync(legacyExportDir)) {
    return legacyExportDir;
  }

  if (existsSync(join(desktopDistDir, 'index.html'))) {
    return desktopDistDir;
  }

  return null;
}

function runPnpm(args, env) {
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/d', '/s', '/c', `pnpm ${args.join(' ')}`], {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });
    return;
  }

  execFileSync('pnpm', args, {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });
}

let exitCode = 0;

try {
  moveForDesktopBuild('src/app/api', 'src-app-api');
  moveForDesktopBuild('src/middleware.ts', 'src-middleware.ts');
  moveForDesktopBuild('.next-build', 'next-build');

  rmSync(legacyExportDir, {
    force: true,
    recursive: true,
  });
  rmSync(desktopDistDir, {
    force: true,
    recursive: true,
  });

  runPnpm(['gen:manifest'], desktopEnv);
  runPnpm(['exec', 'next', 'build'], desktopEnv);

  const desktopExportDir = resolveDesktopExportDir();
  if (!desktopExportDir) {
    throw new Error(
      `Missing exported desktop frontend at ${legacyExportDir} or ${desktopDistDir}`
    );
  }

  rmSync(outputDir, {
    force: true,
    recursive: true,
  });
  mkdirSync(outputDir, { recursive: true });
  cpSync(desktopExportDir, outputDir, {
    recursive: true,
  });

  console.log(`Prepared desktop frontend dist at ${outputDir}`);
} catch (error) {
  reportGitHubError('desktop-build-frontend', error);
  exitCode = error?.status ?? 1;
} finally {
  restoreMovedPaths();
}

if (exitCode !== 0) {
  process.exit(exitCode);
}
