import type { SearchResult } from '@/lib/types';

import { useDownloadStore } from '@/stores/downloadStore';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(() => ({
    username: 'monica',
  })),
}));

jest.mock('@/lib/playback-source-client', () => ({
  searchPlaybackSources: jest.fn().mockResolvedValue([]),
}));

jest.mock('./cache', () => ({
  deleteCachedDownloads: jest.fn().mockResolvedValue(undefined),
  getCachedDownloadSizeBytes: jest.fn().mockResolvedValue(0),
  getOfflineDownloadSupportState: jest.fn(() => ({
    supported: true,
  })),
  hasCachedDownload: jest.fn().mockResolvedValue(false),
  putDownloadResponse: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./manifest', () => ({
  parseManifestForDownloadWithFallback: jest.fn(),
}));

jest.mock('./resource-index', () => ({
  deleteResourceIndex: jest.fn().mockResolvedValue(undefined),
  getResourceIndex: jest.fn().mockResolvedValue(null),
  putResourceIndex: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./desktop-runtime', () => ({
  fetchDesktopDownloadCacheResponse: jest.fn(),
  isDesktopLocalDownloadRuntimeEnabled: jest.fn(),
}));

jest.mock('./desktop-engine-sync', () => ({
  cancelDesktopDownloadEngineTask: jest.fn().mockResolvedValue(undefined),
  deleteMirroredDesktopDownloadTask: jest.fn().mockResolvedValue(undefined),
  pauseDesktopDownloadEngineTask: jest.fn().mockResolvedValue(undefined),
  postDesktopDownloadEngineTaskBulkCommand: jest
    .fn()
    .mockResolvedValue(undefined),
  resumeDesktopDownloadEngineTask: jest.fn().mockResolvedValue(undefined),
  retryDesktopDownloadEngineTask: jest.fn().mockResolvedValue(undefined),
  upsertDesktopDownloadEngineTask: jest.fn().mockResolvedValue(undefined),
}));

import {
  cancelDesktopDownloadEngineTask,
  deleteMirroredDesktopDownloadTask,
  pauseDesktopDownloadEngineTask,
  postDesktopDownloadEngineTaskBulkCommand,
  resumeDesktopDownloadEngineTask,
  retryDesktopDownloadEngineTask,
  upsertDesktopDownloadEngineTask,
} from './desktop-engine-sync';
import {
  fetchDesktopDownloadCacheResponse,
  isDesktopLocalDownloadRuntimeEnabled,
} from './desktop-runtime';
import { downloadManager } from './manager';
import { parseManifestForDownloadWithFallback } from './manifest';
import type { DownloadTask } from './types';

function buildSearchResult(partial: Partial<SearchResult> = {}): SearchResult {
  return {
    id: partial.id || '1',
    title: partial.title || 'Demo Title',
    poster: partial.poster || 'https://img.example.com/demo.jpg',
    episodes: partial.episodes || ['https://cdn.example.com/root.m3u8'],
    episodes_titles: partial.episodes_titles || ['Episode 1'],
    source: partial.source || 'demo',
    source_name: partial.source_name || 'Demo Source',
    year: partial.year || '2026',
    desc: partial.desc,
    type_name: partial.type_name,
    douban_id: partial.douban_id,
  };
}

