import { DownloadedContentMeta, DownloadTask } from '@/lib/download/types';
import { SearchResult } from '@/lib/types';

import {
  applyLibraryMetadataFallback,
  buildDownloadManifestCandidateUrls,
  mergeLibraryItem,
} from './manager';

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

function buildDownloadTask(partial: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: partial.id || 'demo:vod-id:0',
    contentId: partial.contentId || 'demo:vod-id',
    source: partial.source || 'demo',
    sourceName: partial.sourceName || '演示源',
    vodId: partial.vodId || 'vod-id',
    episodeIndex: partial.episodeIndex ?? 0,
    title: partial.title || '主角',
    searchTitle: partial.searchTitle,
    poster: partial.poster || 'https://example.com/poster.jpg',
    year: partial.year || '2026',
    desc: partial.desc,
    typeName: partial.typeName,
    doubanId: partial.doubanId,
    episodeTitle: partial.episodeTitle || '第1集',
    originalM3u8Url:
      partial.originalM3u8Url || 'https://example.com/current/index.m3u8',
    entryManifestUrl:
      partial.entryManifestUrl || 'https://example.com/current/index.m3u8',
    manifestCandidateUrls: partial.manifestCandidateUrls || [
      'https://example.com/current/index.m3u8',
    ],
    playbackManifestUrl: partial.playbackManifestUrl,
    cacheIndexId: partial.cacheIndexId || 'task:demo:vod-id:0',
    status: partial.status || 'queued',
    progress: partial.progress ?? 0,
    totalResources: partial.totalResources ?? 0,
    downloadedResources: partial.downloadedResources ?? 0,
    sizeBytes: partial.sizeBytes ?? 0,
    currentSizeBytes: partial.currentSizeBytes ?? partial.sizeBytes ?? 0,
    estimatedTotalSizeBytes:
      partial.estimatedTotalSizeBytes ?? partial.sizeBytes ?? 0,
    downloadSpeedBytesPerSecond: partial.downloadSpeedBytesPerSecond ?? 0,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    errorMessage: partial.errorMessage,
  };
}

function buildDownloadedContentMeta(
  partial: Partial<DownloadedContentMeta> = {}
): DownloadedContentMeta {
  return {
    contentId: partial.contentId || 'demo:vod-id',
    source: partial.source || 'demo',
    vodId: partial.vodId || 'vod-id',
    sourceName: partial.sourceName || '演示源',
    title: partial.title || '主角',
    searchTitle: partial.searchTitle,
    poster: partial.poster || 'https://example.com/poster.jpg',
    year: partial.year || '2026',
    desc: partial.desc,
    typeName: partial.typeName,
    doubanId: partial.doubanId,
    episodeTitles: partial.episodeTitles || ['第1集'],
    ownerUsername: partial.ownerUsername || 'monica',
    episodes: partial.episodes || [
      {
        episodeIndex: 0,
        episodeTitle: '第1集',
        rootManifestUrl: 'https://example.com/root.m3u8',
        playbackManifestUrl: 'https://example.com/playback.m3u8',
        cacheIndexId: 'task:demo:vod-id:0',
        resourceCount: 10,
        sizeBytes: 123,
        downloadedAt: 1,
      },
    ],
    totalSizeBytes: partial.totalSizeBytes ?? 123,
    updatedAt: partial.updatedAt ?? 1,
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

describe('download manager metadata fallback', () => {
  it('keeps existing metadata when new task fields are empty', () => {
    const previousItem = buildDownloadedContentMeta({
      sourceName: 'U酷影视',
      title: '主角',
      searchTitle: '甄嬛',
      poster: 'https://example.com/poster.jpg',
      year: '2026',
      desc: '旧简介',
      typeName: '国产剧',
      doubanId: 123456,
    });
    const task = buildDownloadTask({
      sourceName: 'U酷影视',
      title: '   ',
      poster: '',
      year: ' ',
      desc: '',
      typeName: '',
      doubanId: undefined,
    });

    expect(applyLibraryMetadataFallback(task, previousItem)).toMatchObject({
      sourceName: 'U酷影视',
      title: '主角',
      searchTitle: '甄嬛',
      poster: 'https://example.com/poster.jpg',
      year: '2026',
      desc: '旧简介',
      typeName: '国产剧',
      doubanId: 123456,
    });
  });

  it('does not overwrite stored poster and title during library merge', () => {
    const previousItem = buildDownloadedContentMeta({
      sourceName: 'U酷影视',
      title: '主角',
      searchTitle: '王雨纯',
      poster: 'https://example.com/poster.jpg',
      year: '2026',
      desc: '旧简介',
      typeName: '国产剧',
      doubanId: 123456,
      episodeTitles: ['第1集', '第2集'],
    });
    const task = buildDownloadTask({
      episodeIndex: 1,
      episodeTitle: '第2集',
      sourceName: 'U酷影视',
      title: '',
      searchTitle: '',
      poster: ' ',
      year: '',
      desc: '',
      typeName: '',
      doubanId: undefined,
      cacheIndexId: 'task:demo:vod-id:1',
    });

    expect(
      mergeLibraryItem(
        previousItem,
        task,
        'monica',
        'https://example.com/playback-2.m3u8',
        'https://example.com/root-2.m3u8',
        12,
        456
      )
    ).toMatchObject({
      sourceName: 'U酷影视',
      title: '主角',
      searchTitle: '王雨纯',
      poster: 'https://example.com/poster.jpg',
      year: '2026',
      desc: '旧简介',
      typeName: '国产剧',
      doubanId: 123456,
    });
  });
});
