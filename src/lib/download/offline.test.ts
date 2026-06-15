jest.mock('./cache', () => ({
  hasCachedDownload: jest.fn(),
  matchDownloadResponse: jest.fn(),
  putDownloadResponse: jest.fn(),
}));

import { matchDownloadResponse } from './cache';
import {
  applyOfflinePlaybackOwner,
  buildGroupedOfflinePlaybackDetail,
  buildOfflinePlayHref,
  getAdultRelatedOfflineVideoEntries,
  getDownloadedEpisodeDurationSeconds,
  getGroupedOfflineContents,
  getOfflinePlaybackContents,
  getSameTitleOfflineVideoEntries,
  isAdultDownloadedContent,
} from './offline';
import { DownloadedContentMeta } from './types';

const mockedMatchDownloadResponse = jest.mocked(matchDownloadResponse);

function buildContent(
  partial: Partial<DownloadedContentMeta>
): DownloadedContentMeta {
  return {
    contentId: partial.contentId || 'source-a:1',
    source: partial.source || 'source-a',
    vodId: partial.vodId || '1',
    sourceName: partial.sourceName || '线路A',
    title: partial.title || '银河列车',
    searchTitle: partial.searchTitle,
    searchType: partial.searchType,
    poster: partial.poster || 'https://example.com/poster-a.jpg',
    year: partial.year || '2026',
    desc: partial.desc || '剧情简介',
    typeName: partial.typeName || '剧情',
    doubanId: partial.doubanId,
    episodeTitles: partial.episodeTitles || ['第1集', '第2集'],
    ownerUsername: partial.ownerUsername || 'jay',
    episodes: partial.episodes || [],
    totalSizeBytes: partial.totalSizeBytes || 1024,
    updatedAt: partial.updatedAt || 1,
  };
}

