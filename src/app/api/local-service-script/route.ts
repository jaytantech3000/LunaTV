import { readFileSync } from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

import {
  type LocalServicePlatformKey,
  isLocalServicePlatformKey,
  resolveLocalServiceBinaryUrl,
} from '@/lib/client-download';

export const runtime = 'nodejs';

type LocalServiceScriptAction = 'install' | 'stop' | 'uninstall';

const MACOS_LAUNCHD_LABEL = 'io.qzz.lunatv.local-service';
const MACOS_APPLICATION_DIR = '/Applications/LunaTV Local Service';
const MACOS_SUPPORT_DIR = '/Library/Application Support/LunaTV Local Service';
const MACOS_LOG_DIR = '/Library/Logs/LunaTV Local Service';
const LINUX_PACKAGE_NAME = 'lunatv-local-service';
const LINUX_SYSTEM_SERVICE_NAME = 'lunatv-local-service.service';
const LINUX_SYSTEM_INSTALL_ROOT = '/opt/lunatv-local-service';
const LINUX_SYSTEM_CONFIG_DIR = '/etc/lunatv-local-service';
const LINUX_SYSTEM_DATA_DIR = '/var/lib/lunatv-local-service';
const USER_INSTALL_ROOT = '${HOME}/.lunatv';
const WINDOWS_INSTALL_ROOT =
  'Join-Path $env:LOCALAPPDATA "LunaTV Local Service"';
const WINDOWS_RUN_KEY =
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const WINDOWS_RUN_VALUE_NAME = 'LunaTVLocalService';
const WINDOWS_UNINSTALL_KEY =
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LunaTVLocalService';
const WINDOWS_LAUNCHER_NAME = 'run-local-service.vbs';
const DEFAULT_WINDOWS_LAUNCHER_SCRIPT = [
  'Set shell = CreateObject("WScript.Shell")',
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  'installRoot = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\\LunaTV Local Service"',
  'binaryPath = installRoot & "\\bin\\lunatv-server.exe"',
  'configPath = installRoot & "\\config.json"',
  'dataDir = installRoot & "\\data"',
  'sqlitePath = dataDir & "\\moontv-local-service.sqlite3"',
  'If Not fso.FolderExists(dataDir) Then fso.CreateFolder(dataDir)',
  'command = Chr(34) & binaryPath & Chr(34) & " --host 127.0.0.1 --port 8787 --config-path " & Chr(34) & configPath & Chr(34) & " --data-dir " & Chr(34) & dataDir & Chr(34) & " --sqlite-path " & Chr(34) & sqlitePath & Chr(34)',
  'shell.Run command, 0, False',
  '',
].join('\n');

function readBundledFile(relativePath: string, fallback: string): string {
  try {
    return readFileSync(
      path.join(process.cwd(), relativePath),
      'utf8'
    ).trimEnd();
  } catch {
    return fallback;
  }
}

const EMBEDDED_LOCAL_SERVICE_CONFIG = readBundledFile(
  'config.example.json',
  '{}'
);
const EMBEDDED_WINDOWS_LAUNCHER_SCRIPT = readBundledFile(
  path.join('.github', 'local-service', 'windows', WINDOWS_LAUNCHER_NAME),
  DEFAULT_WINDOWS_LAUNCHER_SCRIPT
);

function jsonError(error: string, status: number): Response {
  return NextResponse.json({ error }, { status });
}

function normalizeScriptAction(
  value: string | null
): LocalServiceScriptAction | null {
  if (
    value === null ||
    value === '' ||
    value === 'install' ||
    value === 'stop' ||
    value === 'uninstall'
  ) {
    return (value || 'install') as LocalServiceScriptAction;
  }

  return null;
}

function buildScriptFileName(
  platform: string,
  action: LocalServiceScriptAction
): string {
  const extension = platform === 'win-x64' ? 'ps1' : 'sh';

  if (action === 'install') {
    return `lunatv-local-service-${platform}.${extension}`;
  }

  return `lunatv-local-service-${platform}-${action}.${extension}`;
}

