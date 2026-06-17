import { NextRequest, NextResponse } from 'next/server';

import {
  fetchDesktopReleaseById,
  getDesktopAssetKeyForName,
  getDesktopReleaseConfig,
  isClientDownloadSigningEnabled,
  isLocalServiceInstallerPlatformKey,
  isLocalServicePlatformKey,
  matchesDesktopReleaseConfig,
  resolveLocalServiceBinaryUrl,
  resolveLocalServiceInstallerUrl,
  verifySignedDesktopDownload,
} from '@/lib/client-download';
import {
  fetchWithValidatedRedirects,
  validateProxyTargetUrl,
} from '@/lib/proxy-security';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 3;

function jsonError(error: string, status: number, details?: string): Response {
  return NextResponse.json({ details, error }, { status });
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function shouldForwardUpstreamContentLength(headers: Headers): boolean {
  return !headers.has('content-encoding');
}

function copyHeader(
  from: Headers,
  to: Headers,
  sourceKey: string,
  targetKey = sourceKey
): void {
  const value = from.get(sourceKey);
  if (value) {
    to.set(targetKey, value);
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n]/g, '_');
}

function inferContentType(fileName: string): string {
  const normalizedName = fileName.toLowerCase();

  if (normalizedName.endsWith('.dmg')) {
    return 'application/x-apple-diskimage';
  }

  if (normalizedName.endsWith('.zip')) {
    return 'application/zip';
  }

  if (normalizedName.endsWith('.exe')) {
    return 'application/vnd.microsoft.portable-executable';
  }

  if (normalizedName.endsWith('.deb')) {
    return 'application/vnd.debian.binary-package';
  }

  if (normalizedName.endsWith('.pkg')) {
    return 'application/octet-stream';
  }

  return 'application/octet-stream';
}

function deriveFileNameFromUrl(targetUrl: string, fallback: string): string {
  try {
    const pathname = new URL(targetUrl).pathname;
    const lastSegment = pathname.split('/').pop();
    if (lastSegment) {
      return decodeURIComponent(lastSegment);
    }
  } catch {
    // ignore
  }

  return fallback;
}

