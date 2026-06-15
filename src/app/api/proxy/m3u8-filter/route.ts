/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { DEFAULT_AD_FILTER_CONFIG, filterM3U8 } from '@/lib/ad-filter';
import { getConfig } from '@/lib/config';
import { resolveVodProxyRequest } from '@/lib/download/vod-proxy';
import { getBaseUrl, resolveUrl } from '@/lib/live';
import {
  signM3U8ProxyRequest,
  verifyM3U8ProxySignature,
} from '@/lib/m3u8-proxy';
import {
  fetchWithValidatedRedirects,
  normalizeHeaderUrl,
  validateProxyTargetUrl,
} from '@/lib/proxy-security';

export const runtime = 'nodejs';

const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 10; AndroidTV) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 8000;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function withCorsHeaders(headers: Headers): void {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Range, Accept');
  headers.set(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, X-Ads-Removed, X-Ads-Duration'
  );
}

function jsonError(error: string, status: number, details?: string): Response {
  const headers = new Headers();
  withCorsHeaders(headers);
  return NextResponse.json({ error, details }, { status, headers });
}

async function isAdFilterEnabled(): Promise<boolean> {
  try {
    const config = await getConfig();
    if (typeof config?.AdFilterConfig?.enabled === 'boolean') {
      return config.AdFilterConfig.enabled;
    }
  } catch {
    // ignore
  }

  const flag = process.env.ENABLE_AD_FILTER;
  if (flag === undefined) return true;
  return flag === 'true' || flag === '1';
}

function buildFilterConfigFromEnv() {
  const parseNum = (value: string | undefined, fallback: number): number => {
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    ...DEFAULT_AD_FILTER_CONFIG,
    minAdDuration: parseNum(
      process.env.AD_FILTER_MIN_DURATION,
      DEFAULT_AD_FILTER_CONFIG.minAdDuration
    ),
    maxAdDuration: parseNum(
      process.env.AD_FILTER_MAX_DURATION,
      DEFAULT_AD_FILTER_CONFIG.maxAdDuration
    ),
    maxConsecutiveAdSegments: parseNum(
      process.env.AD_FILTER_MAX_SEGMENTS,
      DEFAULT_AD_FILTER_CONFIG.maxConsecutiveAdSegments
    ),
  };
}

function buildFilterProxyUrl(
  _request: NextRequest,
  upstreamUrl: string,
  source: string,
  referer?: string
): string {
  const signature = signM3U8ProxyRequest(upstreamUrl, { source, referer });
  if (!signature) return upstreamUrl;

  const searchParams = new URLSearchParams({
    source,
    url: upstreamUrl,
    sig: signature,
  });

  if (referer) {
    searchParams.set('referer', referer);
  }

  return `/api/proxy/m3u8-filter?${searchParams.toString()}`;
}

function shouldProxyMediaAssets(): boolean {
  const flag = process.env.M3U8_DIRECT_MEDIA;
  return !(flag === 'true' || flag === '1');
}

function inferAssetKind(upstreamUrl: string): 'segment' | 'key' | 'map' {
  const pathname = (() => {
    try {
      return new URL(upstreamUrl).pathname.toLowerCase();
    } catch {
      return upstreamUrl.toLowerCase();
    }
  })();

  if (pathname.endsWith('.key')) return 'key';
  if (
    pathname.endsWith('.mp4') ||
    pathname.endsWith('.m4s') ||
    pathname.endsWith('.m4v')
  ) {
    return 'map';
  }
  return 'segment';
}

function buildAssetProxyUrl(
  _request: NextRequest,
  upstreamUrl: string,
  source: string,
  referer?: string,
  kind: 'segment' | 'key' | 'map' = inferAssetKind(upstreamUrl)
): string {
  const signature = signM3U8ProxyRequest(upstreamUrl, { source, referer });
  if (!signature) return upstreamUrl;

  const searchParams = new URLSearchParams({
    source,
    url: upstreamUrl,
    kind,
    sig: signature,
  });

  if (referer) {
    searchParams.set('referer', referer);
  }

  return `/api/proxy/m3u8-asset?${searchParams.toString()}`;
}

