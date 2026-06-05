import { SearchResult } from '@/lib/types';

import {
  buildPlaybackSearchQueries,
  buildPlaybackSourcePlayUrl,
  filterPlaybackSearchResults,
  searchPlaybackSources,
} from './playback-source-prefetch';

function buildSearchResult(partial: Partial<SearchResult>): SearchResult {
  return {
    id: partial.id || 'vod-id',
    title: partial.title || '租借女友第5季',
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

describe('playback source prefetch helpers', () => {
  it('prioritizes exact douban id matches over title formatting differences', () => {
    const matched = buildSearchResult({
      id: 'matched',
      title: '租借女友第5季',
      year: '2026',
      douban_id: 129836,
      source: 'matched-source',
    });
    const similar = buildSearchResult({
      id: 'similar',
      title: '租借女友 第五季 特别篇',
      year: '2026',
      douban_id: 888888,
      source: 'similar-source',
    });

    const results = filterPlaybackSearchResults([similar, matched], {
      title: '租借女友 第五季',
      year: '2026',
      searchType: 'tv',
      doubanId: 129836,
    });

    expect(results.map((result) => result.id)).toEqual(['matched']);
  });

  it('drops preview-only exact matches when full episodes exist', () => {
    const fullSeries = buildSearchResult({
      id: 'series',
      title: '雨霖铃',
      year: '2026',
      douban_id: 36310054,
      source: 'series-source',
      episodes: [
        'https://example.com/episode-1/index.m3u8',
        'https://example.com/episode-2/index.m3u8',
      ],
      episodes_titles: ['第1集', '第2集'],
    });
    const trailer = buildSearchResult({
      id: 'trailer',
      title: '雨霖铃预告片',
      year: '2025',
      douban_id: 36310054,
      source: 'trailer-source',
    });

    const results = filterPlaybackSearchResults([trailer, fullSeries], {
      title: '雨霖铃',
      year: '2026',
      doubanId: 36310054,
    });

    expect(results.map((result) => result.id)).toEqual(['series']);
  });

  it('matches season titles across Chinese numerals and Arabic numerals', () => {
    const exactSeason = buildSearchResult({
      id: 'season-five',
      title: '租借女友第5季',
      year: '2026',
      source: 'season-five-source',
    });
    const otherSeason = buildSearchResult({
      id: 'season-four',
      title: '租借女友第四季',
      year: '2025',
      source: 'season-four-source',
    });

    const results = filterPlaybackSearchResults([otherSeason, exactSeason], {
      title: '租借女友 第五季',
      year: '2026',
      searchType: 'tv',
    });

    expect(results.map((result) => result.id)).toEqual(['season-five']);
  });

  it('filters adult candidates before selecting playback sources', () => {
    const adultMatch = buildSearchResult({
      id: 'adult-match',
      title: '海角社区.第一次和表姐体验AV主角直击AV现场淫声笑语',
      source: 'adult-source',
      source_name: '🔞麻豆视频',
      year: '',
      episodes: [
        'https://example.com/adult-episode-1/index.m3u8',
        'https://example.com/adult-episode-2/index.m3u8',
      ],
      episodes_titles: ['第1集', '第2集'],
    });
    const safeMatch = buildSearchResult({
      id: 'safe-match',
      title: '主角',
      source: 'safe-source',
      source_name: '正版资源',
      year: '2025',
      episodes: [
        'https://example.com/safe-episode-1/index.m3u8',
        'https://example.com/safe-episode-2/index.m3u8',
      ],
      episodes_titles: ['第1集', '第2集'],
    });

    const results = filterPlaybackSearchResults([adultMatch, safeMatch], {
      title: '主角',
      year: '2025',
      searchType: 'tv',
    });

    expect(results.map((result) => result.id)).toEqual(['safe-match']);
  });

  it('does not use loose substring matches for two-character titles', () => {
    const substringOnly = buildSearchResult({
      id: 'substring-only',
      title: '不起眼女主角培养法',
      source: 'safe-source',
      source_name: '普通资源',
      year: '2015',
      episodes: [
        'https://example.com/sub-episode-1/index.m3u8',
        'https://example.com/sub-episode-2/index.m3u8',
      ],
      episodes_titles: ['第1集', '第2集'],
    });

    const results = filterPlaybackSearchResults([substringOnly], {
      title: '主角',
      searchType: 'tv',
    });

    expect(results).toEqual([]);
  });

  it('keeps prefix matches for short titles when the source starts with the title', () => {
    const prefixedMatch = buildSearchResult({
      id: 'prefixed-match',
      title: '主角2026',
      source: 'safe-source',
      source_name: '普通资源',
      year: '2026',
      episodes: [
        'https://example.com/prefix-episode-1/index.m3u8',
        'https://example.com/prefix-episode-2/index.m3u8',
      ],
      episodes_titles: ['第1集', '第2集'],
    });

    const results = filterPlaybackSearchResults([prefixedMatch], {
      title: '主角',
      year: '2026',
      searchType: 'tv',
    });

    expect(results.map((result) => result.id)).toEqual(['prefixed-match']);
  });

  it('preserves douban id in generated play urls', () => {
    const playUrl = buildPlaybackSourcePlayUrl(
      {
        title: '租借女友 第五季',
        year: '2026',
        searchType: 'tv',
        doubanId: 129836,
      },
      buildSearchResult({
        id: 'target-id',
        source: 'target-source',
      })
    );

    expect(playUrl).toContain('source=target-source');
    expect(playUrl).toContain('id=target-id');
    expect(playUrl).toContain('doubanId=129836');
  });

  it('builds year-aware playback search query fallbacks', () => {
    expect(
      buildPlaybackSearchQueries({
        title: '雨霖铃',
        year: '2026',
      })
    ).toEqual([
      '雨霖铃',
      '雨霖铃 2026',
      '雨霖铃2026',
      '雨霖铃 (2026)',
      '雨霖铃(2026)',
    ]);
  });

  it('continues year fallback search until it finds a full exact match', async () => {
    const originalFetch = global.fetch;
    const trailer = buildSearchResult({
      id: 'trailer',
      title: '雨霖铃预告片',
      year: '2025',
      douban_id: 36310054,
      source: 'trailer-source',
    });
    const fullSeries = buildSearchResult({
      id: 'series',
      title: '雨霖铃2026',
      year: '2026',
      douban_id: 36310054,
      source: 'series-source',
      episodes: [
        'https://example.com/episode-1/index.m3u8',
        'https://example.com/episode-2/index.m3u8',
      ],
      episodes_titles: ['第1集', '第2集'],
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [trailer] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [fullSeries] }),
      });

    global.fetch = fetchMock as typeof fetch;

    try {
      const results = await searchPlaybackSources({
        title: '雨霖铃',
        year: '2026',
        doubanId: 36310054,
      });

      expect(results.map((result) => result.id)).toEqual(['series']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        encodeURIComponent('雨霖铃')
      );
      expect(String(fetchMock.mock.calls[1][0])).toContain(
        encodeURIComponent('雨霖铃 2026')
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('filters adult results from playback search requests before returning sources', async () => {
    const originalFetch = global.fetch;
    const adultMatch = buildSearchResult({
      id: 'adult-match',
      title: '糖心Vlog.谁才是派对真正的主角',
      source: 'adult-source',
      source_name: '🔞麻豆视频',
      year: '',
      episodes: [
        'https://example.com/adult-episode-1/index.m3u8',
        'https://example.com/adult-episode-2/index.m3u8',
      ],
      episodes_titles: ['第1集', '第2集'],
    });
    const safeMatch = buildSearchResult({
      id: 'safe-match',
      title: '主角',
      source: 'safe-source',
      source_name: '普通资源',
      year: '2025',
      episodes: [
        'https://example.com/safe-episode-1/index.m3u8',
        'https://example.com/safe-episode-2/index.m3u8',
      ],
      episodes_titles: ['第1集', '第2集'],
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [adultMatch, safeMatch] }),
    });

    global.fetch = fetchMock as typeof fetch;

    try {
      const results = await searchPlaybackSources({
        title: '主角',
        year: '2025',
        searchType: 'tv',
      });

      expect(results.map((result) => result.id)).toEqual(['safe-match']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
