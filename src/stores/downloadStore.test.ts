import type { DownloadTask } from '@/lib/download/types';

import { preferLiveDownloadTasks } from './downloadStore';

function buildTask(partial: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: partial.id || 'demo:1:0',
    contentId: partial.contentId || 'demo:1',
    source: partial.source || 'demo',
    sourceName: partial.sourceName || 'Demo Source',
    vodId: partial.vodId || '1',
    episodeIndex: partial.episodeIndex ?? 0,
    title: partial.title || 'Demo Title',
    episodeTitle: partial.episodeTitle || 'Episode 1',
    poster: partial.poster || 'https://img.example.com/demo.jpg',
    year: partial.year || '2026',
    originalM3u8Url:
      partial.originalM3u8Url || 'https://cdn.example.com/root.m3u8',
    entryManifestUrl:
      partial.entryManifestUrl || 'https://cdn.example.com/root.m3u8',
    cacheIndexId: partial.cacheIndexId || 'cache:demo:1:0',
    status: partial.status || 'queued',
    progress: partial.progress ?? 0,
    totalResources: partial.totalResources ?? 0,
    downloadedResources: partial.downloadedResources ?? 0,
    sizeBytes: partial.sizeBytes ?? 0,
    currentSizeBytes: partial.currentSizeBytes ?? 0,
    estimatedTotalSizeBytes: partial.estimatedTotalSizeBytes ?? 0,
    downloadSpeedBytesPerSecond: partial.downloadSpeedBytesPerSecond ?? 0,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    errorMessage: partial.errorMessage,
  };
}

describe('preferLiveDownloadTasks', () => {
  it('keeps an in-memory queued task over a persisted paused snapshot', () => {
    const liveTask = buildTask({
      status: 'queued',
      progress: 40,
      updatedAt: 20,
    });
    const persistedTask = buildTask({
      status: 'paused',
      progress: 0,
      updatedAt: 5,
    });

    expect(
      preferLiveDownloadTasks(
        { [liveTask.id]: liveTask },
        { [persistedTask.id]: persistedTask }
      )
    ).toEqual({
      [liveTask.id]: liveTask,
    });
  });

  it('keeps an in-memory downloading task over a persisted paused snapshot', () => {
    const liveTask = buildTask({
      status: 'downloading',
      progress: 40,
      updatedAt: 20,
    });
    const persistedTask = buildTask({
      status: 'paused',
      progress: 0,
      updatedAt: 5,
    });

    expect(
      preferLiveDownloadTasks(
        { [liveTask.id]: liveTask },
        { [persistedTask.id]: persistedTask }
      )
    ).toEqual({
      [liveTask.id]: liveTask,
    });
  });

  it('uses persisted tasks when memory does not have a newer live task', () => {
    const persistedTask = buildTask({
      status: 'paused',
      progress: 15,
      updatedAt: 8,
    });

    expect(
      preferLiveDownloadTasks({}, { [persistedTask.id]: persistedTask })
    ).toEqual({
      [persistedTask.id]: persistedTask,
    });
  });
});
