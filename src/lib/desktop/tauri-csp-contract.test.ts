import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

type Csp = Record<string, string[]>;

type TauriConfig = {
  app: {
    security: {
      csp: Csp;
      devCsp: Csp;
      headers?: Record<string, unknown>;
      [key: string]: unknown;
    };
  };
};

const projectRoot = process.cwd();
const checkerPath = path.join(projectRoot, 'scripts', 'check-tauri-csp.mjs');

function readTauriConfig(): TauriConfig {
  return JSON.parse(
    readFileSync(path.join(projectRoot, 'src-tauri/tauri.conf.json'), 'utf8')
  ) as TauriConfig;
}

function cloneConfig(): TauriConfig {
  return JSON.parse(JSON.stringify(readTauriConfig())) as TauriConfig;
}

function runCspCheck(
  config: TauriConfig,
  overlayConfigs: Record<string, unknown> = {}
) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'lunatv-tauri-csp-'));

  try {
    const configPath = path.join(fixtureRoot, 'src-tauri', 'tauri.conf.json');
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config));

    for (const [fileName, overlayConfig] of Object.entries(overlayConfigs)) {
      writeFileSync(
        path.join(fixtureRoot, 'src-tauri', fileName),
        JSON.stringify(overlayConfig)
      );
    }

    return spawnSync(process.execPath, [checkerPath], {
      cwd: fixtureRoot,
      encoding: 'utf8',
    });
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
}

function expectRejected(
  result: ReturnType<typeof runCspCheck>,
  reason: RegExp
) {
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(reason);
}

describe('Tauri CSP contract', () => {
  it('accepts the checked-in canonical production and development policies', () => {
    const result = runCspCheck(readTauriConfig());

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Tauri CSP contract passed.');
  });

  it.each(['csp', 'devCsp'] as const)(
    'rejects an extra directive in %s',
    (policyName) => {
      const config = cloneConfig();
      config.app.security[policyName]['prefetch-src'] = ["'self'"];

      expectRejected(runCspCheck(config), new RegExp(policyName));
    }
  );

  it.each(['csp', 'devCsp'] as const)(
    'rejects a missing directive in %s',
    (policyName) => {
      const config = cloneConfig();
      delete config.app.security[policyName]['frame-src'];

      expectRejected(runCspCheck(config), new RegExp(policyName));
    }
  );

  it.each(['csp', 'devCsp'] as const)(
    'rejects a duplicate source in %s',
    (policyName) => {
      const config = cloneConfig();
      config.app.security[policyName]['connect-src'].push('https:');

      expectRejected(runCspCheck(config), new RegExp(policyName));
    }
  );

  it.each([
    ['csp', 'connect-src', 'wss://127.0.0.1:3000'],
    ['csp', 'script-src', "'unsafe-inline'"],
    ['devCsp', 'connect-src', 'wss://127.0.0.1:3000'],
    ['devCsp', 'style-src', "'unsafe-eval'"],
  ] as const)(
    'rejects an unexpected source in %s %s',
    (policyName, directive, source) => {
      const config = cloneConfig();
      config.app.security[policyName][directive].push(source);

      expectRejected(
        runCspCheck(config),
        new RegExp(`${policyName}.*${directive}`)
      );
    }
  );

  it.each([
    ['csp', 'frame-src', "'none'"],
    ['devCsp', 'frame-src', "'none'"],
  ] as const)(
    'requires %s %s to retain its canonical source',
    (policyName, directive, expectedSource) => {
      const config = cloneConfig();
      config.app.security[policyName][directive] = ["'self'"];

      expectRejected(
        runCspCheck(config),
        new RegExp(`${policyName}.*${directive}.*${expectedSource}`)
      );
    }
  );

  it.each(['Content-Security-Policy', 'content-security-policy'])(
    'rejects a %s security header that could override the canonical policy',
    (headerName) => {
      const config = cloneConfig();
      config.app.security.headers = {
        [headerName]: 'default-src *',
      };

      expectRejected(runCspCheck(config), /Content-Security-Policy header/);
    }
  );

  it.each([true, false, ['script-src']])(
    'rejects a configured dangerousDisableAssetCspModification value (%p)',
    (value) => {
      const config = cloneConfig();
      config.app.security.dangerousDisableAssetCspModification = value;

      expectRejected(
        runCspCheck(config),
        /dangerousDisableAssetCspModification/
      );
    }
  );

  it.each([
    ['tauri.windows.conf.json', 'csp', { csp: {} }],
    ['tauri.windows.conf.json', 'devCsp', { devCsp: {} }],
    ['tauri.windows.conf.json', 'headers', { headers: {} }],
    ['tauri.windows.conf.json', 'an arbitrary key', { bypass: true }],
    ['tauri.windows.ci.conf.json', 'csp', { csp: {} }],
    ['tauri.windows.ci.conf.json', 'devCsp', { devCsp: {} }],
    ['tauri.windows.ci.conf.json', 'headers', { headers: {} }],
    ['tauri.windows.ci.conf.json', 'an arbitrary key', { bypass: true }],
  ] as const)(
    'rejects a %s overlay app.security override containing %s',
    (overlayFileName, _securityKey, security) => {
      const result = runCspCheck(readTauriConfig(), {
        [overlayFileName]: {
          app: { security },
        },
      });

      expectRejected(
        result,
        new RegExp(`${overlayFileName.replace(/\./g, '\\.')}.*app\\.security`)
      );
    }
  );
});
