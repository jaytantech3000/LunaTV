import {
  buildAdultDownloadGroupingQuery,
  filterAdultGroupingSearchResults,
} from './adult';
import { SearchResult } from '@/lib/types';

function buildSearchResult(partial: Partial<SearchResult>): SearchResult {
  return {
    id: partial.id || 'vod-id',
    title: partial.title || '波多野结衣 私人课程',
    poster: partial.poster || '',
    episodes: partial.episodes || ['https://example.com/current/index.m3u8'],
    episodes_titles: partial.episodes_titles || ['第1集'],
    source: partial.source || 'adult-source',
    source_name: partial.source_name || '🔞成人资源',
    class: partial.class,
    year: partial.year || '2026',
    desc: partial.desc,
    type_name: partial.type_name || '伦理片',
    douban_id: partial.douban_id,
  };
}

describe('buildAdultDownloadGroupingQuery', () => {
  it('prefers the original search title when it looks like a performer name', () => {
    expect(
      buildAdultDownloadGroupingQuery({
        title: '海角社区.第一次和表姐体验AV主角直击AV现场淫声笑语',
        searchTitle: '王雨纯',
        sourceName: '🔞海角资源',
        typeName: '伦理片',
      })
    ).toBe('王雨纯');
  });

  it('falls back to extracting a likely performer token from the title', () => {
    expect(
      buildAdultDownloadGroupingQuery({
        title: '波多野结衣 私人课程',
        sourceName: '🔞成人资源',
        typeName: '伦理片',
      })
    ).toBe('波多野结衣');
  });

  it('returns null when only brand-like adult tokens are available', () => {
    expect(
      buildAdultDownloadGroupingQuery({
        title: '糖心Vlog.谁才是派对真正的主角',
        sourceName: '🔞麻豆视频',
        typeName: '伦理片',
      })
    ).toBeNull();
  });
});

describe('filterAdultGroupingSearchResults', () => {
  it('removes the current item and deduplicates the same title from multiple sources', () => {
    const results = filterAdultGroupingSearchResults(
      [
        buildSearchResult({
          id: 'current',
          title: '波多野结衣 私人课程',
          source: 'source-a',
        }),
        buildSearchResult({
          id: 'duplicate-a',
          title: '波多野结衣 私人课程',
          source: 'source-b',
        }),
        buildSearchResult({
          id: 'duplicate-b',
          title: '波多野结衣 私人课程',
          source: 'source-c',
        }),
        buildSearchResult({
          id: 'related',
          title: '波多野结衣 深夜企划',
          source: 'source-d',
        }),
        buildSearchResult({
          id: 'irrelevant',
          title: '海角社区 夜色派对',
          source: 'source-e',
        }),
      ],
      '波多野结衣',
      {
        source: 'source-a',
        id: 'current',
        title: '波多野结衣 私人课程',
      }
    );

    expect(results.map((result) => result.id)).toEqual([
      'duplicate-a',
      'related',
    ]);
  });
});
