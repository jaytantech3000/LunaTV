import {
  areDesktopDownloadTasksEquivalent,
  syncDesktopDownloadEngineState,
} from './desktop-engine-sync';
import {
  deleteDesktopDownloadTask,
  getDesktopDownloadEngineSnapshot,
  postDesktopDownloadTask,
  putDesktopDownloadEngineSettings,
} from './desktop-runtime';
import type { DownloadTask } from './types';

jest.mock('./desktop-runtime', () => ({
  deleteDesktopDownloadTask: jest.fn(),
  getDesktopDownloadEngineSnapshot: jest.fn(),
  postDesktopDownloadTask: jest.fn(),
  putDesktopDownloadEngineSettings: jest.fn(),
}));

function buildDownloadTask(partial: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: partial.id || 'task-demo-1',
    contentId: partial.contentId || 'demo:1',
    source: partial.source || 'demo',
    sourceName: partial.sourceName || 'Demo Source',
    vodId: partial.vodId || '1',
    episodeIndex: partial.episodeIndex ?? 0,
    title: partial.title || 'Demo Title',
    searchTitle: partial.searchTitle || 'Demo Search',
    searchType: partial.searchType || 'tv',
    poster: partial.poster || 'https://img.example.com/demo.jpg',
    remarks: partial.remarks || 'Demo remarks',
    year: partial.year || '2026',
    desc: partial.desc || 'Demo description',
    typeName: partial.typeName || 'tv',
    doubanId: partial.doubanId ?? 1001,
    episodeTitle: partial.episodeTitle || 'Episode 1',
    originalM3u8Url:
      partial.originalM3u8Url || 'https://cdn.example.com/root.m3u8',
    entryManifestUrl:
      partial.entryManifestUrl || 'https://cdn.example.com/root.m3u8',
    manifestCandidateUrls: partial.manifestCandidateUrls || [
      'https://cdn.example.com/root.m3u8',
    ],
    playbackManifestUrl:
      partial.playbackManifestUrl || 'https://cdn.example.com/playback.m3u8',
    cacheIndexId: partial.cacheIndexId || 'cache:task-demo-1',
    status: partial.status || 'queued',
    progress: partial.progress ?? 0,
    totalResources: partial.totalResources ?? 10,
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

describe('desktop download engine sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('compares task snapshots by value', () => {
    const task = buildDownloadTask();

    expect(areDesktopDownloadTasksEquivalent(task, { ...task })).toBe(true);
    expect(
      areDesktopDownloadTasksEquivalent(task, {
        ...task,
        progress: 50,
      })
    ).toBe(false);
  });

  it('skips mutations when the engine snapshot already matches local state', async () => {
    const task = buildDownloadTask();
    const snapshot = {
      maxConcurrentTasks: 3,
      tasks: {
        [task.id]: task,
      },
      lastEvent: null,
    };

    (getDesktopDownloadEngineSnapshot as jest.Mock).mockResolvedValue(snapshot);

    await expect(
      syncDesktopDownloadEngineState({
        maxConcurrentTasks: 3,
        tasks: {
          [task.id]: task,
        },
      })
    ).resolves.toEqual(snapshot);

    expect(getDesktopDownloadEngineSnapshot).toHaveBeenCalledTimes(1);
    expect(putDesktopDownloadEngineSettings).not.toHaveBeenCalled();
    expect(postDesktopDownloadTask).not.toHaveBeenCalled();
    expect(deleteDesktopDownloadTask).not.toHaveBeenCalled();
  });

  it('updates settings, upserts changed tasks and removes stale remote tasks', async () => {
    const nextTask = buildDownloadTask({
      id: 'task-next',
      cacheIndexId: 'cache:task-next',
      status: 'paused',
      progress: 25,
    });
    const staleTask = buildDownloadTask({
      id: 'task-stale',
      cacheIndexId: 'cache:task-stale',
    });
    const initialSnapshot = {
      maxConcurrentTasks: 1,
      tasks: {
        [staleTask.id]: staleTask,
      },
      lastEvent: null,
    };
    const settingsSnapshot = {
      maxConcurrentTasks: 5,
      tasks: {
        [staleTask.id]: staleTask,
      },
      lastEvent: {
        type: 'maxConcurrentTasksChanged',
        maxConcurrentTasks: 5,
      },
    };
    const upsertSnapshot = {
      maxConcurrentTasks: 5,
      tasks: {
        [staleTask.id]: staleTask,
        [nextTask.id]: nextTask,
      },
      lastEvent: {
        type: 'taskUpserted',
        taskId: nextTask.id,
        status: nextTask.status,
      },
    };
    const finalSnapshot = {
      maxConcurrentTasks: 5,
      tasks: {
        [nextTask.id]: nextTask,
      },
      lastEvent: {
        type: 'taskRemoved',
        taskId: staleTask.id,
        reason: 'deleted',
      },
    };

    (putDesktopDownloadEngineSettings as jest.Mock).mockResolvedValue(
      settingsSnapshot
    );
    (postDesktopDownloadTask as jest.Mock).mockResolvedValue(upsertSnapshot);
    (deleteDesktopDownloadTask as jest.Mock).mockResolvedValue(finalSnapshot);

    await expect(
      syncDesktopDownloadEngineState(
        {
          maxConcurrentTasks: 5,
          tasks: {
            [nextTask.id]: nextTask,
          },
        },
        initialSnapshot
      )
    ).resolves.toEqual(finalSnapshot);

    expect(getDesktopDownloadEngineSnapshot).not.toHaveBeenCalled();
    expect(putDesktopDownloadEngineSettings).toHaveBeenCalledWith({
      maxConcurrentTasks: 5,
    });
    expect(postDesktopDownloadTask).toHaveBeenCalledWith(nextTask);
    expect(deleteDesktopDownloadTask).toHaveBeenCalledWith(staleTask.id);
  });
});