function buildMacStopScript(): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `SERVICE_LABEL="${MACOS_LAUNCHD_LABEL}"`,
    'PLIST_PATH="/Library/LaunchDaemons/${SERVICE_LABEL}.plist"',
    `SYSTEM_BINARY="${MACOS_SUPPORT_DIR}/lunatv-server"`,
    'USER_BINARY="${HOME}/.lunatv/bin/lunatv-server"',
    '',
    'run_as_root() {',
    '  if [ "$(id -u)" -eq 0 ]; then',
    '    "$@"',
    '  else',
    '    sudo "$@"',
    '  fi',
    '}',
    '',
    'if [ -f "$PLIST_PATH" ]; then',
    '  run_as_root launchctl bootout system "$PLIST_PATH" >/dev/null 2>&1 || true',
    'fi',
    '',
    'pkill -f "$SYSTEM_BINARY" >/dev/null 2>&1 || true',
    'pkill -f "$USER_BINARY" >/dev/null 2>&1 || true',
    '',
    'echo "LunaTV local service stopped."',
    'echo "Refresh LunaTV in your browser to use the default route."',
    '',
  ].join('\n');
}

function buildMacUninstallScript(): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `SERVICE_LABEL="${MACOS_LAUNCHD_LABEL}"`,
    `APPLICATION_DIR="${MACOS_APPLICATION_DIR}"`,
    'PLIST_PATH="/Library/LaunchDaemons/${SERVICE_LABEL}.plist"',
    `SYSTEM_SUPPORT_DIR="${MACOS_SUPPORT_DIR}"`,
    `SYSTEM_LOG_DIR="${MACOS_LOG_DIR}"`,
    'SYSTEM_BINARY="${SYSTEM_SUPPORT_DIR}/lunatv-server"',
    'USER_ROOT="${HOME}/.lunatv"',
    'USER_BINARY="${USER_ROOT}/bin/lunatv-server"',
    '',
    'run_as_root() {',
    '  if [ "$(id -u)" -eq 0 ]; then',
    '    "$@"',
    '  else',
    '    sudo "$@"',
    '  fi',
    '}',
    '',
    'if [ -f "$PLIST_PATH" ]; then',
    '  run_as_root launchctl bootout system "$PLIST_PATH" >/dev/null 2>&1 || true',
    'fi',
    '',
    'pkill -f "$SYSTEM_BINARY" >/dev/null 2>&1 || true',
    'pkill -f "$USER_BINARY" >/dev/null 2>&1 || true',
    '',
    'run_as_root rm -f "$PLIST_PATH" || true',
    'run_as_root rm -rf "$APPLICATION_DIR" || true',
    'run_as_root rm -rf "$SYSTEM_SUPPORT_DIR" || true',
    'run_as_root rm -rf "$SYSTEM_LOG_DIR" || true',
    'rm -rf "$USER_ROOT"',
    'rm -f /tmp/lunatv-server.log',
    '',
    'if command -v pkgutil >/dev/null 2>&1; then',
    "  while IFS= read -r package_id; do",
    '    [ -n "$package_id" ] || continue',
    '    run_as_root pkgutil --forget "$package_id" >/dev/null 2>&1 || true',
    "  done < <(pkgutil --pkgs | grep '^io\\.qzz\\.lunatv\\.local-service\\.mac-') || true",
    'fi',
    '',
    'echo "LunaTV local service uninstalled."',
    'echo "Refresh LunaTV in your browser to use the default route."',
    '',
  ].join('\n');
}

