import { normalizeVodSearchResultsForPlayback } from '@/lib/download/normalize';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';

export interface PlaybackSourceMetrics {
  quality: string;
  loadSpeed: string;
  pingTime: number;
}

export interface PlaybackSourcePrefetchParams {
  title: string;
  year?: string;
  searchType?: string;
  query?: string;
  preferBest?: boolean;
}

export interface PlaybackSourcePrefetchResult {
  key: string;
  sources: SearchResult[];
  bestSource: SearchResult;
  videoInfoMap: Map<string, PlaybackSourceMetrics>;
}

const PREFETCH_CONCURRENCY = 2;

const settledPrefetchCache = new Map<
  string,
  PlaybackSourcePrefetchResult | null
>();
const inflightPrefetches = new Map<
  string,
  Promise<PlaybackSourcePrefetchResult | null>
>();
const pendingPrefetchResolvers: Array<() => void> = [];

let activePrefetchCount = 0;

function normalizeMatchText(value: string): string {
  return value.replaceAll(' ', '').trim().toLowerCase();
}

function parseSpeedInKilobytes(loadSpeed: string): number {
  if (loadSpeed === '未知' || loadSpeed === '测量中...') {
    return 0;
  }

  const match = loadSpeed.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
  if (!match) {
    return 0;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return match[2] === 'MB/s' ? value * 1024 : value;
}

function calculateSourceScore(
  metrics: PlaybackSourceMetrics,
  maxSpeed: number,
  minPing: number,
  maxPing: number
): number {
  const qualityScore = (() => {
    switch (metrics.quality) {
      case '4K':
        return 100;
      case '2K':
        return 85;
      case '1080p':
        return 75;
      case '720p':
        return 60;
      case '480p':
        return 40;
      case 'SD':
        return 20;
      default:
        return 0;
    }
  })();

  const speedScore = (() => {
    const speedInKilobytes = parseSpeedInKilobytes(metrics.loadSpeed);
    if (speedInKilobytes <= 0) {
      return 30;
    }

    return Math.min(100, Math.max(0, (speedInKilobytes / maxSpeed) * 100));
  })();

  const pingScore = (() => {
    if (metrics.pingTime <= 0) {
      return 0;
    }

    if (maxPing === minPing) {
      return 100;
    }

    return Math.min(
      100,
      Math.max(0, ((maxPing - metrics.pingTime) / (maxPing - minPing)) * 100)
    );
  })();

  return Math.round(
    (qualityScore * 0.4 + speedScore * 0.4 + pingScore * 0.2) * 100
  ) / 100;
}

async function withPrefetchSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activePrefetchCount >= PREFETCH_CONCURRENCY) {
    await new Promise<void>((resolve) => {
      pendingPrefetchResolvers.push(resolve);
    });
  }

  activePrefetchCount += 1;

  try {
    return await task();
  } finally {
    activePrefetchCount = Math.max(0, activePrefetchCount - 1);
    pendingPrefetchResolvers.shift()?.();
  }
}

function matchesSearchType(
  result: SearchResult,
  searchType: string | undefined
): boolean {
  if (!searchType) {
    return true;
  }

  if (searchType === 'tv') {
    return result.episodes.length > 1;
  }

  if (searchType === 'movie') {
    return result.episodes.length === 1;
  }

  return true;
}

function buildSourceInfoKey(source: SearchResult): string {
  return `${source.source}-${source.id}`;
}

function buildSearchQuery(params: PlaybackSourcePrefetchParams): string {
  return (params.query || params.title).trim();
}

export function getPlaybackSourcePrefetchKey(
  params: PlaybackSourcePrefetchParams
): string {
  return JSON.stringify({
    title: params.title.trim(),
    year: params.year?.trim() || '',
    searchType: params.searchType?.trim() || '',
    query: params.query?.trim() || '',
    preferBest: params.preferBest !== false,
  });
}

export function buildPlaybackSourcePlayUrl(
  params: PlaybackSourcePrefetchParams,
  source: SearchResult
): string {
  const searchParams = new URLSearchParams({
    source: source.source,
    id: source.id,
    title: params.title.trim(),
  });

  if (params.year?.trim()) {
    searchParams.set('year', params.year.trim());
  }

  if (params.searchType?.trim()) {
    searchParams.set('stype', params.searchType.trim());
  }

  if (params.query?.trim()) {
    searchParams.set('stitle', params.query.trim());
  }

  return `/play?${searchParams.toString()}`;
}

