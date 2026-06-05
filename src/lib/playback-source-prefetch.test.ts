import { SearchResult } from '@/lib/types';

import {
  buildPlaybackSourcePlayUrl,
  filterPlaybackSearchResults,
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

    expect(results.map((result) => result.id)).toEqual(['matched', 'similar']);
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
});
