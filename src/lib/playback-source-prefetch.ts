import { normalizeVodSearchResultsForPlayback } from '@/lib/download/normalize';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { apiFetch } from '@/lib/transport/api-client';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';
import { filterAdultContentResults } from '@/lib/yellow';

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
  doubanId?: number;
  preferBest?: boolean;
  allowAdultCandidates?: boolean;
}

const MIN_LOOSE_TITLE_MATCH_LENGTH = 3;
const PREVIEW_LIKE_TITLE_PATTERN =
  /(预告(?:片)?|片花|花絮|先导(?:片)?|抢先版|彩蛋|番外|幕后|解说|速看|cut|剪辑)/i;

function normalizeMatchText(value: string): string {
  return normalizeSeasonMarkers(value)
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\-_.·•・:：,，!！?？'"“”‘’`~()（）[\]【】{}<>《》/\\|]/g, '');
}

function normalizePositiveNumber(
  value: number | undefined
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined;
}

function parseLooseSeasonNumber(value: string): number | null {
  const normalizedValue = value.trim().toUpperCase();

  if (!normalizedValue) {
    return null;
  }

  if (/^\d+$/.test(normalizedValue)) {
    const numericValue = Number(normalizedValue);
    return Number.isFinite(numericValue) && numericValue > 0
      ? numericValue
      : null;
  }

  const romanMap: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
  };

  if (/^[IVXLCDM]+$/.test(normalizedValue)) {
    let total = 0;
    let previous = 0;

    for (let index = normalizedValue.length - 1; index >= 0; index -= 1) {
      const current = romanMap[normalizedValue[index]];
      if (!current) {
        return null;
      }

      if (current < previous) {
        total -= current;
      } else {
        total += current;
        previous = current;
      }
    }

    return total > 0 ? total : null;
  }

  const chineseDigits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (normalizedValue === '十') {
    return 10;
  }

  const tenIndex = normalizedValue.indexOf('十');
  if (tenIndex >= 0) {
    const tensRaw = normalizedValue.slice(0, tenIndex);
    const unitsRaw = normalizedValue.slice(tenIndex + 1);
    const tens = tensRaw ? chineseDigits[tensRaw] : 1;
    const units = unitsRaw ? chineseDigits[unitsRaw] : 0;

    if (typeof tens === 'number' && typeof units === 'number' && tens > 0) {
      return tens * 10 + units;
    }
  }

  const normalizedCharacters = normalizedValue.split('');

  if (normalizedCharacters.every((char) => char in chineseDigits)) {
    const digits = normalizedCharacters.map((char) => chineseDigits[char]);

    if (digits.some((digit) => digit === undefined)) {
      return null;
    }

    return Number(digits.join(''));
  }

  return null;
}

function normalizeSeasonMarkers(value: string): string {
  return value
    .replace(
      /第([零〇一二两三四五六七八九十IVXLCDM\d]+)(季|部|期)/gi,
      (_, rawNumber: string) => {
        const normalizedNumber = parseLooseSeasonNumber(rawNumber);
        return normalizedNumber
          ? ` season${normalizedNumber} `
          : ` ${rawNumber} `;
      }
    )
    .replace(/season\s*([IVXLCDM\d]+)/gi, (_, rawNumber: string) => {
      const normalizedNumber = parseLooseSeasonNumber(rawNumber);
      return normalizedNumber
        ? ` season${normalizedNumber} `
        : ` ${rawNumber} `;
    });
}

function isPreviewLikeTitle(value: string): boolean {
  return PREVIEW_LIKE_TITLE_PATTERN.test(value);
}

function buildTitleMatchCandidates(
  params: PlaybackSourcePrefetchParams
): string[] {
  return Array.from(
    new Set(
      [params.title, params.query]
        .map((value) => normalizeMatchText(value || ''))
        .filter(Boolean)
    )
  );
}

function scoreNormalizedTitleMatch(
  candidate: string,
  expected: string
): number {
  if (!candidate || !expected) {
    return Number.NEGATIVE_INFINITY;
  }

  if (candidate === expected) {
    return 420;
  }

  if (candidate.startsWith(expected) || expected.startsWith(candidate)) {
    return 280;
  }

  if (candidate.includes(expected) || expected.includes(candidate)) {
    if (
      Math.min(candidate.length, expected.length) < MIN_LOOSE_TITLE_MATCH_LENGTH
    ) {
      return Number.NEGATIVE_INFINITY;
    }

    return 220;
  }

  return Number.NEGATIVE_INFINITY;
}

