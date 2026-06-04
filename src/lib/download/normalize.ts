import { SearchResult } from '@/lib/types';

import { buildVodProxyM3u8Url, isAbsoluteHttpUrl, isVodProxyUrl } from './proxy-url';

export function normalizeVodEpisodeUrl(
  source: string,
  upstreamUrl: string
): string {
  const normalizedUrl = upstreamUrl.trim();

  if (!normalizedUrl) {
    return normalizedUrl;
  }

  if (isVodProxyUrl(normalizedUrl)) {
    return normalizedUrl;
  }

  if (!isAbsoluteHttpUrl(normalizedUrl)) {
    return normalizedUrl;
  }

  return buildVodProxyM3u8Url({
    source,
    url: normalizedUrl,
  });
}

export function normalizeVodDetailForPlayback(
  detail: SearchResult
): SearchResult {
  return {
    ...detail,
    episodes: detail.episodes.map((episodeUrl) =>
      normalizeVodEpisodeUrl(detail.source, episodeUrl)
    ),
  };
}

export function normalizeVodSearchResultsForPlayback(
  results: SearchResult[]
): SearchResult[] {
  return results.map((result) => normalizeVodDetailForPlayback(result));
}
