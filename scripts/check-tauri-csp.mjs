#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const configPath = resolve('src-tauri/tauri.conf.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const security = config.app?.security;
const tauriConfigDirectory = resolve('src-tauri');

const CANONICAL_PRODUCTION_CSP = {
  'base-uri': ["'self'"],
  'connect-src': [
    "'self'",
    'ipc:',
    'http://ipc.localhost',
    'http://127.0.0.1:8787',
    'http:',
    'https:',
  ],
  'default-src': ["'self'"],
  'font-src': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'frame-src': ["'none'"],
  'img-src': ["'self'", 'data:', 'blob:', 'http:', 'https:'],
  'manifest-src': ["'self'"],
  'media-src': ["'self'", 'blob:', 'http:', 'https:'],
  'object-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'worker-src': ["'self'", 'blob:'],
};

const CANONICAL_DEVELOPMENT_CSP = {
  ...CANONICAL_PRODUCTION_CSP,
  'connect-src': [
    ...CANONICAL_PRODUCTION_CSP['connect-src'],
    'ws://127.0.0.1:3000',
  ],
  'script-src': ["'self'", "'unsafe-eval'", "'unsafe-inline'"],
};

function assertCanonicalPolicy(policyName, actual, expected) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    throw new Error(
      `Expected app.security.${policyName} to be a structured CSP.`
    );
  }

  const actualDirectives = Object.keys(actual).sort();
  const expectedDirectives = Object.keys(expected).sort();

  if (JSON.stringify(actualDirectives) !== JSON.stringify(expectedDirectives)) {
    throw new Error(
      `${policyName} must define exactly the canonical directive set; expected ${expectedDirectives.join(
        ', '
      )} but found ${actualDirectives.join(', ')}.`
    );
  }

  for (const directive of expectedDirectives) {
    const actualSources = actual[directive];
    const expectedSources = expected[directive];

    if (!Array.isArray(actualSources)) {
      throw new Error(
        `${policyName} ${directive} must be an array of sources.`
      );
    }

    if (new Set(actualSources).size !== actualSources.length) {
      throw new Error(
        `${policyName} ${directive} must not contain duplicate sources.`
      );
    }

    const sortedActualSources = [...actualSources].sort();
    const sortedExpectedSources = [...expectedSources].sort();

    if (
      JSON.stringify(sortedActualSources) !==
      JSON.stringify(sortedExpectedSources)
    ) {
      throw new Error(
        `${policyName} ${directive} must equal the canonical sources ${expectedSources.join(
          ' '
        )}.`
      );
    }
  }
}

if (!security || typeof security !== 'object' || Array.isArray(security)) {
  throw new Error('Expected app.security to be an object.');
}

assertCanonicalPolicy('csp', security.csp, CANONICAL_PRODUCTION_CSP);
assertCanonicalPolicy('devCsp', security.devCsp, CANONICAL_DEVELOPMENT_CSP);

if (Object.hasOwn(security, 'dangerousDisableAssetCspModification')) {
  throw new Error(
    'Production must not configure dangerousDisableAssetCspModification.'
  );
}

const headers = security.headers;
if (headers !== undefined) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new Error('app.security.headers must be an object when configured.');
  }

  for (const headerName of Object.keys(headers)) {
    if (headerName.toLowerCase() === 'content-security-policy') {
      throw new Error(
        'app.security.headers must not define a Content-Security-Policy header that could override the canonical CSP.'
      );
    }
  }
}

const overlayConfigNames = (await readdir(tauriConfigDirectory)).filter(
  (fileName) =>
    /^tauri(?:\.[^.]+)*\.conf\.json$/.test(fileName) &&
    fileName !== 'tauri.conf.json'
);

for (const overlayConfigName of overlayConfigNames) {
  const overlayConfigPath = resolve(tauriConfigDirectory, overlayConfigName);
  const overlayConfig = JSON.parse(await readFile(overlayConfigPath, 'utf8'));

  if (Object.hasOwn(overlayConfig.app ?? {}, 'security')) {
    throw new Error(
      `${overlayConfigName} must not define app.security; overlays must inherit the canonical CSP from tauri.conf.json.`
    );
  }
}

console.log('Tauri CSP contract passed.');