function buildLinuxStopScript(): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `SYSTEM_SERVICE="${LINUX_SYSTEM_SERVICE_NAME}"`,
    `SYSTEM_BINARY="${LINUX_SYSTEM_INSTALL_ROOT}/bin/lunatv-server"`,
    'USER_BINARY="${HOME}/.lunatv/bin/lunatv-server"',
    '',
    'run_as_root() {',
    '  if [ "$(id -u)" -eq 0 ]; then',
    '    "$@"',
    '  else',
    '    sudo "$@"',
    '  fi',
    '}',
    '',
    'if command -v systemctl >/dev/null 2>&1; then',
    '  run_as_root systemctl stop "$SYSTEM_SERVICE" >/dev/null 2>&1 || true',
    'fi',
    '',
    'pkill -f "$SYSTEM_BINARY" >/dev/null 2>&1 || true',
    'pkill -f "$USER_BINARY" >/dev/null 2>&1 || true',
    '',
    'echo "LunaTV local service stopped."',
    'echo "Refresh LunaTV in your browser to use the default route."',
    '',
  ].join('\n');
}

function buildLinuxUninstallScript(): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `PACKAGE_NAME="${LINUX_PACKAGE_NAME}"`,
    `SYSTEM_SERVICE="${LINUX_SYSTEM_SERVICE_NAME}"`,
    `SYSTEM_INSTALL_ROOT="${LINUX_SYSTEM_INSTALL_ROOT}"`,
    `SYSTEM_CONFIG_DIR="${LINUX_SYSTEM_CONFIG_DIR}"`,
    `SYSTEM_DATA_DIR="${LINUX_SYSTEM_DATA_DIR}"`,
    'SYSTEM_BINARY="${SYSTEM_INSTALL_ROOT}/bin/lunatv-server"',
    'USER_ROOT="${HOME}/.lunatv"',
    'USER_BINARY="${USER_ROOT}/bin/lunatv-server"',
    '',
    'run_as_root() {',
    '  if [ "$(id -u)" -eq 0 ]; then',
    '    "$@"',
    '  else',
    '    sudo "$@"',
    '  fi',
    '}',
    '',
    'if command -v systemctl >/dev/null 2>&1; then',
    '  run_as_root systemctl stop "$SYSTEM_SERVICE" >/dev/null 2>&1 || true',
    '  run_as_root systemctl disable "$SYSTEM_SERVICE" >/dev/null 2>&1 || true',
    'fi',
    '',
    'pkill -f "$SYSTEM_BINARY" >/dev/null 2>&1 || true',
    'pkill -f "$USER_BINARY" >/dev/null 2>&1 || true',
    '',
    'if command -v dpkg >/dev/null 2>&1 && dpkg -s "$PACKAGE_NAME" >/dev/null 2>&1; then',
    '  if command -v apt-get >/dev/null 2>&1; then',
    '    run_as_root apt-get remove -y "$PACKAGE_NAME" >/dev/null 2>&1 || run_as_root dpkg -r "$PACKAGE_NAME" >/dev/null 2>&1 || true',
    '  else',
    '    run_as_root dpkg -r "$PACKAGE_NAME" >/dev/null 2>&1 || true',
    '  fi',
    '  if command -v systemctl >/dev/null 2>&1; then',
    '    run_as_root systemctl daemon-reload >/dev/null 2>&1 || true',
    '  fi',
    'fi',
    '',
    'run_as_root rm -rf "$SYSTEM_INSTALL_ROOT" >/dev/null 2>&1 || true',
    'run_as_root rm -rf "$SYSTEM_CONFIG_DIR" >/dev/null 2>&1 || true',
    'run_as_root rm -rf "$SYSTEM_DATA_DIR" >/dev/null 2>&1 || true',
    'rm -rf "$USER_ROOT"',
    'rm -f /tmp/lunatv-server.log',
    '',
    'echo "LunaTV local service uninstalled."',
    'echo "Refresh LunaTV in your browser to use the default route."',
    '',
  ].join('\n');
}

function buildWindowsStopScript(): string {
  return [
    '$ErrorActionPreference = "Stop"',
    '$Stopped = $false',
    'Get-Process -Name "lunatv-server" -ErrorAction SilentlyContinue | ForEach-Object {',
    '  Stop-Process -Id $_.Id -Force',
    '  $Stopped = $true',
    '}',
    '',
    'if ($Stopped) {',
    '  Write-Host "LunaTV local service stopped."',
    '} else {',
    '  Write-Host "LunaTV local service is not running."',
    '}',
    'Write-Host "Refresh LunaTV in your browser to use the default route."',
    '',
  ].join('\n');
}

