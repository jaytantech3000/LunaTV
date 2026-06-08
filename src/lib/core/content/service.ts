import {
  ApiSite,
  getAvailableApiSites,
  getCacheTime,
  getConfig,
} from '@/lib/config';
import { getDetailFromApi, searchFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';
import { filterAdultContentResults } from '@/lib/yellow';

export interface ContentSuggestion {
  text: string;
  type: 'exact' | 'related' | 'suggestion';
  score: number;
}

export class ContentServiceError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ContentServiceError';
    this.status = status;
  }
}

interface ContentServiceContext {
  apiSites: ApiSite[];
  cacheTime: number;
  maxSearchPages: number;
  adultContentFilterEnabled: boolean;
}

function normalizeQuery(query: string | null | undefined): string {
  return query?.trim() || '';
}

function applyAdultContentFilter(
  results: SearchResult[],
  adultContentFilterEnabled: boolean
): SearchResult[] {
  return adultContentFilterEnabled
    ? filterAdultContentResults(results)
    : results;
}

async function loadContentServiceContext(
  username: string
): Promise<ContentServiceContext> {
  const config = await getConfig();
  const [apiSites, cacheTime] = await Promise.all([
    getAvailableApiSites(username, config),
    getCacheTime(config),
  ]);

  return {
    apiSites,
    cacheTime,
    maxSearchPages: Math.max(1, config.SiteConfig.SearchDownstreamMaxPage || 5),
    adultContentFilterEnabled: !config.SiteConfig.DisableYellowFilter,
  };
}

async function searchSiteWithTimeout(
  site: ApiSite,
  query: string,
  maxSearchPages: number,
  timeoutMs = 20000
): Promise<SearchResult[]> {
  return Promise.race([
    searchFromApi(site, query, {
      maxPages: maxSearchPages,
    }),
    new Promise<SearchResult[]>((_, reject) =>
      setTimeout(() => reject(new Error(`${site.name} timeout`)), timeoutMs)
    ),
  ]);
}

function buildSuggestions(
  query: string,
  results: SearchResult[]
): ContentSuggestion[] {
  const queryLower = query.toLowerCase();
  const realKeywords = Array.from(
    new Set(
      results
        .map((result) => result.title)
        .filter(Boolean)
        .flatMap((title) => title.split(/[ -:：·、-]/))
        .filter(
          (word) => word.length > 1 && word.toLowerCase().includes(queryLower)
        )
    )
  ).slice(0, 8);

  return realKeywords
    .map((word) => {
      const wordLower = word.toLowerCase();
      const queryWords = queryLower.split(/[ -:：·、-]/);
      let score = 1.0;

      if (wordLower === queryLower) {
        score = 2.0;
      } else if (
        wordLower.startsWith(queryLower) ||
        wordLower.endsWith(queryLower)
      ) {
        score = 1.8;
      } else if (
        queryWords.some((queryWord) => wordLower.includes(queryWord))
      ) {
        score = 1.5;
      }

      let type: ContentSuggestion['type'] = 'related';
      if (score >= 2.0) {
        type = 'exact';
      } else if (score < 1.5) {
        type = 'suggestion';
      }

      return {
        text: word,
        type,
        score,
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      const typePriority: Record<ContentSuggestion['type'], number> = {
        exact: 3,
        related: 2,
        suggestion: 1,
      };

      return typePriority[right.type] - typePriority[left.type];
    });
}

export async function searchContent(params: {
  username: string;
  query: string | null;
}): Promise<{
  results: SearchResult[];
  cacheTime: number;
}> {
  const query = normalizeQuery(params.query);

  if (!query) {
    return {
      results: [],
      cacheTime: await getCacheTime(),
    };
  }

  const context = await loadContentServiceContext(params.username);
  const searchResults = await Promise.allSettled(
    context.apiSites.map((site) =>
      searchSiteWithTimeout(site, query, context.maxSearchPages).catch(
        (error) => {
          console.warn(
            `搜索失败 ${site.name}:`,
            error instanceof Error ? error.message : error
          );
          return [];
        }
      )
    )
  );

  let results = searchResults
    .filter(
      (result): result is PromiseFulfilledResult<SearchResult[]> =>
        result.status === 'fulfilled'
    )
    .flatMap((result) => result.value);

  results = applyAdultContentFilter(results, context.adultContentFilterEnabled);

  return {
    results,
    cacheTime: context.cacheTime,
  };
}

export async function searchContentInResource(params: {
  username: string;
  query: string;
  resourceId: string;
}): Promise<{
  results: SearchResult[];
  cacheTime: number;
}> {
  const query = normalizeQuery(params.query);
  const resourceId = params.resourceId.trim();
  const context = await loadContentServiceContext(params.username);
  const targetSite = context.apiSites.find((site) => site.key === resourceId);

  if (!targetSite) {
    throw new ContentServiceError(`未找到指定的视频源: ${resourceId}`, 404);
  }

  let results = await searchFromApi(targetSite, query, {
    maxPages: context.maxSearchPages,
  });
  results = results.filter((result) => result.title === query);
  results = applyAdultContentFilter(results, context.adultContentFilterEnabled);

  if (results.length === 0) {
    throw new ContentServiceError('未找到结果', 404);
  }

  return {
    results,
    cacheTime: context.cacheTime,
  };
}

export async function getContentResources(params: {
  username: string;
}): Promise<ApiSite[]> {
  const context = await loadContentServiceContext(params.username);
  return context.apiSites;
}

export async function getContentSuggestions(params: {
  username: string;
  query: string | null;
}): Promise<{
  suggestions: ContentSuggestion[];
  cacheTime?: number;
}> {
  const query = normalizeQuery(params.query);

  if (!query) {
    return {
      suggestions: [],
    };
  }

  const context = await loadContentServiceContext(params.username);
  const firstSite = context.apiSites[0];

  if (!firstSite) {
    return {
      suggestions: [],
      cacheTime: context.cacheTime,
    };
  }

  const searchResults = await searchFromApi(firstSite, query, {
    maxPages: context.maxSearchPages,
  });
  const visibleResults = applyAdultContentFilter(
    searchResults,
    context.adultContentFilterEnabled
  );

  return {
    suggestions: buildSuggestions(query, visibleResults),
    cacheTime: context.cacheTime,
  };
}

export async function getContentDetail(params: {
  username: string;
  id: string;
  sourceCode: string;
}): Promise<{
  result: SearchResult;
  cacheTime: number;
}> {
  const context = await loadContentServiceContext(params.username);
  const apiSite = context.apiSites.find(
    (site) => site.key === params.sourceCode
  );

  if (!apiSite) {
    throw new ContentServiceError('无效的API来源', 400);
  }

  return {
    result: await getDetailFromApi(apiSite, params.id),
    cacheTime: context.cacheTime,
  };
}
