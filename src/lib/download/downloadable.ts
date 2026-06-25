import { fetchContentDetail } from '@/lib/content-discovery-client';
import { searchPlaybackSources } from '@/lib/playback-source-client';
import { SearchResult } from '@/lib/types';

import { normalizeVodDetailForPlayback } from './normalize';

export interface ResolveDownloadablePlaybackSourcesParams {
  source?: string;
  id?: string;
  title: string;
  year?: string;
  searchType?: string;
  query?: string;
  doubanId?: number;
  allowAdultCandidates?: boolean;
}

export interface ResolveDownloadablePlaybackSourcesResult {
  detail: SearchResult;
  availableSources: SearchResult[];
}

export function buildDownloadableSourceKey(
  result: Pick<SearchResult, 'source' | 'id'>
): string {
  return `${result.source}:${result.id}`;
}

export function mergeDownloadableSourceLists(
  prioritySources: SearchResult[],
  discoveredSources: SearchResult[]
): SearchResult[] {
  const mergedSources = [...prioritySources];
  const seenSourceKeys = new Set(
    prioritySources.map((source) => buildDownloadableSourceKey(source))
  );

  discoveredSources.forEach((source) => {
    const sourceKey = buildDownloadableSourceKey(source);

    if (seenSourceKeys.has(sourceKey)) {
      return;
    }

    seenSourceKeys.add(sourceKey);
    mergedSources.push(source);
  });

  return mergedSources;
}

async function fetchDownloadableDetail(
  source: string,
  id: string
): Promise<SearchResult> {
  const payload = await fetchContentDetail(
    {
      source,
      id,
    },
    {
      cache: 'no-store',
    }
  );

  return normalizeVodDetailForPlayback(payload);
}

export async function resolveDownloadablePlaybackSources(
  params: ResolveDownloadablePlaybackSourcesParams
): Promise<ResolveDownloadablePlaybackSourcesResult> {
  const discoveryQuery = params.query?.trim() || params.title.trim();
  const directSource = params.source?.trim() || '';
  const directId = params.id?.trim() || '';
  const hasDirectDetailTarget = Boolean(directSource && directId);

  const [detailResult, searchResult] = await Promise.all([
    hasDirectDetailTarget
      ? fetchDownloadableDetail(directSource, directId)
          .then((detail) => ({
            detail,
            error: null,
          }))
          .catch((error: unknown) => ({
            detail: null,
            error:
              error instanceof Error ? error : new Error('获取可下载剧集失败'),
          }))
      : Promise.resolve({
          detail: null,
          error: null,
        }),
    discoveryQuery
      ? searchPlaybackSources({
          title: params.title,
          year: params.year,
          searchType: params.searchType,
          query: params.query,
          doubanId: params.doubanId,
          allowAdultCandidates: params.allowAdultCandidates,
        })
          .then((sources) => ({
            sources,
            error: null,
          }))
          .catch((error: unknown) => ({
            sources: [] as SearchResult[],
            error:
              error instanceof Error ? error : new Error('获取可下载剧集失败'),
          }))
      : Promise.resolve({
          sources: [] as SearchResult[],
          error: null,
        }),
  ]);

  if (
    !detailResult.detail &&
    detailResult.error &&
    searchResult.sources.length === 0
  ) {
    throw detailResult.error;
  }

  if (
    !detailResult.detail &&
    searchResult.error &&
    searchResult.sources.length === 0
  ) {
    throw searchResult.error;
  }

  const mergedSources = detailResult.detail
    ? mergeDownloadableSourceLists([detailResult.detail], searchResult.sources)
    : searchResult.sources;
  const detail = detailResult.detail || mergedSources[0];

  if (!detail) {
    throw new Error('当前内容没有可下载剧集');
  }

  return {
    detail,
    availableSources: mergedSources.filter(
      (source) =>
        buildDownloadableSourceKey(source) !==
        buildDownloadableSourceKey(detail)
    ),
  };
}
