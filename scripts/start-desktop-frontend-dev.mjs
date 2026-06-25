#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const desktopEnv = {
  ...process.env,
  ENABLE_PWA_DEV: process.env.ENABLE_PWA_DEV || 'true',
  NEXT_PUBLIC_APP_TARGET: process.env.NEXT_PUBLIC_APP_TARGET || 'desktop',
  NEXT_PUBLIC_STORAGE_TYPE:
    process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
  NEXT_PUBLIC_API_BASE_URL:
    process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8787',
  NEXT_PUBLIC_MEDIA_PROXY_BASE_URL:
    process.env.NEXT_PUBLIC_MEDIA_PROXY_BASE_URL || 'http://127.0.0.1:8787',
  NEXT_PUBLIC_DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY:
    process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY || 'true',
  NEXT_PUBLIC_FLUID_SEARCH: process.env.NEXT_PUBLIC_FLUID_SEARCH || 'true',
  NEXT_PUBLIC_ENABLE_ADMIN_PANEL:
    process.env.NEXT_PUBLIC_ENABLE_ADMIN_PANEL || 'false',
};

const child =
  process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', 'pnpm dev'], {
        cwd: projectRoot,
        env: desktopEnv,
        stdio: 'inherit',
      })
    : spawn('pnpm', ['dev'], {
        cwd: projectRoot,
        env: desktopEnv,
        stdio: 'inherit',
      });

const forwardSignal = (signal) => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
};

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('error', (error) => {
  console.error(
    `Failed to start desktop frontend dev server: ${error.message}`
  );
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