async function proxyDownload(
  request: NextRequest,
  options: {
    fallbackFileName: string;
    method: 'GET' | 'HEAD';
    targetUrl: string;
  }
): Promise<Response> {
  const requestHeaders: Record<string, string> = {
    Accept: '*/*',
    'User-Agent': request.headers.get('user-agent') || DEFAULT_UA,
  };

  const range = request.headers.get('range');
  if (range) {
    requestHeaders.Range = range;
  }

  let validatedUrl: string;
  try {
    validatedUrl = await validateProxyTargetUrl(options.targetUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid url';
    return jsonError(message, 400);
  }

  let upstream: Response;
  try {
    upstream = await fetchWithValidatedRedirects(
      validatedUrl,
      {
        cache: 'no-store',
        headers: requestHeaders,
        method: options.method,
      },
      {
        initialUrlValidated: true,
        maxRedirects: MAX_REDIRECTS,
        responseMode: 'stream',
        timeoutMs: FETCH_TIMEOUT_MS,
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch upstream asset';
    return jsonError('Upstream fetch failed', 502, message);
  }

  if (!upstream.ok && upstream.status !== 206) {
    return jsonError('Failed to download asset', upstream.status || 502);
  }

  const fileName = deriveFileNameFromUrl(
    validatedUrl,
    options.fallbackFileName
  );
  const headers = new Headers();
  headers.set(
    'Content-Disposition',
    `attachment; filename="${sanitizeFilename(fileName)}"`
  );
  headers.set('Cache-Control', 'no-store');
  headers.set('Vary', 'Range');
  copyHeader(upstream.headers, headers, 'content-type', 'Content-Type');
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', inferContentType(fileName));
  }
  if (shouldForwardUpstreamContentLength(upstream.headers)) {
    copyHeader(upstream.headers, headers, 'content-length', 'Content-Length');
  }
  copyHeader(upstream.headers, headers, 'content-range', 'Content-Range');
  copyHeader(upstream.headers, headers, 'accept-ranges', 'Accept-Ranges');
  if (!headers.has('Accept-Ranges')) {
    headers.set('Accept-Ranges', 'bytes');
  }

  return new Response(options.method === 'HEAD' ? null : upstream.body, {
    headers,
    status: upstream.status,
  });
}

async function handleDesktopDownload(
  request: NextRequest,
  method: 'GET' | 'HEAD'
): Promise<Response> {
  const config = getDesktopReleaseConfig();
  if (!config) {
    return jsonError('Desktop release is not configured', 503);
  }

  const searchParams = request.nextUrl.searchParams;
  const releaseId = parsePositiveInteger(searchParams.get('releaseId'));
  const assetId = parsePositiveInteger(searchParams.get('assetId'));
  const signingEnabled = isClientDownloadSigningEnabled();

  if (!releaseId || !assetId) {
    return jsonError('Invalid desktop download parameters', 400);
  }

  if (signingEnabled) {
    const expires = parsePositiveInteger(searchParams.get('expires'));
    const signature = searchParams.get('sig');

    if (!expires) {
      return jsonError('Invalid desktop download parameters', 400);
    }

    if (expires < Date.now()) {
      return jsonError('Download link expired', 403);
    }

    if (
      !verifySignedDesktopDownload({
        assetId,
        expires,
        releaseId,
        signature,
      })
    ) {
      return jsonError('Invalid download signature', 403);
    }
  }

  let release;
  try {
    release = await fetchDesktopReleaseById(releaseId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to load release';
    return jsonError(message, 502);
  }

  if (!release || !matchesDesktopReleaseConfig(release, config)) {
    return jsonError('Desktop release not found', 404);
  }

  const asset = release.assets.find((candidate) => candidate.id === assetId);
  if (!asset || !getDesktopAssetKeyForName(asset.name)) {
    return jsonError('Desktop asset not found', 404);
  }

  return proxyDownload(request, {
    fallbackFileName: asset.name,
    method,
    targetUrl: asset.browser_download_url,
  });
}

async function handleLocalServiceDownload(
  request: NextRequest,
  method: 'GET' | 'HEAD'
): Promise<Response> {
  const platform = request.nextUrl.searchParams.get('platform');
  if (!isLocalServicePlatformKey(platform)) {
    return jsonError('Invalid local service platform', 400);
  }

  const targetUrl = resolveLocalServiceBinaryUrl(platform);
  if (!targetUrl) {
    return jsonError('Local service binary is unavailable', 503);
  }

  const fallbackFileName =
    platform === 'win-x64' ? 'lunatv-server.exe' : 'lunatv-server';
  return proxyDownload(request, {
    fallbackFileName,
    method,
    targetUrl,
  });
}

async function handleLocalServiceInstallerDownload(
  request: NextRequest,
  method: 'GET' | 'HEAD'
): Promise<Response> {
  const platform = request.nextUrl.searchParams.get('platform');
  if (!isLocalServiceInstallerPlatformKey(platform)) {
    return jsonError('Invalid local service installer platform', 400);
  }

  const targetUrl = resolveLocalServiceInstallerUrl(platform);
  if (!targetUrl) {
    return jsonError('Local service installer is unavailable', 503);
  }

  return proxyDownload(request, {
    fallbackFileName:
      platform === 'win-x64'
        ? 'lunatv-local-service-win-x64.exe'
        : platform.startsWith('linux-')
        ? `lunatv-local-service-${platform}.deb`
        : `lunatv-local-service-${platform}.pkg`,
    method,
    targetUrl,
  });
}

async function handleRequest(
  request: NextRequest,
  method: 'GET' | 'HEAD'
): Promise<Response> {
  const kind = request.nextUrl.searchParams.get('kind');

  if (kind === 'desktop') {
    return handleDesktopDownload(request, method);
  }

  if (kind === 'local-service') {
    return handleLocalServiceDownload(request, method);
  }

  if (kind === 'local-service-installer') {
    return handleLocalServiceInstallerDownload(request, method);
  }

  return jsonError('Invalid download kind', 400);
}

export async function GET(request: NextRequest): Promise<Response> {
  return handleRequest(request, 'GET');
}

export async function HEAD(request: NextRequest): Promise<Response> {
  return handleRequest(request, 'HEAD');
}
