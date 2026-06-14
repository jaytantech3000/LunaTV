/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { resolveVodProxyRequest } from '@/lib/download/vod-proxy';
import { verifyM3U8ProxySignature } from '@/lib/m3u8-proxy';
import {
  fetchWithValidatedRedirects,
  normalizeHeaderUrl,
  validateProxyTargetUrl,
} from '@/lib/proxy-security';

export const runtime = 'nodejs';

const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 10; AndroidTV) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 15000;
const KEY_FETCH_TIMEOUT_MS = 25000;
const MAX_REDIRECTS = 3;

function withCorsHeaders(headers: Headers): void {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Range, Origin, Accept'
  );
  headers.set(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type'
  );
}

function jsonError(error: string, status: number, details?: string): Response {
  const headers = new Headers();
  withCorsHeaders(headers);
  return NextResponse.json({ error, details }, { status, headers });
}

function inferContentType(decodedUrl: string, kind: string | null): string {
  const pathname = (() => {
    try {
      return new URL(decodedUrl).pathname.toLowerCase();
    } catch {
      return decodedUrl.toLowerCase();
    }
  })();

  if (kind === 'key' || pathname.endsWith('.key')) {
    return 'application/octet-stream';
  }
  if (pathname.endsWith('.m4s') || pathname.endsWith('.m4v')) {
    return 'video/iso.segment';
  }
  if (pathname.endsWith('.mp4')) {
    return 'video/mp4';
  }
  if (pathname.endsWith('.aac')) {
    return 'audio/aac';
  }
  if (pathname.endsWith('.vtt')) {
    return 'text/vtt; charset=utf-8';
  }
  return 'video/mp2t';
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

function resolveReferer(
  decodedUrl: string,
  request: NextRequest,
  sourceReferer?: string,
  explicit?: string
): string | undefined {
  const sanitizedExplicitReferer = normalizeHeaderUrl(explicit);
  const sanitizedSourceReferer = normalizeHeaderUrl(sourceReferer);
  const inboundReferer = normalizeHeaderUrl(request.headers.get('referer'));
  let fallbackReferer: string | undefined;
  try {
    fallbackReferer = `${new URL(decodedUrl).origin}/`;
  } catch {
    fallbackReferer = undefined;
  }
  return (
    sanitizedExplicitReferer ||
    sanitizedSourceReferer ||
    fallbackReferer ||
    inboundReferer
  );
}

async function handleAssetRequest(
  request: NextRequest,
  method: 'GET' | 'HEAD'
): Promise<Response> {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');
  const source = searchParams.get('source')?.trim();
  const referer = searchParams.get('referer') || undefined;
  const kind = searchParams.get('kind');

  if (!url || !source) {
    return jsonError('Missing url or source', 400);
  }

  const decodedUrl = url.trim();
  if (!decodedUrl) {
    return jsonError('Invalid url', 400);
  }
  const isKeyRequest =
    kind === 'key' || decodedUrl.toLowerCase().endsWith('.key');

  if (
    !verifyM3U8ProxySignature(decodedUrl, searchParams.get('sig'), {
      source,
      referer,
    })
  ) {
    return jsonError('Invalid signature', 403);
  }

  try {
    await validateProxyTargetUrl(decodedUrl);
  } catch (error: any) {
    return jsonError(error?.message || 'Invalid url', 400);
  }

  let proxyRequest;
  try {
    proxyRequest = await resolveVodProxyRequest(request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Proxy request failed';
    const status =
      message === 'Unauthorized'
        ? 401
        : message === 'Missing source or url'
        ? 400
        : message === 'Invalid source'
        ? 400
        : 500;
    return jsonError(message, status);
  }

  const { apiSite } = proxyRequest;
  const refererToSend = resolveReferer(
    decodedUrl,
    request,
    apiSite.referer,
    referer
  );
  const requestHeaders: Record<string, string> = {
    Accept: '*/*',
    'User-Agent':
      apiSite.ua?.trim() || request.headers.get('user-agent') || DEFAULT_UA,
  };

  if (refererToSend) {
    requestHeaders.Referer = refererToSend;
    try {
      requestHeaders.Origin = new URL(refererToSend).origin;
    } catch {
      // ignore
    }
  }

  const range = request.headers.get('range');
  if (range) {
    requestHeaders.Range = range;
  }

  let upstream: Response;
  try {
    upstream = await fetchWithValidatedRedirects(
      decodedUrl,
      {
        cache: 'no-store',
        headers: requestHeaders,
        method,
      },
      {
        timeoutMs:
          isKeyRequest && method === 'GET'
            ? KEY_FETCH_TIMEOUT_MS
            : FETCH_TIMEOUT_MS,
        maxRedirects: MAX_REDIRECTS,
        initialUrlValidated: true,
        responseMode: 'stream',
      }
    );
  } catch (error: any) {
    return jsonError('Upstream fetch failed', 502, error?.message || 'unknown');
  }

  if (!upstream.ok && upstream.status !== 206) {
    return jsonError('Failed to fetch asset', upstream.status || 502);
  }

  const headers = new Headers();
  withCorsHeaders(headers);
  headers.set(
    'Cache-Control',
    kind === 'key' ? 'public, max-age=3600' : 'no-cache'
  );
  headers.set('Vary', 'Range');
  copyHeader(upstream.headers, headers, 'content-type', 'Content-Type');
  copyHeader(upstream.headers, headers, 'content-length', 'Content-Length');
  copyHeader(upstream.headers, headers, 'content-range', 'Content-Range');
  copyHeader(upstream.headers, headers, 'accept-ranges', 'Accept-Ranges');
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', inferContentType(decodedUrl, kind));
  }
  if (!headers.has('Accept-Ranges')) {
    headers.set('Accept-Ranges', 'bytes');
  }

  return new Response(method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function OPTIONS(): Promise<Response> {
  const headers = new Headers();
  withCorsHeaders(headers);
  return new Response(null, { status: 204, headers });
}

export async function HEAD(request: NextRequest): Promise<Response> {
  return handleAssetRequest(request, 'HEAD');
}

export async function GET(request: NextRequest): Promise<Response> {
  return handleAssetRequest(request, 'GET');
}
