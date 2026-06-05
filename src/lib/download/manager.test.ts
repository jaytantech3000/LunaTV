import { SearchResult } from '@/lib/types';

import { buildDownloadManifestCandidateUrls } from './manager';

function buildSearchResult(partial: Partial<SearchResult>): SearchResult {
  return {
    id: partial.id || 'vod-id',
    title: partial.title || '主角',
    poster: partial.poster || '',
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

describe('download manager manifest candidate helpers', () => {
  it('keeps the current source first and preserves distinct proxy candidates', () => {
    const current = buildSearchResult({
      source: 'feifan',
      source_name: '非凡资源',
      episodes: ['https://example.com/blocked/index.m3u8'],
    });
    const duplicate = buildSearchResult({
      source: 'feifan-copy',
      source_name: '非凡资源镜像',
      episodes: ['https://example.com/blocked/index.m3u8'],
    });
    const playable = buildSearchResult({
      source: 'ikun',
      source_name: 'iKun资源',
      episodes: ['https://example.com/playable/index.m3u8'],
    });
    const proxied = buildSearchResult({
      source: 'bfzy',
      source_name: '暴风资源',
      episodes: [
        '/api/proxy/vod/m3u8?source=bfzy&url=https%3A%2F%2Fexample.com%2Fcached.m3u8',
      ],
    });
    const missingEpisode = buildSearchResult({
      source: 'jyzy',
      source_name: '金鹰资源',
      episodes: [],
    });

    expect(
      buildDownloadManifestCandidateUrls(current, 0, [
        duplicate,
        playable,
        proxied,
        missingEpisode,
      ])
    ).toEqual([
      '/api/proxy/vod/m3u8?source=feifan&url=https%3A%2F%2Fexample.com%2Fblocked%2Findex.m3u8',
      '/api/proxy/vod/m3u8?source=feifan-copy&url=https%3A%2F%2Fexample.com%2Fblocked%2Findex.m3u8',
      '/api/proxy/vod/m3u8?source=ikun&url=https%3A%2F%2Fexample.com%2Fplayable%2Findex.m3u8',
      '/api/proxy/vod/m3u8?source=bfzy&url=https%3A%2F%2Fexample.com%2Fcached.m3u8',
    ]);
  });
});
