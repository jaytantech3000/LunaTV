import type { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { ApiSite, getAvailableApiSites } from '@/lib/config';
import { getBaseUrl, resolveUrl } from '@/lib/live';

import {
  buildVodProxyKeyUrl,
  buildVodProxyM3u8Url,
  buildVodProxySegmentUrl,
  looksLikeManifestUrl,
} from './proxy-url';
import { sanitizeVodManifestLines } from './sanitize-manifest';

function buildSourceHeaders(
  apiSite: ApiSite,
  request: NextRequest
): HeadersInit {
  const headers: Record<string, string> = {};
  const customUserAgent = apiSite.ua?.trim();
  const customReferer = apiSite.referer?.trim();
  const rangeHeader = request.headers.get('range');

  if (customUserAgent) {
    headers['User-Agent'] = customUserAgent;
  }

  if (customReferer) {
    headers.Referer = customReferer;
  }

  if (rangeHeader) {
    headers.Range = rangeHeader;
  }

  return headers;
}

export async function resolveVodProxyRequest(
  request: NextRequest
): Promise<{ source: string; upstreamUrl: string; apiSite: ApiSite }> {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    throw new Error('Unauthorized');
  }

  const source = request.nextUrl.searchParams.get('source')?.trim();
  const upstreamUrl = request.nextUrl.searchParams.get('url')?.trim();

  if (!source || !upstreamUrl) {
    throw new Error('Missing source or url');
  }

  const availableApiSites = await getAvailableApiSites(authInfo.username);
  const apiSite = availableApiSites.find((item) => item.key === source);
  if (!apiSite) {
    throw new Error('Invalid source');
  }

  return {
    source,
    upstreamUrl,
    apiSite,
  };
}

export async function fetchVodProxyUpstream(
  request: NextRequest,
  apiSite: ApiSite,
  upstreamUrl: string
): Promise<Response> {
  return fetch(upstreamUrl, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: buildSourceHeaders(apiSite, request),
    redirect: 'follow',
  });
}

function rewriteAttributeUri(
  line: string,
  baseUrl: string,
  source: string,
  builder: (params: { source: string; url: string }) => string
): string {
  const uriMatch = line.match(/URI="([^"]+)"/i);
  if (!uriMatch?.[1]) {
    return line;
  }

  const resolvedUrl = resolveUrl(baseUrl, uriMatch[1]);
  const proxiedUrl = builder({
    source,
    url: resolvedUrl,
  });

  return line.replace(uriMatch[0], `URI="${proxiedUrl}"`);
}

export function rewriteVodManifestContent(
  content: string,
  finalUrl: string,
  source: string
): string {
  const baseUrl = getBaseUrl(finalUrl);
  const lines = sanitizeVodManifestLines(content.split(/\r?\n/));
  const rewrittenLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmedLine = lines[index].trim();

    if (!trimmedLine) {
      rewrittenLines.push(trimmedLine);
      continue;
    }

    if (trimmedLine.startsWith('#EXT-X-STREAM-INF:')) {
      rewrittenLines.push(trimmedLine);
      const nextLine = lines[index + 1]?.trim();
      if (nextLine && !nextLine.startsWith('#')) {
        const resolvedUrl = resolveUrl(baseUrl, nextLine);
        rewrittenLines.push(
          buildVodProxyM3u8Url({
            source,
            url: resolvedUrl,
          })
        );
        index += 1;
        continue;
      }
      continue;
    }

    if (trimmedLine.startsWith('#EXT-X-MEDIA:')) {
      rewrittenLines.push(
        rewriteAttributeUri(trimmedLine, baseUrl, source, buildVodProxyM3u8Url)
      );
      continue;
    }

    if (trimmedLine.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
      rewrittenLines.push(
        rewriteAttributeUri(trimmedLine, baseUrl, source, buildVodProxyM3u8Url)
      );
      continue;
    }

    if (
      trimmedLine.startsWith('#EXT-X-KEY:') ||
      trimmedLine.startsWith('#EXT-X-SESSION-KEY:')
    ) {
      rewrittenLines.push(
        rewriteAttributeUri(trimmedLine, baseUrl, source, buildVodProxyKeyUrl)
      );
      continue;
    }

    if (trimmedLine.startsWith('#EXT-X-MAP:')) {
      rewrittenLines.push(
        rewriteAttributeUri(
          trimmedLine,
          baseUrl,
          source,
          buildVodProxySegmentUrl
        )
      );
      continue;
    }

    if (
      trimmedLine.startsWith('#EXT-X-PART:') ||
      trimmedLine.startsWith('#EXT-X-PRELOAD-HINT:')
    ) {
      rewrittenLines.push(
        rewriteAttributeUri(
          trimmedLine,
          baseUrl,
          source,
          buildVodProxySegmentUrl
        )
      );
      continue;
    }

    if (trimmedLine.startsWith('#EXT-X-RENDITION-REPORT:')) {
      rewrittenLines.push(
        rewriteAttributeUri(trimmedLine, baseUrl, source, buildVodProxyM3u8Url)
      );
      continue;
    }

    if (!trimmedLine.startsWith('#')) {
      const resolvedUrl = resolveUrl(baseUrl, trimmedLine);
      rewrittenLines.push(
        looksLikeManifestUrl(resolvedUrl)
          ? buildVodProxyM3u8Url({
              source,
              url: resolvedUrl,
            })
          : buildVodProxySegmentUrl({
              source,
              url: resolvedUrl,
            })
      );
      continue;
    }

    rewrittenLines.push(trimmedLine);
  }

  return rewrittenLines.join('\n');
}

export function createVodProxyHeaders(
  upstreamResponse: Response,
  contentType?: string,
  options?: {
    contentLength?: string | null;
    includeContentLength?: boolean;
  }
): Headers {
  const headers = new Headers();

  headers.set(
    'Content-Type',
    contentType ||
      upstreamResponse.headers.get('Content-Type') ||
      'application/octet-stream'
  );
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Range, Origin, Accept'
  );
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
  headers.set('Cache-Control', 'no-store');

  const shouldIncludeContentLength = options?.includeContentLength !== false;
  const hasExplicitContentLength = Boolean(
    options && 'contentLength' in options
  );
  const contentLength =
    hasExplicitContentLength
      ? options?.contentLength ?? null
      : upstreamResponse.headers.get('content-length');

  const canForwardContentLength =
    hasExplicitContentLength || !upstreamResponse.headers.has('content-encoding');

  if (shouldIncludeContentLength && canForwardContentLength && contentLength) {
    headers.set('Content-Length', contentLength);
  }

  const acceptRanges = upstreamResponse.headers.get('accept-ranges');
  if (acceptRanges) {
    headers.set('Accept-Ranges', acceptRanges);
  }

  const contentRange = upstreamResponse.headers.get('content-range');
  if (contentRange) {
    headers.set('Content-Range', contentRange);
  }

  return headers;
}

export function createVodProxyErrorResponse(error: unknown): Response {
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

  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