export function filterPlaybackSearchResults(
  results: SearchResult[],
  params: PlaybackSourcePrefetchParams
): SearchResult[] {
  const expectedTitle = normalizeMatchText(params.title);
  const expectedYear = params.year?.trim().toLowerCase() || '';

  return normalizeVodSearchResultsForPlayback(
    results.filter((result) => {
      if (normalizeMatchText(result.title) !== expectedTitle) {
        return false;
      }

      if (expectedYear && result.year.trim().toLowerCase() !== expectedYear) {
        return false;
      }

      return matchesSearchType(result, params.searchType);
    })
  );
}

export async function preferBestPlaybackSource(
  sources: SearchResult[]
): Promise<{
  bestSource: SearchResult;
  videoInfoMap: Map<string, PlaybackSourceMetrics>;
}> {
  if (sources.length === 1) {
    return {
      bestSource: sources[0],
      videoInfoMap: new Map(),
    };
  }

  const batchSize = Math.ceil(sources.length / 2);
  const allResults: Array<{
    source: SearchResult;
    metrics: PlaybackSourceMetrics;
  } | null> = [];

  for (let start = 0; start < sources.length; start += batchSize) {
    const batchSources = sources.slice(start, start + batchSize);
    const batchResults = await Promise.all(
      batchSources.map(async (source) => {
        try {
          if (!source.episodes || source.episodes.length === 0) {
            return null;
          }

          const episodeUrl =
            source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];
          const metrics = await getVideoResolutionFromM3u8(episodeUrl);

          return {
            source,
            metrics,
          };
        } catch (error) {
          return null;
        }
      })
    );
    allResults.push(...batchResults);
  }

  const videoInfoMap = new Map<string, PlaybackSourceMetrics>();

  allResults.forEach((result) => {
    if (!result) {
      return;
    }

    videoInfoMap.set(buildSourceInfoKey(result.source), result.metrics);
  });

  const successfulResults = allResults.filter(Boolean) as Array<{
    source: SearchResult;
    metrics: PlaybackSourceMetrics;
  }>;

  if (successfulResults.length === 0) {
    return {
      bestSource: sources[0],
      videoInfoMap,
    };
  }

  const validSpeeds = successfulResults
    .map((result) => parseSpeedInKilobytes(result.metrics.loadSpeed))
    .filter((speed) => speed > 0);
  const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024;

  const validPings = successfulResults
    .map((result) => result.metrics.pingTime)
    .filter((ping) => ping > 0);
  const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
  const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

  const scoredResults = successfulResults
    .map((result) => ({
      ...result,
      score: calculateSourceScore(
        result.metrics,
        maxSpeed,
        minPing,
        maxPing
      ),
    }))
    .sort((left, right) => right.score - left.score);

  return {
    bestSource: scoredResults[0].source,
    videoInfoMap,
  };
}

export function getPrefetchedPlaybackSource(
  params: PlaybackSourcePrefetchParams
): PlaybackSourcePrefetchResult | null | undefined {
  return settledPrefetchCache.get(getPlaybackSourcePrefetchKey(params));
}

export async function prefetchBestPlaybackSource(
  params: PlaybackSourcePrefetchParams
): Promise<PlaybackSourcePrefetchResult | null> {
  const key = getPlaybackSourcePrefetchKey(params);
  const settledResult = settledPrefetchCache.get(key);
  if (settledResult !== undefined) {
    return settledResult;
  }

  const inflightResult = inflightPrefetches.get(key);
  if (inflightResult) {
    return inflightResult;
  }

  const task = withPrefetchSlot(async () => {
    const searchQuery = buildSearchQuery(params);
    if (!searchQuery) {
      settledPrefetchCache.set(key, null);
      return null;
    }

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(searchQuery)}`,
        {
          credentials: 'same-origin',
        }
      );

      if (!response.ok) {
        settledPrefetchCache.set(key, null);
        return null;
      }

      const data = (await response.json()) as { results?: SearchResult[] };
      const sources = filterPlaybackSearchResults(data.results || [], params);

      if (sources.length === 0) {
        settledPrefetchCache.set(key, null);
        return null;
      }

      const { bestSource, videoInfoMap } =
        params.preferBest === false
          ? {
              bestSource: sources[0],
              videoInfoMap: new Map<string, PlaybackSourceMetrics>(),
            }
          : await preferBestPlaybackSource(sources);

      const result: PlaybackSourcePrefetchResult = {
        key,
        sources,
        bestSource,
        videoInfoMap,
      };

      settledPrefetchCache.set(key, result);
      return result;
    } catch (error) {
      settledPrefetchCache.set(key, null);
      return null;
    }
  });

  inflightPrefetches.set(key, task);

  try {
    return await task;
  } finally {
    inflightPrefetches.delete(key);
  }
}
