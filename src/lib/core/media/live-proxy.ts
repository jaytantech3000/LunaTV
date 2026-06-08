import { getConfig } from '@/lib/config';
import { getBaseUrl, resolveUrl } from '@/lib/live';
import {
  buildLiveProxyKeyUrl,
  buildLiveProxyM3u8Url,
  buildLiveProxySegmentUrl,
} from '@/lib/transport/media-proxy';

const DEFAULT_LIVE_PROXY_USER_AGENT = 'AptvPlayer/1.4.10';

type LiveConfigSource = NonNullable<
  Awaited<ReturnType<typeof getConfig>>['LiveConfig']
>[number];

export class LiveProxyError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'LiveProxyError';
    this.status = status;
  }
}

function normalizeUpstreamUrl(url: string | null | undefined): string {
  const normalizedUrl = url?.trim();

  if (!normalizedUrl) {
    throw new LiveProxyError('Missing url', 400);
  }

  return decodeURIComponent(normalizedUrl);
}

function rewriteAttributeUri(
  line: string,
  baseUrl: string,
  builder: (url: string) => string
): string {
  const uriMatch = line.match(/URI="([^"]+)"/i);
  if (!uriMatch?.[1]) {
    return line;
  }

  const resolvedUrl = resolveUrl(baseUrl, uriMatch[1]);
  return line.replace(uriMatch[0], `URI="${builder(resolvedUrl)}"`);
}

function buildStreamManifestUrl(sourceKey: string, url: string): string {
  return buildLiveProxyM3u8Url({
    url,
    sourceKey,
  });
}

function buildSegmentProxyUrl(sourceKey: string, url: string): string {
  return buildLiveProxySegmentUrl({
    url,
    sourceKey,
  });
}

function buildKeyProxyUrl(sourceKey: string, url: string): string {
  return buildLiveProxyKeyUrl({
    url,
    sourceKey,
  });
}

export function resolveLiveProxySource(
  sourceKey: string | null | undefined
): Promise<LiveConfigSource>;
export function resolveLiveProxySource(
  sourceKey: string | null | undefined,
  options: {
    required: false;
  }
): Promise<LiveConfigSource | null>;
export async function resolveLiveProxySource(
  sourceKey: string | null | undefined,
  options: {
    required?: boolean;
  } = {}
): Promise<LiveConfigSource | null> {
  const normalizedSourceKey = sourceKey?.trim();
  if (!normalizedSourceKey) {
    if (options.required === false) {
      return null;
    }

    throw new LiveProxyError('Missing source', 400);
  }

  const config = await getConfig();
  const liveSource = config.LiveConfig?.find(
    (source) => source.key === normalizedSourceKey
  );

  if (!liveSource) {
    if (options.required === false) {
      return null;
    }

    throw new LiveProxyError('Source not found', 404);
  }

  return liveSource;
}

export function createLiveProxyRequestHeaders(
  liveSource?: Pick<LiveConfigSource, 'ua'> | null,
  requestHeaders?: HeadersInit,
  options: {
    includeRange?: boolean;
  } = {}
): Headers {
  const headers = new Headers();
  const incomingHeaders = requestHeaders ? new Headers(requestHeaders) : null;
  const includeRange = options.includeRange !== false;
  const rangeHeader = includeRange ? incomingHeaders?.get('range') : null;

  headers.set(
    'User-Agent',
    liveSource?.ua?.trim() || DEFAULT_LIVE_PROXY_USER_AGENT
  );

  if (rangeHeader) {
    headers.set('Range', rangeHeader);
  }

  return headers;
}

export async function fetchLiveProxyUpstream(params: {
  liveSource?: Pick<LiveConfigSource, 'ua'> | null;
  upstreamUrl: string | null | undefined;
  requestHeaders?: HeadersInit;
  includeRange?: boolean;
  cache?: RequestCache;
}): Promise<Response> {
  return fetch(normalizeUpstreamUrl(params.upstreamUrl), {
    cache: params.cache || 'no-cache',
    redirect: 'follow',
    credentials: 'same-origin',
    headers: createLiveProxyRequestHeaders(
      params.liveSource,
      params.requestHeaders,
      {
        includeRange: params.includeRange,
      }
    ),
  });
}