function buildWindowsUninstallScript(): string {
  return [
    '$ErrorActionPreference = "Stop"',
    '$InstallRoot = Join-Path $env:LOCALAPPDATA "LunaTV Local Service"',
    '$LegacyInstallRoot = Join-Path $env:USERPROFILE ".lunatv"',
    '',
    'Get-Process -Name "lunatv-server" -ErrorAction SilentlyContinue | ForEach-Object {',
    '  Stop-Process -Id $_.Id -Force',
    '}',
    '',
    `Remove-ItemProperty -Path "${WINDOWS_RUN_KEY}" -Name "${WINDOWS_RUN_VALUE_NAME}" -ErrorAction SilentlyContinue`,
    `Remove-Item -Path "${WINDOWS_UNINSTALL_KEY}" -Recurse -Force -ErrorAction SilentlyContinue`,
    '',
    'if (Test-Path $InstallRoot) {',
    '  Remove-Item -Recurse -Force $InstallRoot',
    '}',
    'if (Test-Path $LegacyInstallRoot) {',
    '  Remove-Item -Recurse -Force $LegacyInstallRoot',
    '}',
    '',
    'Write-Host "LunaTV local service uninstalled."',
    'Write-Host "Refresh LunaTV in your browser to use the default route."',
    '',
  ].join('\n');
}

function buildScriptContent(params: {
  action: LocalServiceScriptAction;
  downloadUrl: string | null;
  platform: LocalServicePlatformKey;
}): string {
  const { action, downloadUrl, platform } = params;

  if (action === 'stop') {
    if (platform === 'win-x64') {
      return buildWindowsStopScript();
    }

    return platform.startsWith('mac-')
      ? buildMacStopScript()
      : buildLinuxStopScript();
  }

  if (action === 'uninstall') {
    if (platform === 'win-x64') {
      return buildWindowsUninstallScript();
    }

    return platform.startsWith('mac-')
      ? buildMacUninstallScript()
      : buildLinuxUninstallScript();
  }

  if (!downloadUrl) {
    throw new Error('Local service binary is unavailable');
  }

  if (platform === 'win-x64') {
    return [
      '$ErrorActionPreference = "Stop"',
      `$InstallRoot = ${WINDOWS_INSTALL_ROOT}`,
      '$BinDir = Join-Path $InstallRoot "bin"',
      '$DataDir = Join-Path $InstallRoot "data"',
      '$Target = Join-Path $BinDir "lunatv-server.exe"',
      '$ConfigPath = Join-Path $InstallRoot "config.json"',
      `$LauncherPath = Join-Path $InstallRoot "${WINDOWS_LAUNCHER_NAME}"`,
      '$LegacyInstallRoot = Join-Path $env:USERPROFILE ".lunatv"',
      '$RunValue = "`"$env:WINDIR\\System32\\wscript.exe`" `"$LauncherPath`""',
      '',
      'Get-Process -Name "lunatv-server" -ErrorAction SilentlyContinue | ForEach-Object {',
      '  Stop-Process -Id $_.Id -Force',
      '}',
      'New-Item -ItemType Directory -Force -Path $InstallRoot, $BinDir, $DataDir | Out-Null',
      `Invoke-WebRequest -UseBasicParsing "${downloadUrl}" -OutFile $Target`,
      'if (-not (Test-Path $ConfigPath)) {',
      "@'",
      EMBEDDED_LOCAL_SERVICE_CONFIG,
      "'@ | Set-Content -Path $ConfigPath -Encoding UTF8",
      '}',
      "@'",
      EMBEDDED_WINDOWS_LAUNCHER_SCRIPT,
      "'@ | Set-Content -Path $LauncherPath -Encoding ASCII",
      'if (Test-Path $LegacyInstallRoot) {',
      '  Remove-Item -Recurse -Force $LegacyInstallRoot',
      '}',
      `New-Item -Path "${WINDOWS_RUN_KEY}" -Force | Out-Null`,
      `Set-ItemProperty -Path "${WINDOWS_RUN_KEY}" -Name "${WINDOWS_RUN_VALUE_NAME}" -Value $RunValue`,
      'Start-Process -FilePath "$env:WINDIR\\System32\\wscript.exe" -ArgumentList "`"$LauncherPath`""',
      '',
      'Write-Host "LunaTV local service started."',
      'Write-Host "Refresh LunaTV in your browser to use local acceleration."',
      '',
    ].join('\n');
  }

  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `INSTALL_ROOT="${USER_INSTALL_ROOT}"`,
    'BIN_DIR="${INSTALL_ROOT}/bin"',
    'DATA_DIR="${INSTALL_ROOT}/data"',
    'CONFIG_PATH="${INSTALL_ROOT}/config.json"',
    'SQLITE_PATH="${DATA_DIR}/moontv-local-service.sqlite3"',
    'TARGET="${BIN_DIR}/lunatv-server"',
    'mkdir -p "${BIN_DIR}" "${DATA_DIR}"',
    '',
    `curl -fsSL "${downloadUrl}" -o "\${TARGET}"`,
    'chmod +x "${TARGET}"',
    'if [ ! -f "${CONFIG_PATH}" ]; then',
    '  cat > "${CONFIG_PATH}" <<\'__LUNATV_CONFIG__\'',
    EMBEDDED_LOCAL_SERVICE_CONFIG,
    '__LUNATV_CONFIG__',
    'fi',
    'pkill -f "${TARGET}" >/dev/null 2>&1 || true',
    'nohup "${TARGET}" --host 127.0.0.1 --port 8787 --config-path "${CONFIG_PATH}" --data-dir "${DATA_DIR}" --sqlite-path "${SQLITE_PATH}" >/tmp/lunatv-server.log 2>&1 &',
    '',
    'echo "LunaTV local service started."',
    'echo "Refresh LunaTV in your browser to use local acceleration."',
    '',
  ].join('\n');
}

