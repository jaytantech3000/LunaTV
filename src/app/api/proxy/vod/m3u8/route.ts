import { NextRequest, NextResponse } from 'next/server';

import {
  DEFAULT_AD_FILTER_CONFIG,
  filterM3U8,
} from '@/lib/ad-filter';
import { requireAuthContextFromRequest } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { proxyDesktopDevVodRequest } from '@/lib/desktop/dev-vod-proxy';
import {
  createVodProxyErrorResponse,
  createVodProxyHeaders,
  fetchVodProxyUpstream,
  resolveVodProxyRequest,
  rewriteVodManifestContent,
} from '@/lib/download/vod-proxy';

export const runtime = 'nodejs';

function parseBooleanFlag(value: string | null): boolean | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'on', 'server', 'proxy'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'off', 'direct'].includes(normalized)) {
    return false;
  }

  return null;
}

function buildAdFilterConfig(enabled: boolean) {
  const parseNum = (value: string | undefined, fallback: number): number => {
    if (!value) return fallback;

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    ...DEFAULT_AD_FILTER_CONFIG,
    enabled,
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

async function isVodAdFilterEnabled(): Promise<boolean> {
  const envOverride = parseBooleanFlag(process.env.ENABLE_AD_FILTER || null);
  if (envOverride !== null) {
    return envOverride;
  }

  try {
    const config = await getConfig();
    if (typeof config.AdFilterConfig?.enabled === 'boolean') {
      return config.AdFilterConfig.enabled;
    }
  } catch (_) {
    // Ignore config load errors and fall back to enabled.
  }

  return true;
}

function appendAdFilterExposeHeaders(headers: Headers) {
  const existing = headers.get('Access-Control-Expose-Headers');
  const headerNames = new Set(
    (existing || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

  headerNames.add('X-Ads-Removed');
  headerNames.add('X-Ads-Duration');
  headers.set('Access-Control-Expose-Headers', Array.from(headerNames).join(', '));
}

async function handleRequest(
  request: NextRequest,
  method: 'GET' | 'HEAD'
): Promise<Response> {
  try {
    const desktopProxyResponse = await proxyDesktopDevVodRequest(
      request,
      '/api/proxy/vod/m3u8',
      {
        rewriteManifest: true,
      }
    );
    if (desktopProxyResponse) {
      return desktopProxyResponse;
    }

    const authContext = requireAuthContextFromRequest(request);
    const { source, upstreamUrl, apiSite } = await resolveVodProxyRequest({
      authContext,
      source: request.nextUrl.searchParams.get('source'),
      upstreamUrl: request.nextUrl.searchParams.get('url'),
    });
    const upstreamResponse = await fetchVodProxyUpstream({
      apiSite,
      upstreamUrl,
      requestHeaders: request.headers,
    });

    if (!upstreamResponse.ok) {
      return NextResponse.json(
        { error: `Failed to fetch manifest: ${upstreamResponse.status}` },
        { status: 500 }
      );
    }

    const manifestContent = await upstreamResponse.text();
    const rewrittenContent = rewriteVodManifestContent(
      manifestContent,
      upstreamResponse.url || upstreamUrl,
      source
    );
    const adFilterOverride = parseBooleanFlag(
      request.nextUrl.searchParams.get('adfilter')
    );
    const shouldApplyAdFilter =
      !rewrittenContent.includes('#EXT-X-STREAM-INF') &&
      !apiSite.disable_ad_filter &&
      adFilterOverride !== false &&
      (adFilterOverride === true || (await isVodAdFilterEnabled()));
    const adFilterResult = shouldApplyAdFilter
      ? filterM3U8(rewrittenContent, buildAdFilterConfig(true))
      : null;
    const responseContent =
      adFilterResult?.changed ? adFilterResult.filtered : rewrittenContent;
    const manifestHeaders = createVodProxyHeaders(
      upstreamResponse,
      upstreamResponse.headers.get('Content-Type') ||
        'application/vnd.apple.mpegurl',
      {
        contentLength: Buffer.byteLength(responseContent).toString(),
      }
    );
    appendAdFilterExposeHeaders(manifestHeaders);
    if (adFilterResult && adFilterResult.adsRemoved > 0) {
      manifestHeaders.set('X-Ads-Removed', String(adFilterResult.adsRemoved));
      manifestHeaders.set('X-Ads-Duration', adFilterResult.adsDuration.toFixed(1));
    }

    if (method === 'HEAD') {
      return new Response(null, {
        status: upstreamResponse.status,
        headers: manifestHeaders,
      });
    }

    return new Response(responseContent, {
      status: upstreamResponse.status,
      headers: manifestHeaders,
    });
  } catch (error) {
    return createVodProxyErrorResponse(error);
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return handleRequest(request, 'GET');
}

export async function HEAD(request: NextRequest): Promise<Response> {
  return handleRequest(request, 'HEAD');
}
