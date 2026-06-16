import { NextRequest, NextResponse } from 'next/server';

import {
  type LocalServicePlatformKey,
  isLocalServicePlatformKey,
  resolveLocalServiceBinaryUrl,
} from '@/lib/client-download';

export const runtime = 'nodejs';

type LocalServiceScriptAction = 'install' | 'stop' | 'uninstall';

const MACOS_LAUNCHD_LABEL = 'io.qzz.lunatv.local-service';
const MACOS_SUPPORT_DIR = '/Library/Application Support/LunaTV Local Service';
const MACOS_LOG_DIR = '/Library/Logs/LunaTV Local Service';

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
    'run_as_root rm -rf "$SYSTEM_SUPPORT_DIR" || true',
    'run_as_root rm -rf "$SYSTEM_LOG_DIR" || true',
    'rm -rf "$USER_ROOT"',
    'rm -f /tmp/lunatv-server.log',
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
    'USER_BINARY="${HOME}/.lunatv/bin/lunatv-server"',
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
    'USER_ROOT="${HOME}/.lunatv"',
    'USER_BINARY="${USER_ROOT}/bin/lunatv-server"',
    'pkill -f "$USER_BINARY" >/dev/null 2>&1 || true',
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
    '$InstallRoot = Join-Path $env:USERPROFILE ".lunatv"',
    '',
    'Get-Process -Name "lunatv-server" -ErrorAction SilentlyContinue | ForEach-Object {',
    '  Stop-Process -Id $_.Id -Force',
    '}',
    '',
    'if (Test-Path $InstallRoot) {',
    '  Remove-Item -Recurse -Force $InstallRoot',
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
      '$BinDir = Join-Path $env:USERPROFILE ".lunatv\\bin"',
      'New-Item -ItemType Directory -Force -Path $BinDir | Out-Null',
      '$Target = Join-Path $BinDir "lunatv-server.exe"',
      '',
      `Invoke-WebRequest -UseBasicParsing "${downloadUrl}" -OutFile $Target`,
      'Start-Process -FilePath $Target',
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
    'BIN_DIR="${HOME}/.lunatv/bin"',
    'mkdir -p "${BIN_DIR}"',
    '',
    `curl -fsSL "${downloadUrl}" -o "\${BIN_DIR}/lunatv-server"`,
    'chmod +x "${BIN_DIR}/lunatv-server"',
    'nohup "${BIN_DIR}/lunatv-server" >/tmp/lunatv-server.log 2>&1 &',
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
  if (
    validation.errorResponse ||
    !validation.platform ||
    !validation.action
  ) {
    return validation.errorResponse as Response;
  }

  const fileName = buildScriptFileName(
    validation.platform,
    validation.action
  );
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