function rewriteUriAttribute(
  line: string,
  baseUrl: string,
  request: NextRequest,
  source: string,
  referer: string | undefined,
  target: 'playlist' | 'asset',
  kind?: 'segment' | 'key' | 'map'
): string {
  return line.replace(/URI="([^"]+)"/, (match, uri) => {
    const resolvedUrl = resolveUrl(baseUrl, uri);
    const rewrittenUrl =
      target === 'playlist'
        ? buildFilterProxyUrl(request, resolvedUrl, source, referer)
        : shouldProxyMediaAssets()
        ? buildAssetProxyUrl(request, resolvedUrl, source, referer, kind)
        : resolvedUrl;
    return match.replace(uri, rewrittenUrl);
  });
}

function rewriteMasterPlaylist(
  content: string,
  baseUrl: string,
  request: NextRequest,
  source: string,
  referer?: string
): string {
  const lines = content.split('\n');
  const output: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];

    if (
      line.trim().startsWith('#EXT-X-MEDIA:') ||
      line.trim().startsWith('#EXT-X-I-FRAME-STREAM-INF:')
    ) {
      line = rewriteUriAttribute(
        line,
        baseUrl,
        request,
        source,
        referer,
        'playlist'
      );
    }

    output.push(line);

    if (line.trim().startsWith('#EXT-X-STREAM-INF:')) {
      if (i + 1 < lines.length) {
        const variantLine = lines[i + 1].trim();
        if (variantLine && !variantLine.startsWith('#')) {
          const absolute = resolveUrl(baseUrl, variantLine);
          output.push(buildFilterProxyUrl(request, absolute, source, referer));
          i += 1;
          continue;
        }
      }
    }
  }

  return output.join('\n');
}

function rewriteVariantPlaylist(
  content: string,
  baseUrl: string,
  request: NextRequest,
  source: string,
  referer?: string
): string {
  const proxyMedia = shouldProxyMediaAssets();

  return content
    .split('\n')
    .map((rawLine) => {
      const line = rawLine.trimEnd();

      if (line.startsWith('#EXT-X-MAP:')) {
        return rewriteUriAttribute(
          line,
          baseUrl,
          request,
          source,
          referer,
          'asset',
          'map'
        );
      }

      if (
        line.startsWith('#EXT-X-KEY:') ||
        line.startsWith('#EXT-X-SESSION-KEY:')
      ) {
        return rewriteUriAttribute(
          line,
          baseUrl,
          request,
          source,
          referer,
          'asset',
          'key'
        );
      }

      if (
        line.startsWith('#EXT-X-PART:') ||
        line.startsWith('#EXT-X-PRELOAD-HINT:')
      ) {
        return rewriteUriAttribute(
          line,
          baseUrl,
          request,
          source,
          referer,
          'asset',
          'segment'
        );
      }

      if (line.startsWith('#EXT-X-RENDITION-REPORT:')) {
        return rewriteUriAttribute(
          line,
          baseUrl,
          request,
          source,
          referer,
          'playlist'
        );
      }

      if (line && !line.startsWith('#')) {
        const resolvedUrl = resolveUrl(baseUrl, line);
        return proxyMedia
          ? buildAssetProxyUrl(request, resolvedUrl, source, referer, 'segment')
          : resolvedUrl;
      }

      return line;
    })
    .join('\n');
}

