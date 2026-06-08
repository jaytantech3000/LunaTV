import {
  getContentDetail,
  getContentSuggestions,
  searchContent,
  searchContentInResource,
} from './service';

import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { getDetailFromApi, searchFromApi } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';
import { filterAdultContentResults } from '@/lib/yellow';

jest.mock('@/lib/config', () => ({
  getAvailableApiSites: jest.fn(),
  getCacheTime: jest.fn(),
  getConfig: jest.fn(),
}));

jest.mock('@/lib/downstream', () => ({
  getDetailFromApi: jest.fn(),
  searchFromApi: jest.fn(),
}));

jest.mock('@/lib/yellow', () => ({
  filterAdultContentResults: jest.fn(),
}));

function buildSearchResult(partial: Partial<SearchResult>): SearchResult {
  return {
    id: partial.id || 'video-id',
    title: partial.title || '示例标题',
    poster: partial.poster || '',
    episodes: partial.episodes || ['https://example.com/index.m3u8'],
    episodes_titles: partial.episodes_titles || ['第1集'],
    source: partial.source || 'demo',
    source_name: partial.source_name || '演示源',
    year: partial.year || '2026',
    desc: partial.desc,
    type_name: partial.type_name,
    douban_id: partial.douban_id,
  };
}

const authContext = {
  username: 'demo',
  source: 'internal',
} as const;

describe('content service', () => {
  const mockedGetConfig = getConfig as jest.Mock;
  const mockedGetAvailableApiSites = getAvailableApiSites as jest.Mock;
  const mockedGetCacheTime = getCacheTime as jest.Mock;
  const mockedSearchFromApi = searchFromApi as jest.Mock;
  const mockedGetDetailFromApi = getDetailFromApi as jest.Mock;
  const mockedFilterAdultContentResults =
    filterAdultContentResults as jest.Mock;
  const originalConsoleWarn = console.warn;

  beforeEach(() => {
    mockedGetConfig.mockResolvedValue({
      SiteConfig: {
        DisableYellowFilter: false,
        SearchDownstreamMaxPage: 4,
        SiteInterfaceCacheTime: 7200,
      },
      SourceConfig: [],
      UserConfig: {
        Users: [],
      },
    });
    mockedGetAvailableApiSites.mockResolvedValue([
      {
        key: 'alpha',
        name: 'Alpha',
        api: 'https://alpha.example',
      },
      {
        key: 'beta',
        name: 'Beta',
        api: 'https://beta.example',
      },
    ]);
    mockedGetCacheTime.mockResolvedValue(7200);
    mockedFilterAdultContentResults.mockImplementation(
      (results: SearchResult[]) => results
    );
    console.warn = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    console.warn = originalConsoleWarn;
  });

  it('returns cached empty search response without loading full context', async () => {
    const result = await searchContent({
      authContext,
      query: '   ',
    });

    expect(result).toEqual({
      results: [],
      cacheTime: 7200,
    });
    expect(mockedGetCacheTime).toHaveBeenCalledTimes(1);
    expect(mockedGetConfig).not.toHaveBeenCalled();
    expect(mockedSearchFromApi).not.toHaveBeenCalled();
  });

  it('searches all sites with injected maxPages and filters visible results', async () => {
    const safeResult = buildSearchResult({
      id: 'safe',
      title: '正常结果',
      source: 'alpha',
    });
    const filteredResult = buildSearchResult({
      id: 'filtered',
      title: '正常结果 加强版',
      source: 'beta',
    });

    mockedSearchFromApi
      .mockResolvedValueOnce([safeResult])
      .mockRejectedValueOnce(new Error('beta timeout'));
    mockedFilterAdultContentResults.mockReturnValue([filteredResult]);

    const result = await searchContent({
      authContext,
      query: '正常结果',
    });

    expect(mockedSearchFromApi).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ key: 'alpha' }),
      '正常结果',
      { maxPages: 4 }
    );
    expect(mockedSearchFromApi).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ key: 'beta' }),
      '正常结果',
      { maxPages: 4 }
    );
    expect(result).toEqual({
      results: [filteredResult],
      cacheTime: 7200,
    });
  });

  it('returns exact resource matches and raises not found when source is missing', async () => {
    const exactMatch = buildSearchResult({
      id: 'match',
      title: '雨霖铃',
      source: 'alpha',
    });
    const fuzzyMatch = buildSearchResult({
      id: 'fuzzy',
      title: '雨霖铃2026',
      source: 'alpha',
    });

    mockedSearchFromApi.mockResolvedValueOnce([exactMatch, fuzzyMatch]);

    await expect(
      searchContentInResource({
        authContext,
        query: '雨霖铃',
        resourceId: 'alpha',
      })
    ).resolves.toEqual({
      results: [exactMatch],
      cacheTime: 7200,
    });

    await expect(
      searchContentInResource({
        authContext,
        query: '雨霖铃',
        resourceId: 'missing',
      })
    ).rejects.toMatchObject({
      message: '未找到指定的视频源: missing',
      status: 404,
    });
  });

  it('builds suggestions from visible search results and returns detail data', async () => {
    mockedSearchFromApi.mockResolvedValueOnce([
      buildSearchResult({
        id: 'one',
        title: '雨霖铃 终章',
      }),
      buildSearchResult({
        id: 'two',
        title: '雨霖铃外传',
      }),
    ]);
    mockedGetDetailFromApi.mockResolvedValueOnce(
      buildSearchResult({
        id: 'detail-id',
        title: '详情标题',
        source: 'beta',
      })
    );

    const suggestionResult = await getContentSuggestions({
      authContext,
      query: '雨霖铃',
    });
    const detailResult = await getContentDetail({
      authContext,
      id: 'detail-id',
      sourceCode: 'beta',
    });

    expect(suggestionResult.cacheTime).toBe(7200);
    expect(suggestionResult.suggestions.map((item) => item.text)).toEqual([
      '雨霖铃',
      '雨霖铃外传',
    ]);
    expect(mockedGetDetailFromApi).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'beta' }),
      'detail-id'
    );
    expect(detailResult).toEqual({
      result: buildSearchResult({
        id: 'detail-id',
        title: '详情标题',
        source: 'beta',
      }),
      cacheTime: 7200,
    });
  });
});
