import { sortActiveDownloadTasks } from './sort';
import { DownloadTask } from './types';

function buildTask(partial: Partial<DownloadTask>): DownloadTask {
  return {
    id: partial.id || 'task',
    contentId: partial.contentId || 'content',
    source: partial.source || 'source',
    sourceName: partial.sourceName || 'source name',
    vodId: partial.vodId || 'vod',
    episodeIndex: partial.episodeIndex || 0,
    title: partial.title || 'title',
    poster: partial.poster || '',
    year: partial.year || '2026',
    episodeTitle: partial.episodeTitle || '第1集',
    originalM3u8Url: partial.originalM3u8Url || 'https://example.com/a.m3u8',
    entryManifestUrl: partial.entryManifestUrl || '/api/proxy/vod/m3u8?a=1',
    cacheIndexId: partial.cacheIndexId || 'cache',
    status: partial.status || 'queued',
    progress: partial.progress || 0,
    totalResources: partial.totalResources || 0,
    downloadedResources: partial.downloadedResources || 0,
    sizeBytes: partial.sizeBytes || 0,
    createdAt: partial.createdAt || 1,
    updatedAt: partial.updatedAt || 1,
    desc: partial.desc,
    typeName: partial.typeName,
    doubanId: partial.doubanId,
    playbackManifestUrl: partial.playbackManifestUrl,
    errorMessage: partial.errorMessage,
  };
}

describe('sortActiveDownloadTasks', () => {
  it('keeps task order aligned with queue creation time instead of progress updates', () => {
    const olderTask = buildTask({
      id: 'older',
      createdAt: 100,
      updatedAt: 1000,
      title: 'A',
    });
    const newerTask = buildTask({
      id: 'newer',
      createdAt: 200,
      updatedAt: 200,
      title: 'B',
    });

    const sortedTasks = sortActiveDownloadTasks([olderTask, newerTask]);

    expect(sortedTasks.map((task) => task.id)).toEqual(['older', 'newer']);
  });

  it('falls back to title and episode index when creation time matches', () => {
    const episodeOne = buildTask({
      id: 'episode-1',
      createdAt: 100,
      title: '请回答1988 十周年MT',
      episodeIndex: 0,
    });
    const episodeTwo = buildTask({
      id: 'episode-2',
      createdAt: 100,
      title: '请回答1988 十周年MT',
      episodeIndex: 1,
    });

    const sortedTasks = sortActiveDownloadTasks([episodeOne, episodeTwo]);

    expect(sortedTasks.map((task) => task.id)).toEqual([
      'episode-1',
      'episode-2',
    ]);
  });
});
