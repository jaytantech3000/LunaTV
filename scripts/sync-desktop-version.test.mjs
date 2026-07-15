import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(
  repositoryRoot,
  'scripts',
  'sync-desktop-version.mjs'
);
const updaterConfigScriptPath = path.join(
  repositoryRoot,
  'scripts',
  'sync-updater-config.mjs'
);
const targetFiles = [
  'package.json',
  'src-tauri/tauri.conf.json',
  'Cargo.toml',
  'src/lib/version.ts',
  'VERSION.txt',
];
const expectedUpdaterEndpoints = [
  'https://raw.githubusercontent.com/example/LunaTV/desktop-updater/latest.json',
  'https://proxy.example.test/api/desktop/updater/latest?repo=example%2FLunaTV&branch=desktop-updater',
];

async function createFixture(version, eol = '\n') {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), 'lunatv-sync-desktop-version-')
  );
  const withEol = (content) => content.replace(/\n/g, eol);

  await writeFixtureFile(
    fixtureRoot,
    'src/config/desktop-release.json',
    withEol(
      `${JSON.stringify({
        desktopVersion: version,
        releaseRepository: 'example/LunaTV',
        updaterBranch: 'desktop-updater',
      })}\n`
    )
  );
  await writeFixtureFile(
    fixtureRoot,
    'package.json',
    withEol(
      `${JSON.stringify(
        { name: 'fixture', version, private: true },
        null,
        2
      )}\n`
    )
  );
  await writeFixtureFile(
    fixtureRoot,
    'src-tauri/tauri.conf.json',
    withEol(`${JSON.stringify({ productName: 'Fixture', version }, null, 2)}\n`)
  );
  await writeFixtureFile(
    fixtureRoot,
    'Cargo.toml',
    withEol(
      `[workspace]\nmembers = []\n\n[workspace.package]\nversion = "${version}"\n`
    )
  );
  await writeFixtureFile(
    fixtureRoot,
    'src/lib/version.ts',
    withEol(
      `/* eslint-disable no-console */\n\nconst CURRENT_VERSION = '${version}';\n\nexport { CURRENT_VERSION };\n`
    )
  );
  await writeFixtureFile(fixtureRoot, 'VERSION.txt', withEol(`${version}\n`));

  return fixtureRoot;
}

async function writeFixtureFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

function runSync(projectRoot, version) {
  const args = version ? [scriptPath, '--version', version] : [scriptPath];

  return spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
  });
}

function runUpdaterConfigSync(projectRoot) {
  return spawnSync(process.execPath, [updaterConfigScriptPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      LUNATV_DESKTOP_RELEASE_PROXY_BASE_URL: 'https://proxy.example.test/',
      LUNATV_RELEASE_REPOSITORY: 'example/LunaTV',
      LUNATV_UPDATER_BRANCH: 'desktop-updater',
    },
  });
}

async function snapshotTargets(root) {
  return Object.fromEntries(
    await Promise.all(
      targetFiles.map(async (relativePath) => {
        const filePath = path.join(root, relativePath);
        const [content, metadata] = await Promise.all([
          readFile(filePath),
          stat(filePath),
        ]);

        return [
          relativePath,
          {
            hash: createHash('sha256').update(content).digest('hex'),
            mtimeMs: metadata.mtimeMs,
          },
        ];
      })
    )
  );
}

