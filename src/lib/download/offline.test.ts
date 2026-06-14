import {
  applyOfflinePlaybackOwner,
  buildGroupedOfflinePlaybackDetail,
  getGroupedOfflineContents,
} from './offline';
import { DownloadedContentMeta } from './types';

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
});
