#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function resolveWindowsArch(targetTriple) {
  if (targetTriple.includes('x86_64')) {
    return 'x64';
  }

  if (targetTriple.includes('aarch64')) {
    return 'arm64';
  }

  return targetTriple.split('-')[0];
}

function escapePowerShellLiteral(value) {
  return value.replaceAll("'", "''");
}

function createZip({ sourceDir, outputZipPath }) {
  const parentDir = path.dirname(sourceDir);
  const directoryName = path.basename(sourceDir);

  if (process.platform === 'win32') {
    execFileSync(
      'pwsh',
      [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `Compress-Archive -LiteralPath '${escapePowerShellLiteral(sourceDir)}' -DestinationPath '${escapePowerShellLiteral(outputZipPath)}' -CompressionLevel Optimal -Force`,
      ],
      { stdio: 'inherit' }
    );
    return;
  }

  execFileSync('zip', ['-r', outputZipPath, directoryName], {
    cwd: parentDir,
    stdio: 'inherit',
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

try {
  const args = parseArgs(process.argv.slice(2));
  const tauriConfig = readJson(path.join(projectRoot, 'src-tauri', 'tauri.conf.json'));
  const targetTriple = args.get('target-triple')
    || execFileSync('rustc', ['--print', 'host-tuple'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
  const releaseDir = path.resolve(
    projectRoot,
    args.get('release-dir') || path.join('target', 'release')
  );
  const bundleDir = path.resolve(
    projectRoot,
    args.get('bundle-dir') || path.join(releaseDir, 'bundle')
  );
  const appExecutable = path.resolve(
    projectRoot,
    args.get('app-executable') || path.join(releaseDir, 'lunatv-desktop-shell.exe')
  );
  const sidecarExecutable = path.resolve(
    projectRoot,
    args.get('sidecar')
      || path.join(
        projectRoot,
        'src-tauri',
        'binaries',
        `moontv-local-service-${targetTriple}.exe`
      )
  );

  if (!existsSync(appExecutable)) {
    throw new Error(`Missing Windows app executable: ${appExecutable}`);
  }

  if (!existsSync(sidecarExecutable)) {
    throw new Error(`Missing Windows sidecar executable: ${sidecarExecutable}`);
  }

  const architecture = resolveWindowsArch(targetTriple);
  const portableBaseName = `${tauriConfig.productName}_${tauriConfig.version}_${architecture}_portable`;
  const portableDir = path.join(bundleDir, 'portable');
  const stagingDir = path.join(portableDir, portableBaseName);
  const outputZipPath = path.join(portableDir, `${portableBaseName}.zip`);
  const appRuntimeName = `${tauriConfig.productName}.exe`;
  const sidecarRuntimeName = 'moontv-local-service.exe';

  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(outputZipPath, { force: true });
  mkdirSync(stagingDir, { recursive: true });

  copyFileSync(appExecutable, path.join(stagingDir, appRuntimeName));
  copyFileSync(sidecarExecutable, path.join(stagingDir, sidecarRuntimeName));

  const readmePath = path.join(stagingDir, 'README.txt');
  writeFileSync(
    readmePath,
    [
      `${tauriConfig.productName} Portable`,
      '',
      `Run "${appRuntimeName}" to start the app.`,
      `Keep "${sidecarRuntimeName}" in the same folder as the app executable.`,
      '',
      'This build is unsigned and intended for internal testing.',
      '',
    ].join('\n'),
    'utf8'
  );

  createZip({
    sourceDir: stagingDir,
    outputZipPath,
  });

  const stat = statSync(outputZipPath);
  rmSync(stagingDir, { recursive: true, force: true });

  console.log(`Created Windows portable bundle at ${outputZipPath} (${stat.size} bytes)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
