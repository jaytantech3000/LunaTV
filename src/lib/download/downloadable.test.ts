jest.mock('@/lib/playback-source-prefetch', () => ({
  searchPlaybackSources: jest.fn(),
}));

jest.mock('@/lib/transport/api-client', () => ({
  apiFetch: jest.fn(),
}));

import { searchPlaybackSources } from '@/lib/playback-source-prefetch';
import { apiFetch } from '@/lib/transport/api-client';
import { SearchResult } from '@/lib/types';

import {
  mergeDownloadableSourceLists,
  resolveDownloadablePlaybackSources,
} from './downloadable';

function buildSearchResult(partial: Partial<SearchResult>): SearchResult {
  return {
    id: partial.id || 'vod-id',
    title: partial.title || '测试影片',
    poster: partial.poster || 'https://example.com/poster.jpg',
    episodes: partial.episodes || ['https://example.com/current/index.m3u8'],
    episodes_titles: partial.episodes_titles || ['第1集'],
    source: partial.source || 'demo',
    source_name: partial.source_name || '演示源',
    year: partial.year || '2026',
    desc: partial.desc,
    type_name: partial.type_name,
    douban_id: partial.douban_id,
  };
}

function createJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

const apiFetchMock = apiFetch as jest.MockedFunction<typeof apiFetch>;
const searchPlaybackSourcesMock = searchPlaybackSources as jest.MockedFunction<
  typeof searchPlaybackSources
>;

describe('downloadable source helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the requested detail first and removes duplicate discovered sources', async () => {
    const directDetail = buildSearchResult({
      source: 'bfzy',
      id: '1001',
      episodes: ['https://example.com/direct/index.m3u8'],
    });
    const duplicate = buildSearchResult({
      source: 'bfzy',
      id: '1001',
      episodes: ['https://example.com/direct/index.m3u8'],
    });
    const fallback = buildSearchResult({
      source: 'ffm3u8',
      id: '2002',
      episodes: ['https://example.com/fallback/index.m3u8'],
    });

    apiFetchMock.mockResolvedValue(createJsonResponse(directDetail));
    searchPlaybackSourcesMock.mockResolvedValue([duplicate, fallback]);

    const result = await resolveDownloadablePlaybackSources({
      source: 'bfzy',
      id: '1001',
      title: '测试影片',
      year: '2026',
      query: '测试影片',
    });

    expect(result.detail.source).toBe('bfzy');
    expect(result.detail.id).toBe('1001');
    expect(result.availableSources).toEqual([fallback]);
  });

  it('falls back to searched playback sources when direct detail lookup fails', async () => {
    const searched = buildSearchResult({
      source: 'ffm3u8',
      id: '3003',
      episodes: ['https://example.com/fallback/index.m3u8'],
    });

    apiFetchMock.mockRejectedValue(new Error('detail failed'));
    searchPlaybackSourcesMock.mockResolvedValue([searched]);

    const result = await resolveDownloadablePlaybackSources({
      source: 'bfzy',
      id: '4040',
      title: '测试影片',
      year: '2026',
      query: '测试影片',
    });

    expect(result.detail).toEqual(searched);
    expect(result.availableSources).toEqual([]);
  });

  it('merges source lists without repeating identical source-id pairs', () => {
    const directDetail = buildSearchResult({
      source: 'bfzy',
      id: '1001',
    });
    const duplicate = buildSearchResult({
      source: 'bfzy',
      id: '1001',
    });
    const backup = buildSearchResult({
      source: 'ffm3u8',
      id: '2002',
    });

    expect(
      mergeDownloadableSourceLists([directDetail], [duplicate, backup])
    ).toEqual([directDetail, backup]);
  });
});
