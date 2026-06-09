import { NextRequest } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import { signM3U8ProxyRequest } from '@/lib/m3u8-proxy';
import { SearchResult } from '@/lib/types';

function parseBooleanFlag(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'off') {
    return false;
  }
  return null;
}

function getQueryProxyMode(request: NextRequest): boolean | null {
  const value = request.nextUrl.searchParams.get('adfilter');
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (['server', 'proxy', 'true', '1', 'on'].includes(normalized)) {
    return true;
  }
  if (['direct', 'false', '0', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

function isNativeTvClient(request: NextRequest): boolean {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  const client = (request.nextUrl.searchParams.get('client') || '').toLowerCase();

  return (
    client === 'orion' ||
    client === 'oriontv' ||
    ua.includes('orion') ||
    ua.includes('reactnative') ||
    ua.includes('expo') ||
    ua.includes('okhttp')
  );
}

export function shouldUseServerSideEpisodeProxy(
  adminConfig: AdminConfig | null,
  request: NextRequest
): boolean {
  const queryMode = getQueryProxyMode(request);
  if (queryMode !== null) return queryMode;

  if (isNativeTvClient(request)) return false;

  const explicitProxyFlag =
    parseBooleanFlag(process.env.M3U8_SERVER_PROXY) ??
    parseBooleanFlag(process.env.ENABLE_M3U8_SERVER_PROXY);
  if (explicitProxyFlag !== null) return explicitProxyFlag;

  const legacyAdFilterFlag = parseBooleanFlag(process.env.ENABLE_AD_FILTER);
  if (legacyAdFilterFlag !== null) return legacyAdFilterFlag;

  const adminFlag = adminConfig?.AdFilterConfig?.enabled;
  if (typeof adminFlag === 'boolean') return adminFlag;

  return true;
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

function shouldRewriteEpisode(url: string): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (!/\.m3u8(\?|#|$)/i.test(url)) return false;
  return true;
}

function isSourceDisabled(
  adminConfig: AdminConfig | null,
  sourceKey: string | undefined
): boolean {
  if (!adminConfig || !sourceKey) return false;
  const entry = adminConfig.SourceConfig?.find((source) => source.key === sourceKey);
  return !!entry?.disable_ad_filter;
}

export async function rewriteEpisodesForAdFilter<
  T extends SearchResult | null | undefined,
>(result: T, request: NextRequest): Promise<T> {
  if (!result) return result;

  const adminConfig = await safeGetConfig();
  if (!shouldUseServerSideEpisodeProxy(adminConfig, request)) return result;
  if (isSourceDisabled(adminConfig, result.source)) return result;
  if (!Array.isArray(result.episodes) || result.episodes.length === 0) {
    return result;
  }

  const rewrittenEpisodes = result.episodes.map((episode) =>
    shouldRewriteEpisode(episode)
      ? buildFilterProxyUrl(request, episode, result.source)
      : episode
  );

  return { ...result, episodes: rewrittenEpisodes };
}

export async function rewriteEpisodesForAdFilterMany(
  results: SearchResult[],
  request: NextRequest
): Promise<SearchResult[]> {
  const adminConfig = await safeGetConfig();
  if (!shouldUseServerSideEpisodeProxy(adminConfig, request)) return results;

  return results.map((result) => {
    if (isSourceDisabled(adminConfig, result.source)) return result;
    if (!Array.isArray(result.episodes) || result.episodes.length === 0) {
      return result;
    }

    const rewrittenEpisodes = result.episodes.map((episode) =>
      shouldRewriteEpisode(episode)
        ? buildFilterProxyUrl(request, episode, result.source)
        : episode
    );

    return { ...result, episodes: rewrittenEpisodes };
  });
}

async function safeGetConfig(): Promise<AdminConfig | null> {
  try {
    return await getConfig();
  } catch {
    return null;
  }
}
