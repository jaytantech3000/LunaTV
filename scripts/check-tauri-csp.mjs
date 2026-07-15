#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const configPath = resolve('src-tauri/tauri.conf.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const security = config.app?.security;

if (!security || typeof security.csp !== 'object' || security.csp === null) {
  throw new Error(
    'Expected app.security.csp to be a structured production CSP.'
  );
}

if (
  !security.devCsp ||
  typeof security.devCsp !== 'object' ||
  security.devCsp === null
) {
  throw new Error(
    'Expected app.security.devCsp to be a structured development CSP.'
  );
}

const productionScriptSources = security.csp['script-src'] ?? [];
if (productionScriptSources.includes("'unsafe-eval'")) {
  throw new Error('Production script-src must not allow unsafe-eval.');
}

if (productionScriptSources.includes("'unsafe-inline'")) {
  throw new Error('Production script-src must not allow unsafe-inline.');
}

if (!(security.csp['style-src'] ?? []).includes("'unsafe-inline'")) {
  throw new Error(
    'Production style-src must retain unsafe-inline for audited React style attributes.'
  );
}

for (const directive of [
  'base-uri',
  'connect-src',
  'default-src',
  'font-src',
  'form-action',
  'frame-ancestors',
  'img-src',
  'manifest-src',
  'media-src',
  'object-src',
  'script-src',
  'style-src',
  'worker-src',
]) {
  if (!Array.isArray(security.csp[directive])) {
    throw new Error(`Production CSP must define ${directive}.`);
  }
}

for (const [directive, source] of [
  ['connect-src', 'ipc:'],
  ['connect-src', 'http://ipc.localhost'],
  ['connect-src', 'http://127.0.0.1:8787'],
  ['img-src', 'data:'],
  ['img-src', 'blob:'],
  ['media-src', 'blob:'],
  ['worker-src', 'blob:'],
]) {
  if (!(security.csp[directive] ?? []).includes(source)) {
    throw new Error(`Production ${directive} must include ${source}.`);
  }
}

for (const directive of ['connect-src', 'img-src', 'media-src']) {
  for (const source of ['http:', 'https:']) {
    if (!(security.csp[directive] ?? []).includes(source)) {
      throw new Error(
        `Production ${directive} must retain ${source} for configurable upstream services.`
      );
    }
  }
}

if ((security.csp['frame-ancestors'] ?? []).join(' ') !== "'none'") {
  throw new Error('Production frame-ancestors must be none.');
}

if ((security.csp['object-src'] ?? []).join(' ') !== "'none'") {
  throw new Error('Production object-src must be none.');
}

const developmentScriptSources = security.devCsp['script-src'] ?? [];
for (const source of ["'unsafe-eval'", "'unsafe-inline'"]) {
  if (!developmentScriptSources.includes(source)) {
    throw new Error(
      `Development script-src must include ${source} for Next HMR.`
    );
  }
}

const developmentConnectSources = security.devCsp['connect-src'] ?? [];
if (!developmentConnectSources.includes('ws://127.0.0.1:3000')) {
  throw new Error(
    'Development connect-src must include ws://127.0.0.1:3000 for Next HMR.'
  );
}

if (security.dangerousDisableAssetCspModification) {
  throw new Error('Tauri asset CSP modification must remain enabled.');
}

console.log('Tauri CSP contract passed.');