function scorePlaybackSearchResult(
  result: SearchResult,
  params: PlaybackSourcePrefetchParams
): number {
  const expectedDoubanId = normalizePositiveNumber(params.doubanId);
  const resultDoubanId = normalizePositiveNumber(result.douban_id);
  const matchesDoubanId =
    expectedDoubanId !== undefined && resultDoubanId === expectedDoubanId;
  const normalizedTitle = normalizeMatchText(result.title || '');
  const titleScores = buildTitleMatchCandidates(params)
    .map((candidate) => scoreNormalizedTitleMatch(normalizedTitle, candidate))
    .filter(Number.isFinite);

  if (!matchesDoubanId && titleScores.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = matchesDoubanId ? 1000 : 0;

  if (titleScores.length > 0) {
    score += Math.max(...titleScores);
  }

  const expectedYear = params.year?.trim().toLowerCase() || '';
  const resultYear = result.year?.trim().toLowerCase() || '';
  if (expectedYear) {
    if (resultYear === expectedYear) {
      score += 80;
    } else if (resultYear) {
      score -= 120;
    }
  }

  if (params.searchType) {
    if (matchesSearchType(result, params.searchType)) {
      score += 40;
    } else {
      score -= 120;
    }
  }

  score += result.episodes.length > 1 ? 10 : 5;
  return score;
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

  return (
    Math.round(
      (qualityScore * 0.4 + speedScore * 0.4 + pingScore * 0.2) * 100
    ) / 100
  );
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

function buildSearchResultKey(result: SearchResult): string {
  return `${result.source}-${result.id}`;
}

function mergePlaybackSearchResults(
  existing: SearchResult[],
  incoming: SearchResult[]
): SearchResult[] {
  if (incoming.length === 0) {
    return existing;
  }

  const mergedResults = [...existing];
  const seenKeys = new Set(existing.map(buildSearchResultKey));

  incoming.forEach((result) => {
    const key = buildSearchResultKey(result);
    if (seenKeys.has(key)) {
      return;
    }

    seenKeys.add(key);
    mergedResults.push(result);
  });

  return mergedResults;
}

function hasExactDoubanMatch(
  sources: SearchResult[],
  expectedDoubanId: number | undefined
): boolean {
  if (expectedDoubanId === undefined) {
    return false;
  }

  return sources.some(
    (source) => normalizePositiveNumber(source.douban_id) === expectedDoubanId
  );
}

function hasHighConfidenceDoubanMatch(
  sources: SearchResult[],
  params: PlaybackSourcePrefetchParams
): boolean {
  const expectedDoubanId = normalizePositiveNumber(params.doubanId);
  if (expectedDoubanId === undefined) {
    return sources.length > 0;
  }

  const exactMatches = sources.filter(
    (source) => normalizePositiveNumber(source.douban_id) === expectedDoubanId
  );

  if (exactMatches.length === 0) {
    return false;
  }

  if (params.searchType === 'movie') {
    return exactMatches.some(
      (source) => !isPreviewLikeTitle(source.title || '')
    );
  }

  return exactMatches.some(
    (source) =>
      source.episodes.length > 1 && !isPreviewLikeTitle(source.title || '')
  );
}

async function fetchPlaybackSearchQuery(
  query: string
): Promise<SearchResult[]> {
  const response = await apiFetch('/search', {
    credentials: 'same-origin',
    searchParams: { q: query },
  });

  if (!response.ok) {
    throw new Error('搜索失败');
  }

  const data = (await response.json()) as { results?: SearchResult[] };
  return Array.isArray(data.results) ? data.results : [];
}

function shouldUseDesktopPlaybackSourcePrefetch(): boolean {
  return getRuntimeConfig().APP_TARGET === 'desktop';
}

async function fetchPlaybackSourcesFromDesktopRuntime(
  params: PlaybackSourcePrefetchParams
): Promise<SearchResult[]> {
  const response = await apiFetch('/playback/search-sources', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
    cache: 'no-store',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error('桌面播放源预筛选失败');
  }

  const payload = (await response.json()) as { results?: SearchResult[] };
  const results = Array.isArray(payload.results) ? payload.results : [];
  return normalizeVodSearchResultsForPlayback(results);
}

export function buildPlaybackSearchQueries(
  params: PlaybackSourcePrefetchParams
): string[] {
  const year = params.year?.trim() || '';
  const queries = new Set<string>();

  [params.query, params.title].forEach((value) => {
    const base = value?.trim();
    if (!base) {
      return;
    }

    queries.add(base);

    if (!year || base.includes(year)) {
      return;
    }

    queries.add(`${base} ${year}`);
    queries.add(`${base}${year}`);
    queries.add(`${base} (${year})`);
    queries.add(`${base}(${year})`);
  });

  return Array.from(queries);
}

export function filterPlaybackSearchResults(
  results: SearchResult[],
  params: PlaybackSourcePrefetchParams
): SearchResult[] {
  const candidateResults = params.allowAdultCandidates
    ? results
    : filterAdultContentResults(results);

  const scoredResults = candidateResults
    .map((result) => ({
      result,
      score: scorePlaybackSearchResult(result, params),
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.result.episodes.length !== left.result.episodes.length) {
        return right.result.episodes.length - left.result.episodes.length;
      }

      return left.result.title.localeCompare(right.result.title, 'zh-CN');
    });

  const expectedDoubanId = normalizePositiveNumber(params.doubanId);
  const exactDoubanMatches =
    expectedDoubanId === undefined
      ? []
      : scoredResults.filter(({ result }) => {
          const resultDoubanId = normalizePositiveNumber(result.douban_id);
          return resultDoubanId === expectedDoubanId;
        });

  if (exactDoubanMatches.length > 0) {
    const multiEpisodeExactMatches = exactDoubanMatches.filter(
      ({ result }) => result.episodes.length > 1
    );
    const exactMatchPool =
      multiEpisodeExactMatches.length > 0
        ? multiEpisodeExactMatches
        : exactDoubanMatches;
    const nonPreviewExactMatches = exactMatchPool.filter(
      ({ result }) => !isPreviewLikeTitle(result.title || '')
    );
    const exactResults =
      nonPreviewExactMatches.length > 0
        ? nonPreviewExactMatches
        : exactMatchPool;

    return normalizeVodSearchResultsForPlayback(
      exactResults.map(({ result }) => result)
    );
  }

  const strictMatches = scoredResults
    .filter(({ score }) => score >= 220)
    .map(({ result }) => result);

  if (strictMatches.length > 0) {
    return normalizeVodSearchResultsForPlayback(strictMatches);
  }

  return normalizeVodSearchResultsForPlayback(
    scoredResults
      .filter(({ score }) => score >= 180)
      .slice(0, 3)
      .map(({ result }) => result)
  );
}

export async function searchPlaybackSources(
  params: PlaybackSourcePrefetchParams
): Promise<SearchResult[]> {
  if (shouldUseDesktopPlaybackSourcePrefetch()) {
    return fetchPlaybackSourcesFromDesktopRuntime(params);
  }

  const queries = buildPlaybackSearchQueries(params);
  const expectedDoubanId = normalizePositiveNumber(params.doubanId);

  if (queries.length === 0) {
    return [];
  }

  let aggregatedResults: SearchResult[] = [];
  let fallbackSources: SearchResult[] = [];
  let successfulQueryCount = 0;
  let lastError: Error | null = null;

  for (const query of queries) {
    try {
      const rawResults = await fetchPlaybackSearchQuery(query);
      successfulQueryCount += 1;
      aggregatedResults = mergePlaybackSearchResults(
        aggregatedResults,
        rawResults
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('搜索失败');
      continue;
    }

    if (aggregatedResults.length === 0) {
      continue;
    }

    const sources = filterPlaybackSearchResults(aggregatedResults, params);

    if (sources.length === 0) {
      continue;
    }

    fallbackSources = sources;

    if (
      expectedDoubanId === undefined ||
      (hasExactDoubanMatch(sources, expectedDoubanId) &&
        hasHighConfidenceDoubanMatch(sources, params))
    ) {
      return sources;
    }
  }

  if (fallbackSources.length > 0) {
    return fallbackSources;
  }

  if (successfulQueryCount === 0 && lastError) {
    throw lastError;
  }

  return [];
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
            source.episodes.find((candidateUrl) => Boolean(candidateUrl)) ||
            source.episodes[0];

          if (!episodeUrl) {
            return null;
          }
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
      score: calculateSourceScore(result.metrics, maxSpeed, minPing, maxPing),
    }))
    .sort((left, right) => right.score - left.score);

  return {
    bestSource: scoredResults[0].source,
    videoInfoMap,
  };
}
