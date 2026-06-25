import {
  areDesktopDownloadTasksEquivalent,
  cancelDesktopDownloadEngineTask,
  clearDesktopDownloadEngineSnapshotCache,
  deleteMirroredDesktopDownloadTask,
  pauseDesktopDownloadEngineTask,
  resumeDesktopDownloadEngineTask,
  syncDesktopDownloadEngineSettings,
  syncDesktopDownloadEngineState,
} from './desktop-engine-sync';
import {
  cancelDesktopDownloadTask,
  deleteDesktopDownloadTask,
  getDesktopDownloadEngineSnapshot,
  pauseDesktopDownloadTask,
  postDesktopDownloadTask,
  putDesktopDownloadEngineSettings,
  resumeDesktopDownloadTask,
} from './desktop-runtime';
import type { DownloadTask } from './types';

jest.mock('./desktop-runtime', () => ({
  cancelDesktopDownloadTask: jest.fn(),
  deleteDesktopDownloadTask: jest.fn(),
  getDesktopDownloadEngineSnapshot: jest.fn(),
  pauseDesktopDownloadTask: jest.fn(),
  postDesktopDownloadTask: jest.fn(),
  putDesktopDownloadEngineSettings: jest.fn(),
  resumeDesktopDownloadTask: jest.fn(),
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
    clearDesktopDownloadEngineSnapshotCache();
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

  it('reuses the cached engine snapshot across incremental syncs', async () => {
    const task = buildDownloadTask();
    const initialSnapshot = {
      maxConcurrentTasks: 3,
      tasks: {},
      lastEvent: null,
    };
    const upsertSnapshot = {
      maxConcurrentTasks: 3,
      tasks: {
        [task.id]: task,
      },
      lastEvent: {
        type: 'taskUpserted',
        taskId: task.id,
        status: task.status,
      },
    };

    (getDesktopDownloadEngineSnapshot as jest.Mock).mockResolvedValue(
      initialSnapshot
    );
    (postDesktopDownloadTask as jest.Mock).mockResolvedValue(upsertSnapshot);

    await expect(
      syncDesktopDownloadEngineState({
        maxConcurrentTasks: 3,
        tasks: {},
      })
    ).resolves.toEqual(initialSnapshot);
    await expect(
      syncDesktopDownloadEngineState({
        maxConcurrentTasks: 3,
        tasks: {
          [task.id]: task,
        },
      })
    ).resolves.toEqual(upsertSnapshot);

    expect(getDesktopDownloadEngineSnapshot).toHaveBeenCalledTimes(1);
    expect(postDesktopDownloadTask).toHaveBeenCalledWith(task);
  });

  it('updates the shared snapshot cache after direct runtime commands', async () => {
    const pausedTask = buildDownloadTask({
      id: 'task-pause',
      status: 'paused',
    });
    const pausedSnapshot = {
      maxConcurrentTasks: 3,
      tasks: {
        [pausedTask.id]: pausedTask,
      },
      lastEvent: {
        type: 'taskStatusChanged',
        taskId: pausedTask.id,
        status: 'paused',
        command: 'pause',
      },
    };
    const resumedTask = {
      ...pausedTask,
      status: 'queued' as const,
    };
    const resumedSnapshot = {
      maxConcurrentTasks: 3,
      tasks: {
        [resumedTask.id]: resumedTask,
      },
      lastEvent: {
        type: 'taskStatusChanged',
        taskId: resumedTask.id,
        status: 'queued',
        command: 'resume',
      },
    };
    const cancelledSnapshot = {
      maxConcurrentTasks: 3,
      tasks: {},
      lastEvent: {
        type: 'taskRemoved',
        taskId: resumedTask.id,
        reason: 'cancelled',
      },
    };
    const deletedSnapshot = {
      maxConcurrentTasks: 3,
      tasks: {},
      lastEvent: {
        type: 'taskRemoved',
        taskId: resumedTask.id,
        reason: 'deleted',
      },
    };
    const settingsSnapshot = {
      maxConcurrentTasks: 5,
      tasks: {},
      lastEvent: {
        type: 'maxConcurrentTasksChanged',
        maxConcurrentTasks: 5,
      },
    };

    (pauseDesktopDownloadTask as jest.Mock).mockResolvedValue(pausedSnapshot);
    (resumeDesktopDownloadTask as jest.Mock).mockResolvedValue(resumedSnapshot);
    (cancelDesktopDownloadTask as jest.Mock).mockResolvedValue(
      cancelledSnapshot
    );
    (deleteDesktopDownloadTask as jest.Mock).mockResolvedValue(deletedSnapshot);
    (putDesktopDownloadEngineSettings as jest.Mock).mockResolvedValue(
      settingsSnapshot
    );

    await expect(
      pauseDesktopDownloadEngineTask(pausedTask.id)
    ).resolves.toEqual(pausedSnapshot);
    await expect(
      resumeDesktopDownloadEngineTask(resumedTask.id)
    ).resolves.toEqual(resumedSnapshot);
    await expect(
      cancelDesktopDownloadEngineTask(resumedTask.id)
    ).resolves.toEqual(cancelledSnapshot);
    await expect(
      deleteMirroredDesktopDownloadTask(resumedTask.id)
    ).resolves.toEqual(deletedSnapshot);
    await expect(syncDesktopDownloadEngineSettings(5)).resolves.toEqual(
      settingsSnapshot
    );

    expect(pauseDesktopDownloadTask).toHaveBeenCalledWith(pausedTask.id);
    expect(resumeDesktopDownloadTask).toHaveBeenCalledWith(resumedTask.id);
    expect(cancelDesktopDownloadTask).toHaveBeenCalledWith(resumedTask.id);
    expect(deleteDesktopDownloadTask).toHaveBeenCalledWith(resumedTask.id);
    expect(putDesktopDownloadEngineSettings).toHaveBeenCalledWith({
      maxConcurrentTasks: 5,
    });
  });
});