async function readTextWithLimit(
  response: Response,
  maxBytes: number
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Playlist too large');
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  let done = false;

  while (!done) {
    const { value, done: nextDone } = await reader.read();
    done = nextDone;
    if (done || !value) {
      continue;
    }
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error('Playlist too large');
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function buildUpstreamRequestContext(
  request: NextRequest,
  decodedUrl: string,
  sourceReferer: string | undefined,
  explicitReferer: string | undefined,
  sourceUserAgent: string | undefined
): { upstreamHeaders: Record<string, string>; refererToSend?: string } {
  const sanitizedExplicitReferer = normalizeHeaderUrl(explicitReferer);
  const sanitizedSourceReferer = normalizeHeaderUrl(sourceReferer);
  const inboundReferer = normalizeHeaderUrl(request.headers.get('referer'));
  let fallbackReferer: string | undefined;

  try {
    fallbackReferer = `${new URL(decodedUrl).origin}/`;
  } catch {
    fallbackReferer = undefined;
  }

  const refererToSend =
    sanitizedExplicitReferer ||
    sanitizedSourceReferer ||
    fallbackReferer ||
    inboundReferer;

  const upstreamHeaders: Record<string, string> = {
    'User-Agent':
      sourceUserAgent?.trim() ||
      request.headers.get('user-agent') ||
      DEFAULT_UA,
  };

  if (refererToSend) {
    upstreamHeaders.Referer = refererToSend;
    try {
      upstreamHeaders.Origin = new URL(refererToSend).origin;
    } catch {
      // ignore
    }
  }

  return { upstreamHeaders, refererToSend };
}

export async function GET(request: NextRequest): Promise<Response> {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');
  const source = searchParams.get('source')?.trim();

  if (!url || !source) {
    return jsonError('Missing url or source', 400);
  }

  const decodedUrl = url.trim();
  if (!decodedUrl) {
    return jsonError('Invalid url', 400);
  }

  const explicitReferer = searchParams.get('referer') || undefined;
  if (
    !verifyM3U8ProxySignature(decodedUrl, searchParams.get('sig'), {
      source,
      referer: explicitReferer,
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
  const { upstreamHeaders, refererToSend } = buildUpstreamRequestContext(
    request,
    decodedUrl,
    apiSite.referer,
    explicitReferer,
    apiSite.ua
  );

  let upstream: Response;
  try {
    upstream = await fetchWithValidatedRedirects(
      decodedUrl,
      {
        cache: 'no-store',
        headers: upstreamHeaders,
      },
      {
        timeoutMs: FETCH_TIMEOUT_MS,
        maxRedirects: MAX_REDIRECTS,
        initialUrlValidated: true,
      }
    );
  } catch (error: any) {
    return jsonError('Upstream fetch failed', 502, error?.message || 'unknown');
  }

  if (!upstream.ok) {
    return jsonError('Upstream returned non-OK', 502, String(upstream.status));
  }

  let content: string;
  try {
    content = await readTextWithLimit(upstream, MAX_PLAYLIST_BYTES);
  } catch (error: any) {
    return jsonError(error?.message || 'Unable to read playlist', 502);
  }

  if (!content.trimStart().startsWith('#EXTM3U')) {
    return jsonError('Upstream is not an m3u8 playlist', 502);
  }

  const finalUrl = upstream.url || decodedUrl;
  const baseUrl = getBaseUrl(finalUrl);

  let body: string;
  let adsRemoved = 0;
  let adsDuration = 0;

  if (content.includes('#EXT-X-STREAM-INF')) {
    body = rewriteMasterPlaylist(
      content,
      baseUrl,
      request,
      source,
      refererToSend
    );
  } else {
    const rewritten = rewriteVariantPlaylist(
      content,
      baseUrl,
      request,
      source,
      refererToSend
    );
    const queryDisable =
      searchParams.get('adfilter') === 'false' ||
      searchParams.get('adfilter') === '0';

    if ((await isAdFilterEnabled()) && !queryDisable) {
      const result = filterM3U8(rewritten, buildFilterConfigFromEnv());
      body = result.filtered;
      adsRemoved = result.adsRemoved;
      adsDuration = result.adsDuration;
    } else {
      body = rewritten;
    }
  }

  const headers = new Headers();
  headers.set(
    'Content-Type',
    upstream.headers.get('Content-Type') || 'application/vnd.apple.mpegurl'
  );
  headers.set('Cache-Control', 'no-cache');
  withCorsHeaders(headers);
  if (adsRemoved > 0) {
    headers.set('X-Ads-Removed', String(adsRemoved));
    headers.set('X-Ads-Duration', adsDuration.toFixed(1));
  }

  return new Response(body, { status: 200, headers });
}

export async function OPTIONS(): Promise<Response> {
  const headers = new Headers();
  withCorsHeaders(headers);
  return new Response(null, { status: 204, headers });
}