async function withFixture(version, callback, eol) {
  const fixtureRoot = await createFixture(version, eol);

  try {
    await callback(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

await withFixture('1.2.3', async (fixtureRoot) => {
  const packageJsonPath = path.join(fixtureRoot, 'package.json');
  const tauriConfigPath = path.join(fixtureRoot, 'src-tauri/tauri.conf.json');
  const packageJson =
    '{"metadata":{"version":"nested-package-version"},"version":"1.2.3","name":"fixture"}\r\n';
  const tauriConfig =
    '{"bundle":{"metadata":{"version":"nested-tauri-version"}},"version":"1.2.3","productName":"Fixture"}\r\n';

  await Promise.all([
    writeFile(packageJsonPath, packageJson, 'utf8'),
    writeFile(tauriConfigPath, tauriConfig, 'utf8'),
  ]);

  const before = await snapshotTargets(fixtureRoot);
  const result = runSync(fixtureRoot);
  const after = await snapshotTargets(fixtureRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    after,
    before,
    'aligned nested-before-root JSON must not rewrite any target file'
  );
  assert.equal(await readFile(packageJsonPath, 'utf8'), packageJson);
  assert.equal(await readFile(tauriConfigPath, 'utf8'), tauriConfig);
});

await withFixture('1.2.3', async (fixtureRoot) => {
  const packageJsonPath = path.join(fixtureRoot, 'package.json');
  const tauriConfigPath = path.join(fixtureRoot, 'src-tauri/tauri.conf.json');
  const packageJson =
    '{"metadata":{"version":"nested-package-version"},"version":"1.2.3","name":"fixture"}\r\n';
  const tauriConfig =
    '{"bundle":{"metadata":{"version":"nested-tauri-version"}},"version":"1.2.3","productName":"Fixture"}\r\n';

  await Promise.all([
    writeFile(packageJsonPath, packageJson, 'utf8'),
    writeFile(tauriConfigPath, tauriConfig, 'utf8'),
  ]);

  const result = runSync(fixtureRoot, '2.3.4');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(packageJsonPath, 'utf8'),
    '{"metadata":{"version":"nested-package-version"},"version":"2.3.4","name":"fixture"}\r\n',
    'the only changed package.json bytes must be the root version literal'
  );
  assert.equal(
    await readFile(tauriConfigPath, 'utf8'),
    '{"bundle":{"metadata":{"version":"nested-tauri-version"}},"version":"2.3.4","productName":"Fixture"}\r\n',
    'the only changed tauri.conf.json bytes must be the root version literal'
  );
});

await withFixture('1.2.3', async (fixtureRoot) => {
  const versionModulePath = path.join(fixtureRoot, 'src/lib/version.ts');
  const noncanonicalVersionModule =
    "// preserve this CRLF-formatted module\r\nexport const CURRENT_VERSION = '1.2.3';\r\n";

  await writeFile(versionModulePath, noncanonicalVersionModule, 'utf8');

  const before = await snapshotTargets(fixtureRoot);
  const result = runSync(fixtureRoot);
  const after = await snapshotTargets(fixtureRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    after,
    before,
    'a semantically aligned noncanonical CRLF version.ts must not be rewritten'
  );
  assert.equal(
    await readFile(versionModulePath, 'utf8'),
    noncanonicalVersionModule
  );
});

await withFixture('1.2.3', async (fixtureRoot) => {
  const versionModulePath = path.join(fixtureRoot, 'src/lib/version.ts');
  const conflictingVersionModule =
    "export const CURRENT_VERSION = '1.2.3';\r\nexport const CURRENT_VERSION = '2.3.4';\r\n";

  await writeFile(versionModulePath, conflictingVersionModule, 'utf8');

  const result = runSync(fixtureRoot);
  const updatedVersionModule = await readFile(versionModulePath, 'utf8');

  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(updatedVersionModule, conflictingVersionModule);
  assert.match(updatedVersionModule, /CURRENT_VERSION = '1\.2\.3'/);
});

await withFixture('1.2.3', async (fixtureRoot) => {
  const tauriConfigPath = path.join(fixtureRoot, 'src-tauri/tauri.conf.json');
  const noncanonicalTauriConfig = [
    '{',
    '  "plugins" : {',
    '    "updater" : {',
    '      "windows" : { "installMode" : "quiet" },',
    `      "endpoints" : ${JSON.stringify(expectedUpdaterEndpoints)}`,
    '    }',
    '  },',
    '  "version" : "1.2.3",',
    '  "productName" : "Fixture"',
    '}',
    '',
  ].join('\r\n');

  await writeFile(tauriConfigPath, noncanonicalTauriConfig, 'utf8');

  const before = await snapshotTargets(fixtureRoot);
  const result = runUpdaterConfigSync(fixtureRoot);
  const after = await snapshotTargets(fixtureRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    after,
    before,
    'semantically aligned noncanonical CRLF updater endpoints must not rewrite any target file'
  );
  assert.equal(
    await readFile(tauriConfigPath, 'utf8'),
    noncanonicalTauriConfig
  );
});

await withFixture('1.2.3', async (fixtureRoot) => {
  const tauriConfigPath = path.join(fixtureRoot, 'src-tauri/tauri.conf.json');
  const staleTauriConfig = [
    '{ "version" : "1.2.3", "plugins" : { "updater" : {',
    '  "windows" : { "installMode" : "quiet" },',
    '  "endpoints" : [ "https://obsolete.example.test/latest.json" ]',
    '} }, "productName" : "Fixture" }',
    '',
  ].join('\r\n');

  await writeFile(tauriConfigPath, staleTauriConfig, 'utf8');

  const before = await snapshotTargets(fixtureRoot);
  const result = runUpdaterConfigSync(fixtureRoot);
  const after = await snapshotTargets(fixtureRoot);
  const updatedTauriConfig = await readFile(tauriConfigPath, 'utf8');

  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(
    after['src-tauri/tauri.conf.json'].hash,
    before['src-tauri/tauri.conf.json'].hash,
    'changed updater endpoints must write tauri.conf.json'
  );
  assert.deepEqual(
    JSON.parse(updatedTauriConfig).plugins.updater.endpoints,
    expectedUpdaterEndpoints
  );
  for (const relativePath of targetFiles.filter(
    (relativePath) => relativePath !== 'src-tauri/tauri.conf.json'
  )) {
    assert.deepEqual(after[relativePath], before[relativePath]);
  }
});

console.log('sync-desktop-version review regression tests passed');
