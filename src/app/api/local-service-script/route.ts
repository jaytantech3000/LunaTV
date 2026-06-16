import { NextRequest, NextResponse } from 'next/server';

import {
  type LocalServicePlatformKey,
  isLocalServicePlatformKey,
  resolveLocalServiceBinaryUrl,
} from '@/lib/client-download';

export const runtime = 'nodejs';

function jsonError(error: string, status: number): Response {
  return NextResponse.json({ error }, { status });
}

function buildScriptFileName(platform: string): string {
  return platform === 'win-x64'
    ? `lunatv-local-service-${platform}.ps1`
    : `lunatv-local-service-${platform}.sh`;
}

function buildScriptContent(platform: string, downloadUrl: string): string {
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

function validatePlatform(platform: string | null): {
  errorResponse?: Response;
  platform?: LocalServicePlatformKey;
} {
  if (!isLocalServicePlatformKey(platform)) {
    return {
      errorResponse: jsonError('Invalid local service platform', 400),
    };
  }

  if (!resolveLocalServiceBinaryUrl(platform)) {
    return {
      errorResponse: jsonError('Local service binary is unavailable', 503),
    };
  }

  return { platform };
}

async function handleRequest(
  request: NextRequest,
  method: 'GET' | 'HEAD'
): Promise<Response> {
  const validation = validatePlatform(
    request.nextUrl.searchParams.get('platform')
  );
  if (validation.errorResponse || !validation.platform) {
    return validation.errorResponse as Response;
  }

  const fileName = buildScriptFileName(validation.platform);
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

  const downloadUrl = resolveLocalServiceBinaryUrl(validation.platform);
  if (!downloadUrl) {
    return jsonError('Local service binary is unavailable', 503);
  }

  return new Response(buildScriptContent(validation.platform, downloadUrl), {
    headers,
    status: 200,
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return handleRequest(request, 'GET');
}

export async function HEAD(request: NextRequest): Promise<Response> {
  return handleRequest(request, 'HEAD');
}