function buildDownloadTask(partial: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: partial.id || 'demo:1:0',
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
    cacheIndexId: partial.cacheIndexId || 'cache:demo:1:0',
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

function resetDownloadStore(): void {
  useDownloadStore.setState({
    hasHydrated: true,
    maxConcurrentTasks: 3,
    ownerUsername: null,
    tasks: {},
    library: {},
  });
}

describe('download manager desktop runtime command bridge', () => {
  const mockIsDesktopLocalDownloadRuntimeEnabled = jest.mocked(
    isDesktopLocalDownloadRuntimeEnabled
  );
  const mockFetchDesktopDownloadCacheResponse = jest.mocked(
    fetchDesktopDownloadCacheResponse
  );
  const mockParseManifestForDownloadWithFallback = jest.mocked(
    parseManifestForDownloadWithFallback
  );
  const mockPostDesktopDownloadEngineTaskBulkCommand = jest.mocked(
    postDesktopDownloadEngineTaskBulkCommand
  );

  beforeEach(() => {
    jest.clearAllMocks();
    resetDownloadStore();
    mockIsDesktopLocalDownloadRuntimeEnabled.mockReturnValue(true);
    mockFetchDesktopDownloadCacheResponse.mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          'content-length': '1',
          'content-type': 'video/mp2t',
        },
      })
    );
    mockParseManifestForDownloadWithFallback.mockImplementation(
      (_candidateUrls, options) =>
        new Promise((_, reject) => {
          const signal = options?.signal;
          const rejectWhenAborted = () => {
            reject(new Error('aborted'));
          };

          if (signal?.aborted) {
            rejectWhenAborted();
            return;
          }

          signal?.addEventListener('abort', rejectWhenAborted, {
            once: true,
          });
        }) as ReturnType<typeof parseManifestForDownloadWithFallback>
    );

    jest
      .mocked(upsertDesktopDownloadEngineTask)
      .mockImplementation(async (task) => ({
        maxConcurrentTasks: useDownloadStore.getState().maxConcurrentTasks,
        tasks: {
          ...useDownloadStore.getState().tasks,
          [task.id]: task,
        },
      }));
    jest
      .mocked(pauseDesktopDownloadEngineTask)
      .mockImplementation(async (taskId) => {
        const tasks = { ...useDownloadStore.getState().tasks };
        const task = tasks[taskId];
        if (task) {
          tasks[taskId] = {
            ...task,
            status: 'paused',
            errorMessage: undefined,
          };
        }
        return {
          maxConcurrentTasks: useDownloadStore.getState().maxConcurrentTasks,
          tasks,
        };
      });
    jest
      .mocked(resumeDesktopDownloadEngineTask)
      .mockImplementation(async (taskId) => {
        const tasks = { ...useDownloadStore.getState().tasks };
        const task = tasks[taskId];
        if (task) {
          tasks[taskId] = {
            ...task,
            status: 'queued',
            errorMessage: undefined,
          };
        }
        return {
          maxConcurrentTasks: useDownloadStore.getState().maxConcurrentTasks,
          tasks,
        };
      });
    jest
      .mocked(retryDesktopDownloadEngineTask)
      .mockImplementation(async (taskId) => {
        const tasks = { ...useDownloadStore.getState().tasks };
        const task = tasks[taskId];
        if (task) {
          tasks[taskId] = {
            ...task,
            status: 'queued',
            errorMessage: undefined,
          };
        }
        return {
          maxConcurrentTasks: useDownloadStore.getState().maxConcurrentTasks,
          tasks,
        };
      });
    jest
      .mocked(cancelDesktopDownloadEngineTask)
      .mockImplementation(async (taskId) => {
        const tasks = { ...useDownloadStore.getState().tasks };
        delete tasks[taskId];
        return {
          maxConcurrentTasks: useDownloadStore.getState().maxConcurrentTasks,
          tasks,
        };
      });
    jest
      .mocked(deleteMirroredDesktopDownloadTask)
      .mockImplementation(async (taskId) => {
        const tasks = { ...useDownloadStore.getState().tasks };
        delete tasks[taskId];
        return {
          maxConcurrentTasks: useDownloadStore.getState().maxConcurrentTasks,
          tasks,
        };
      });
    mockPostDesktopDownloadEngineTaskBulkCommand.mockImplementation(
      async (command, taskIds) => {
        const tasks = { ...useDownloadStore.getState().tasks };
        taskIds.forEach((taskId) => {
          const task = tasks[taskId];
          if (!task) {
            return;
          }
          if (command === 'cancel') {
            delete tasks[taskId];
            return;
          }
          tasks[taskId] = {
            ...task,
            status: command === 'pause' ? 'paused' : 'queued',
            errorMessage: undefined,
          };
        });
        return {
          maxConcurrentTasks: useDownloadStore.getState().maxConcurrentTasks,
          tasks,
        };
      }
    );
  });

  afterEach(() => {
    downloadManager.abortAll();
    resetDownloadStore();
  });

  it('mirrors pause, resume, retry and cancel actions into the desktop runtime', async () => {
    const task = buildDownloadTask();
    useDownloadStore.setState({
      tasks: {
        [task.id]: task,
      },
    });

    await downloadManager.pauseTask(task.id);
    expect(useDownloadStore.getState().tasks[task.id]?.status).toBe('paused');
    expect(pauseDesktopDownloadEngineTask).toHaveBeenCalledWith(task.id);

    useDownloadStore.setState({
      tasks: {
        [task.id]: {
          ...task,
          status: 'paused',
        },
      },
    });

    await downloadManager.resumeTask(task.id);
    expect(['queued', 'downloading']).toContain(
      useDownloadStore.getState().tasks[task.id]?.status
    );
    expect(resumeDesktopDownloadEngineTask).toHaveBeenCalledWith(task.id);

    useDownloadStore.setState({
      tasks: {
        [task.id]: {
          ...task,
          status: 'error',
          errorMessage: 'temporary failure',
        },
      },
    });

    await downloadManager.resumeTask(task.id);
    expect(useDownloadStore.getState().tasks[task.id]?.status).toBe('queued');
    expect(useDownloadStore.getState().tasks[task.id]?.errorMessage).toBe(
      undefined
    );
    expect(retryDesktopDownloadEngineTask).toHaveBeenCalledWith(task.id);

    useDownloadStore.setState({
      tasks: {
        [task.id]: task,
      },
    });

    await downloadManager.cancelTask(task.id);
    expect(useDownloadStore.getState().tasks[task.id]).toBeUndefined();
    expect(cancelDesktopDownloadEngineTask).toHaveBeenCalledWith(task.id);
  });

  it('uses bulk runtime commands for pause-all, resume-all and cancel-all flows', async () => {
    const queuedTask = buildDownloadTask({
      id: 'task-queued',
      cacheIndexId: 'cache:task-queued',
      status: 'queued',
    });
    const downloadingTask = buildDownloadTask({
      id: 'task-downloading',
      cacheIndexId: 'cache:task-downloading',
      status: 'downloading',
    });
    const pausedTask = buildDownloadTask({
      id: 'task-paused',
      cacheIndexId: 'cache:task-paused',
      status: 'paused',
    });
    const errorTask = buildDownloadTask({
      id: 'task-error',
      cacheIndexId: 'cache:task-error',
      status: 'error',
      errorMessage: 'retry me',
    });
    const doneTask = buildDownloadTask({
      id: 'task-done',
      cacheIndexId: 'cache:task-done',
      status: 'done',
      progress: 100,
    });

    useDownloadStore.setState({
      tasks: {
        [queuedTask.id]: queuedTask,
        [downloadingTask.id]: downloadingTask,
        [pausedTask.id]: pausedTask,
        [errorTask.id]: errorTask,
        [doneTask.id]: doneTask,
      },
    });

    await downloadManager.pauseAllTasks();

    expect(useDownloadStore.getState().tasks[queuedTask.id]?.status).toBe(
      'paused'
    );
    expect(useDownloadStore.getState().tasks[downloadingTask.id]?.status).toBe(
      'paused'
    );
    expect(mockPostDesktopDownloadEngineTaskBulkCommand).toHaveBeenCalledWith(
      'pause',
      [queuedTask.id, downloadingTask.id]
    );
    expect(pauseDesktopDownloadEngineTask).not.toHaveBeenCalled();

    mockPostDesktopDownloadEngineTaskBulkCommand.mockClear();
    useDownloadStore.setState({
      tasks: {
        [pausedTask.id]: pausedTask,
        [errorTask.id]: errorTask,
        [doneTask.id]: doneTask,
      },
    });

    await downloadManager.resumeAllTasks();
    await Promise.resolve();
    await Promise.resolve();

    expect(useDownloadStore.getState().tasks[pausedTask.id]?.status).toBe(
      'queued'
    );
    expect(useDownloadStore.getState().tasks[errorTask.id]?.status).toBe(
      'queued'
    );
    expect(
      useDownloadStore.getState().tasks[errorTask.id]?.errorMessage
    ).toBeUndefined();
    expect(
      mockPostDesktopDownloadEngineTaskBulkCommand
    ).toHaveBeenNthCalledWith(1, 'resume', [pausedTask.id]);
    expect(
      mockPostDesktopDownloadEngineTaskBulkCommand
    ).toHaveBeenNthCalledWith(2, 'retry', [errorTask.id]);
    expect(resumeDesktopDownloadEngineTask).not.toHaveBeenCalled();
    expect(retryDesktopDownloadEngineTask).not.toHaveBeenCalled();

    mockPostDesktopDownloadEngineTaskBulkCommand.mockClear();
    useDownloadStore.setState({
      tasks: {
        [queuedTask.id]: queuedTask,
        [pausedTask.id]: pausedTask,
        [doneTask.id]: doneTask,
      },
    });

    await downloadManager.cancelAllTasks();

    expect(useDownloadStore.getState().tasks[queuedTask.id]).toBeUndefined();
    expect(useDownloadStore.getState().tasks[pausedTask.id]).toBeUndefined();
    expect(useDownloadStore.getState().tasks[doneTask.id]?.status).toBe('done');
    expect(mockPostDesktopDownloadEngineTaskBulkCommand).toHaveBeenCalledWith(
      'cancel',
      [queuedTask.id, pausedTask.id]
    );
    expect(cancelDesktopDownloadEngineTask).not.toHaveBeenCalled();
  });

  it('mirrors deleting a completed episode into the desktop runtime', async () => {
    const task = buildDownloadTask({
      status: 'done',
      progress: 100,
      sizeBytes: 1024,
      currentSizeBytes: 1024,
      estimatedTotalSizeBytes: 1024,
    });
    useDownloadStore.setState({
      tasks: {
        [task.id]: task,
      },
      library: {
        [task.contentId]: {
          contentId: task.contentId,
          source: task.source,
          vodId: task.vodId,
          sourceName: task.sourceName,
          title: task.title,
          searchTitle: task.searchTitle,
          searchType: task.searchType,
          poster: task.poster,
          remarks: task.remarks,
          year: task.year,
          desc: task.desc,
          typeName: task.typeName,
          doubanId: task.doubanId,
          episodeTitles: [task.episodeTitle],
          ownerUsername: 'monica',
          episodes: [
            {
              episodeIndex: task.episodeIndex,
              episodeTitle: task.episodeTitle,
              rootManifestUrl: task.originalM3u8Url,
              playbackManifestUrl:
                task.playbackManifestUrl || task.entryManifestUrl,
              cacheIndexId: task.cacheIndexId,
              resourceCount: task.totalResources,
              sizeBytes: 1024,
              downloadedAt: 1,
            },
          ],
          totalSizeBytes: 1024,
          updatedAt: 1,
        },
      },
    });

    await downloadManager.deleteEpisode(task.contentId, task.episodeIndex);

    expect(useDownloadStore.getState().tasks[task.id]).toBeUndefined();
    expect(deleteMirroredDesktopDownloadTask).toHaveBeenCalledWith(task.id);
  });

  it('upserts newly queued tasks into the desktop runtime immediately', async () => {
    const task = await downloadManager.startEpisodeDownload({
      detail: buildSearchResult(),
      episodeIndex: 0,
    });

    expect(useDownloadStore.getState().tasks[task.id]?.status).toBe('queued');
    expect(upsertDesktopDownloadEngineTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: task.id,
        status: 'queued',
      })
    );
    expect(mockParseManifestForDownloadWithFallback).not.toHaveBeenCalled();
  });

  it('does not publish a queued task when the desktop runtime rejects submission', async () => {
    jest
      .mocked(upsertDesktopDownloadEngineTask)
      .mockRejectedValueOnce(new Error('desktop runtime unavailable'));

    await expect(
      downloadManager.startEpisodeDownload({
        detail: buildSearchResult(),
        episodeIndex: 0,
      })
    ).rejects.toThrow('desktop runtime unavailable');

    expect(useDownloadStore.getState().tasks).toEqual({});
  });

  it('keeps the confirmed task state when a desktop control command fails', async () => {
    const task = buildDownloadTask({ status: 'downloading' });
    useDownloadStore.setState({
      tasks: {
        [task.id]: task,
      },
    });
    jest
      .mocked(pauseDesktopDownloadEngineTask)
      .mockRejectedValueOnce(new Error('pause rejected'));

    await expect(downloadManager.pauseTask(task.id)).rejects.toThrow(
      'pause rejected'
    );
    expect(useDownloadStore.getState().tasks[task.id]?.status).toBe(
      'downloading'
    );

    jest
      .mocked(cancelDesktopDownloadEngineTask)
      .mockRejectedValueOnce(new Error('cancel rejected'));
    await expect(downloadManager.cancelTask(task.id)).rejects.toThrow(
      'cancel rejected'
    );
    expect(useDownloadStore.getState().tasks[task.id]).toEqual(task);
  });

  it('upserts re-queued paused tasks into the desktop runtime without waiting for store sync', async () => {
    const pausedTask = buildDownloadTask({
      status: 'paused',
      errorMessage: 'temporary failure',
    });
    useDownloadStore.setState({
      tasks: {
        [pausedTask.id]: pausedTask,
      },
    });

    const result = await downloadManager.startEpisodeDownload({
      detail: buildSearchResult({
        id: pausedTask.vodId,
        source: pausedTask.source,
        source_name: pausedTask.sourceName,
        title: pausedTask.title,
        poster: pausedTask.poster,
        year: pausedTask.year,
        desc: pausedTask.desc,
        type_name: pausedTask.typeName,
        douban_id: pausedTask.doubanId,
        episodes: [pausedTask.originalM3u8Url],
        episodes_titles: [pausedTask.episodeTitle],
      }),
      episodeIndex: pausedTask.episodeIndex,
      searchTitle: pausedTask.searchTitle,
      searchType: pausedTask.searchType,
    });

    expect(result.status).toBe('queued');
    expect(upsertDesktopDownloadEngineTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: pausedTask.id,
        status: 'queued',
        errorMessage: undefined,
      })
    );
  });

  it('keeps local behavior when the desktop runtime is unavailable', async () => {
    const task = buildDownloadTask();
    mockIsDesktopLocalDownloadRuntimeEnabled.mockReturnValue(false);
    useDownloadStore.setState({
      tasks: {
        [task.id]: task,
      },
    });

    await downloadManager.pauseTask(task.id);
    await downloadManager.resumeTask(task.id);
    await downloadManager.cancelTask(task.id);

    expect(useDownloadStore.getState().tasks[task.id]).toBeUndefined();
    expect(pauseDesktopDownloadEngineTask).not.toHaveBeenCalled();
    expect(postDesktopDownloadEngineTaskBulkCommand).not.toHaveBeenCalled();
    expect(resumeDesktopDownloadEngineTask).not.toHaveBeenCalled();
    expect(retryDesktopDownloadEngineTask).not.toHaveBeenCalled();
    expect(cancelDesktopDownloadEngineTask).not.toHaveBeenCalled();
    expect(upsertDesktopDownloadEngineTask).not.toHaveBeenCalled();
  });
});