describe('offline playback grouping helpers', () => {
  beforeEach(() => {
    mockedMatchDownloadResponse.mockReset();
  });

  it('reads episode duration from the cached playback manifest', async () => {
    mockedMatchDownloadResponse.mockResolvedValue(
      new Response(`#EXTM3U
#EXTINF:10.0,
segment-1.ts
#EXTINF:20.5,
segment-2.ts
`)
    );

    await expect(
      getDownloadedEpisodeDurationSeconds({
        playbackManifestUrl: 'https://example.com/play.m3u8',
        rootManifestUrl: 'https://example.com/root.m3u8',
      })
    ).resolves.toBe(30.5);
  });

  it('groups same-title offline contents and keeps the active content first', () => {
    const activeContent = buildContent({
      contentId: 'source-a:1',
      title: '银河列车',
      sourceName: '线路A',
      updatedAt: 100,
    });
    const groupedContent = buildContent({
      contentId: 'source-b:2',
      source: 'source-b',
      vodId: '2',
      sourceName: '线路B',
      title: '银河 列车·',
      updatedAt: 300,
    });
    const unrelatedContent = buildContent({
      contentId: 'source-c:3',
      source: 'source-c',
      vodId: '3',
      sourceName: '线路C',
      title: '深海计划',
      updatedAt: 500,
    });

    const groupedContents = getGroupedOfflineContents({
      library: {
        [activeContent.contentId]: activeContent,
        [groupedContent.contentId]: groupedContent,
        [unrelatedContent.contentId]: unrelatedContent,
      },
      activeContentId: activeContent.contentId,
    });

    expect(groupedContents.map((content) => content.contentId)).toEqual([
      'source-a:1',
      'source-b:2',
    ]);
  });

  it('keeps adult offline playback isolated from same-title source grouping', () => {
    const activeAdultContent = buildContent({
      contentId: 'adult-source-a:1',
      source: 'adult-source-a',
      vodId: '1',
      sourceName: '🔞线路A',
      title: 'Miuzxc 制服挑战',
      searchTitle: 'Miuzxc',
      typeName: '伦理片',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: 'HD',
          rootManifestUrl: 'https://example.com/a/root-1.m3u8',
          playbackManifestUrl: 'https://example.com/a/play-1.m3u8',
          cacheIndexId: 'adult-cache-a-1',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 1000,
        },
      ],
    });
    const sameTitleAdultContent = buildContent({
      contentId: 'adult-source-b:2',
      source: 'adult-source-b',
      vodId: '2',
      sourceName: '🔞线路B',
      title: 'Miuzxc 制服挑战',
      searchTitle: 'Miuzxc',
      typeName: '伦理片',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: 'HD',
          rootManifestUrl: 'https://example.com/b/root-1.m3u8',
          playbackManifestUrl: 'https://example.com/b/play-1.m3u8',
          cacheIndexId: 'adult-cache-b-1',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 2000,
        },
      ],
    });

    expect(isAdultDownloadedContent(activeAdultContent)).toBe(true);
    expect(
      getOfflinePlaybackContents({
        library: {
          [activeAdultContent.contentId]: activeAdultContent,
          [sameTitleAdultContent.contentId]: sameTitleAdultContent,
        },
        activeContentId: activeAdultContent.contentId,
      }).map((content) => content.contentId)
    ).toEqual(['adult-source-a:1']);
  });

  it('builds same-title offline video entries for other local sources', () => {
    const activeContent = buildContent({
      contentId: 'source-a:1',
      source: 'source-a',
      vodId: '1',
      sourceName: '线路A',
      title: '银河列车',
      year: '2026',
      episodes: [
        {
          episodeIndex: 1,
          episodeTitle: '第2集',
          rootManifestUrl: 'https://example.com/a/root-2.m3u8',
          playbackManifestUrl: 'https://example.com/a/play-2.m3u8',
          cacheIndexId: 'cache-a-2',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 1000,
        },
      ],
      updatedAt: 1000,
    });
    const sameTitleContent = buildContent({
      contentId: 'source-b:2',
      source: 'source-b',
      vodId: '2',
      sourceName: '线路B',
      title: '银河 列车·',
      year: '2025',
      poster: 'https://example.com/poster-b.jpg',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: '第1集',
          rootManifestUrl: 'https://example.com/b/root-1.m3u8',
          playbackManifestUrl: 'https://example.com/b/play-1.m3u8',
          cacheIndexId: 'cache-b-1',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 2000,
        },
      ],
      updatedAt: 2000,
    });
    const unrelatedContent = buildContent({
      contentId: 'source-c:3',
      source: 'source-c',
      vodId: '3',
      sourceName: '线路C',
      title: '深海计划',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: '第1集',
          rootManifestUrl: 'https://example.com/c/root-1.m3u8',
          playbackManifestUrl: 'https://example.com/c/play-1.m3u8',
          cacheIndexId: 'cache-c-1',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 3000,
        },
      ],
      updatedAt: 3000,
    });

    expect(
      getSameTitleOfflineVideoEntries({
        library: {
          [activeContent.contentId]: activeContent,
          [sameTitleContent.contentId]: sameTitleContent,
          [unrelatedContent.contentId]: unrelatedContent,
        },
        activeContentId: activeContent.contentId,
      })
    ).toEqual([
      {
        contentId: 'source-b:2',
        source: 'source-b',
        sourceName: '线路B',
        vodId: '2',
        title: '银河 列车·',
        poster: 'https://example.com/poster-b.jpg',
        year: '2025',
        episodeCount: 1,
        href: '/play?offline=1&contentId=source-b%3A2&source=source-b&id=2&title=%E9%93%B6%E6%B2%B3+%E5%88%97%E8%BD%A6%C2%B7&year=2025&episode=1',
        updatedAt: 2000,
      },
    ]);
  });

  it('preserves the stored search mode in offline playback links', () => {
    const content = buildContent({
      contentId: 'source-a:1',
      source: 'source-a',
      vodId: '1',
      title: '银河列车',
      year: '2026',
      searchType: 'tv',
    });

    expect(
      buildOfflinePlayHref({
        content,
        episodeIndex: 1,
      })
    ).toBe(
      '/play?offline=1&contentId=source-a%3A1&source=source-a&id=1&title=%E9%93%B6%E6%B2%B3%E5%88%97%E8%BD%A6&year=2026&episode=2&stype=tv'
    );
  });

  it('merges cross-source offline episodes into one ordered playback list', () => {
    const activeContent = buildContent({
      contentId: 'source-a:1',
      source: 'source-a',
      vodId: '1',
      sourceName: '线路A',
      title: '银河列车',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: '第1集',
          rootManifestUrl: 'https://example.com/a/root-1.m3u8',
          playbackManifestUrl: 'https://example.com/a/play-1.m3u8',
          cacheIndexId: 'cache-a-1',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 1000,
        },
        {
          episodeIndex: 1,
          episodeTitle: '第2集',
          rootManifestUrl: 'https://example.com/a/root-2.m3u8',
          playbackManifestUrl: 'https://example.com/a/play-2.m3u8',
          cacheIndexId: 'cache-a-2',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 2000,
        },
      ],
    });
    const backupContent = buildContent({
      contentId: 'source-b:2',
      source: 'source-b',
      vodId: '2',
      sourceName: '线路B',
      title: '银河列车',
      poster: 'https://example.com/poster-b.jpg',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: '第1集',
          rootManifestUrl: 'https://example.com/b/root-1.m3u8',
          playbackManifestUrl: 'https://example.com/b/play-1.m3u8',
          cacheIndexId: 'cache-b-1',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 3000,
        },
        {
          episodeIndex: 1,
          episodeTitle: '第2集',
          rootManifestUrl: 'https://example.com/b/root-2.m3u8',
          playbackManifestUrl: 'https://example.com/b/play-2.m3u8',
          cacheIndexId: 'cache-b-2',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 4000,
        },
      ],
    });

    const playbackDetail = buildGroupedOfflinePlaybackDetail({
      contents: [activeContent, backupContent],
      activeContentId: activeContent.contentId,
    });

    expect(
      playbackDetail.episodeEntries.map((episode) => ({
        contentId: episode.contentId,
        episodeIndex: episode.episodeIndex,
      }))
    ).toEqual([
      { contentId: 'source-a:1', episodeIndex: 0 },
      { contentId: 'source-b:2', episodeIndex: 0 },
      { contentId: 'source-a:1', episodeIndex: 1 },
      { contentId: 'source-b:2', episodeIndex: 1 },
    ]);
    expect(playbackDetail.detail.episodes_titles).toEqual([
      '第1集 · 线路A',
      '第1集 · 线路B',
      '第2集 · 线路A',
      '第2集 · 线路B',
    ]);
    expect(playbackDetail.detail.source).toBe('source-a');
    expect(playbackDetail.detail.id).toBe('1');
  });

  it('switches offline owner metadata without changing the merged episode list', () => {
    const activeContent = buildContent({
      contentId: 'source-a:1',
      source: 'source-a',
      vodId: '1',
      sourceName: '线路A',
      title: '银河列车',
      poster: 'https://example.com/poster-a.jpg',
      year: '2026',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: '第1集',
          rootManifestUrl: 'https://example.com/a/root-1.m3u8',
          playbackManifestUrl: 'https://example.com/a/play-1.m3u8',
          cacheIndexId: 'cache-a-1',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 1000,
        },
      ],
    });
    const backupContent = buildContent({
      contentId: 'source-b:2',
      source: 'source-b',
      vodId: '2',
      sourceName: '线路B',
      title: '银河列车',
      poster: 'https://example.com/poster-b.jpg',
      year: '2025',
      desc: '备用源简介',
      typeName: '冒险',
      doubanId: 2002,
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: '第1集',
          rootManifestUrl: 'https://example.com/b/root-1.m3u8',
          playbackManifestUrl: 'https://example.com/b/play-1.m3u8',
          cacheIndexId: 'cache-b-1',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 3000,
        },
      ],
    });

    const playbackDetail = buildGroupedOfflinePlaybackDetail({
      contents: [activeContent, backupContent],
      activeContentId: activeContent.contentId,
    });
    const switchedOwnerDetail = applyOfflinePlaybackOwner({
      detail: playbackDetail.detail,
      contents: [activeContent, backupContent],
      ownerContentId: backupContent.contentId,
    });

    expect(switchedOwnerDetail.episodes).toEqual(playbackDetail.detail.episodes);
    expect(switchedOwnerDetail.episodes_titles).toEqual(
      playbackDetail.detail.episodes_titles
    );
    expect(switchedOwnerDetail.source).toBe('source-b');
    expect(switchedOwnerDetail.id).toBe('2');
    expect(switchedOwnerDetail.poster).toBe('https://example.com/poster-b.jpg');
    expect(switchedOwnerDetail.year).toBe('2025');
    expect(switchedOwnerDetail.desc).toBe('备用源简介');
    expect(switchedOwnerDetail.type_name).toBe('冒险');
    expect(switchedOwnerDetail.douban_id).toBe(2002);
  });

  it('builds adult offline related video entries from other locally downloaded videos', () => {
    const activeContent = buildContent({
      contentId: 'adult-source-a:1',
      source: 'adult-source-a',
      vodId: '1',
      sourceName: '🔞线路A',
      title: 'Miuzxc 制服挑战',
      searchTitle: 'Miuzxc',
      typeName: '伦理片',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: 'HD',
          rootManifestUrl: 'https://example.com/a/root-1.m3u8',
          playbackManifestUrl: 'https://example.com/a/play-1.m3u8',
          cacheIndexId: 'adult-cache-a-1',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 1000,
        },
      ],
      updatedAt: 1000,
    });
    const duplicateTitleContent = buildContent({
      contentId: 'adult-source-b:2',
      source: 'adult-source-b',
      vodId: '2',
      sourceName: '🔞线路B',
      title: 'Miuzxc 制服挑战',
      searchTitle: 'Miuzxc',
      typeName: '伦理片',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: 'HD',
          rootManifestUrl: 'https://example.com/b/root-1.m3u8',
          playbackManifestUrl: 'https://example.com/b/play-1.m3u8',
          cacheIndexId: 'adult-cache-b-1',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 2000,
        },
      ],
      updatedAt: 2000,
    });
    const relatedContent = buildContent({
      contentId: 'adult-source-c:3',
      source: 'adult-source-c',
      vodId: '3',
      sourceName: '🔞线路C',
      title: 'Miuzxc 深夜企划',
      searchTitle: 'Miuzxc',
      typeName: '伦理片',
      episodes: [
        {
          episodeIndex: 2,
          episodeTitle: 'HD',
          rootManifestUrl: 'https://example.com/c/root-3.m3u8',
          playbackManifestUrl: 'https://example.com/c/play-3.m3u8',
          cacheIndexId: 'adult-cache-c-3',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 3000,
        },
      ],
      updatedAt: 3000,
    });
    const unrelatedContent = buildContent({
      contentId: 'adult-source-d:4',
      source: 'adult-source-d',
      vodId: '4',
      sourceName: '🔞线路D',
      title: 'Anny Walker 课堂',
      searchTitle: 'Anny Walker',
      typeName: '伦理片',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: 'HD',
          rootManifestUrl: 'https://example.com/d/root-1.m3u8',
          playbackManifestUrl: 'https://example.com/d/play-1.m3u8',
          cacheIndexId: 'adult-cache-d-1',
          resourceCount: 10,
          sizeBytes: 100,
          downloadedAt: 4000,
        },
      ],
      updatedAt: 4000,
    });

    const relatedVideos = getAdultRelatedOfflineVideoEntries({
      library: {
        [activeContent.contentId]: activeContent,
        [duplicateTitleContent.contentId]: duplicateTitleContent,
        [relatedContent.contentId]: relatedContent,
        [unrelatedContent.contentId]: unrelatedContent,
      },
      activeContentId: activeContent.contentId,
    });

    expect(relatedVideos).toEqual([
      {
        contentId: 'adult-source-c:3',
        source: 'adult-source-c',
        sourceName: '🔞线路C',
        vodId: '3',
        title: 'Miuzxc 深夜企划',
        poster: 'https://example.com/poster-a.jpg',
        year: '2026',
        episodeCount: 1,
        href: '/play?offline=1&contentId=adult-source-c%3A3&source=adult-source-c&id=3&title=Miuzxc+%E6%B7%B1%E5%A4%9C%E4%BC%81%E5%88%92&year=2026&episode=3',
        updatedAt: 3000,
      },
    ]);
  });
});