function validateRequest(params: {
  action: LocalServiceScriptAction | null;
  platform: string | null;
}): {
  action?: LocalServiceScriptAction;
  errorResponse?: Response;
  platform?: LocalServicePlatformKey;
} {
  if (!params.action) {
    return {
      errorResponse: jsonError('Invalid local service script action', 400),
    };
  }

  if (!isLocalServicePlatformKey(params.platform)) {
    return {
      errorResponse: jsonError('Invalid local service platform', 400),
    };
  }

  if (
    params.action === 'install' &&
    !resolveLocalServiceBinaryUrl(params.platform)
  ) {
    return {
      errorResponse: jsonError('Local service binary is unavailable', 503),
    };
  }

  return {
    action: params.action,
    platform: params.platform,
  };
}

async function handleRequest(
  request: NextRequest,
  method: 'GET' | 'HEAD'
): Promise<Response> {
  const validation = validateRequest({
    action: normalizeScriptAction(request.nextUrl.searchParams.get('action')),
    platform: request.nextUrl.searchParams.get('platform'),
  });
  if (validation.errorResponse || !validation.platform || !validation.action) {
    return validation.errorResponse as Response;
  }

  const fileName = buildScriptFileName(validation.platform, validation.action);
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Content-Type':
      validation.platform === 'win-x64'
        ? 'text/plain; charset=utf-8'
        : 'text/x-shellscript; charset=utf-8',
  });

  if (method === 'HEAD') {
    return new Response(null, { headers, status: 200 });
  }

  const downloadUrl =
    validation.action === 'install'
      ? resolveLocalServiceBinaryUrl(validation.platform)
      : null;

  try {
    return new Response(
      buildScriptContent({
        action: validation.action,
        downloadUrl,
        platform: validation.platform,
      }),
      {
        headers,
        status: 200,
      }
    );
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Local service script failed',
      503
    );
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return handleRequest(request, 'GET');
}

export async function HEAD(request: NextRequest): Promise<Response> {
  return handleRequest(request, 'HEAD');
}