export function shouldRewriteLiveManifest(
  upstreamResponse: Response,
  upstreamUrl: string | null | undefined
): boolean {
  const contentType = upstreamResponse.headers.get('Content-Type') || '';
  const loweredContentType = contentType.toLowerCase();
  const targetUrl = upstreamResponse.url || upstreamUrl || '';

  return (
    loweredContentType.includes('mpegurl') ||
    loweredContentType.includes('octet-stream') ||
    /\.m3u8($|[?#])/i.test(targetUrl)
  );
}

export function rewriteLiveManifestContent(
  content: string,
  finalUrl: string,
  params: {
    sourceKey: string;
    allowCORS?: boolean;
  }
): string {
  const baseUrl = getBaseUrl(finalUrl);
  const lines = content.split(/\r?\n/);
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
          buildStreamManifestUrl(params.sourceKey, resolvedUrl)
        );
        index += 1;
        continue;
      }
      continue;
    }

    if (trimmedLine.startsWith('#EXT-X-MEDIA:')) {
      rewrittenLines.push(
        rewriteAttributeUri(trimmedLine, baseUrl, (url) =>
          buildStreamManifestUrl(params.sourceKey, url)
        )
      );
      continue;
    }

    if (trimmedLine.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
      rewrittenLines.push(
        rewriteAttributeUri(trimmedLine, baseUrl, (url) =>
          buildStreamManifestUrl(params.sourceKey, url)
        )
      );
      continue;
    }

    if (
      trimmedLine.startsWith('#EXT-X-KEY:') ||
      trimmedLine.startsWith('#EXT-X-SESSION-KEY:')
    ) {
      rewrittenLines.push(
        rewriteAttributeUri(trimmedLine, baseUrl, (url) =>
          buildKeyProxyUrl(params.sourceKey, url)
        )
      );
      continue;
    }

    if (
      trimmedLine.startsWith('#EXT-X-MAP:') ||
      trimmedLine.startsWith('#EXT-X-PART:') ||
      trimmedLine.startsWith('#EXT-X-PRELOAD-HINT:')
    ) {
      rewrittenLines.push(
        rewriteAttributeUri(trimmedLine, baseUrl, (url) =>
          buildSegmentProxyUrl(params.sourceKey, url)
        )
      );
      continue;
    }

    if (trimmedLine.startsWith('#EXT-X-RENDITION-REPORT:')) {
      rewrittenLines.push(
        rewriteAttributeUri(trimmedLine, baseUrl, (url) =>
          buildStreamManifestUrl(params.sourceKey, url)
        )
      );
      continue;
    }

    if (!trimmedLine.startsWith('#')) {
      const resolvedUrl = resolveUrl(baseUrl, trimmedLine);
      rewrittenLines.push(
        params.allowCORS
          ? resolvedUrl
          : buildSegmentProxyUrl(params.sourceKey, resolvedUrl)
      );
      continue;
    }

    rewrittenLines.push(trimmedLine);
  }

  return rewrittenLines.join('\n');
}

export function createLiveProxyHeaders(
  upstreamResponse: Response,
  contentType?: string,
  options?: {
    contentLength?: string | null;
    includeContentLength?: boolean;
    cacheControl?: string;
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
  headers.set('Cache-Control', options?.cacheControl || 'no-cache');

  const shouldIncludeContentLength = options?.includeContentLength !== false;
  const contentLength =
    options && 'contentLength' in options
      ? options.contentLength
      : upstreamResponse.headers.get('content-length');

  if (shouldIncludeContentLength && contentLength) {
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

export function createLiveProxyErrorResponse(error: unknown): Response {
  const message =
    error instanceof Error ? error.message : 'Proxy request failed';
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : 500;

  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
