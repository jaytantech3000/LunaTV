import type { DownloadTask } from './types';

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(),
}));

jest.mock('@/lib/transport/endpoint', () => ({
  buildApiUrl: jest.fn(
    (path: string) => `/api${path.startsWith('/') ? path : `/${path}`}`
  ),
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

describe('desktop download runtime task sdk', () => {
  let desktopRuntime: typeof import('./desktop-runtime');

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_DESKTOP_LOCAL_DOWNLOAD_RUNTIME = 'true';

    const runtimeConfigModule = jest.requireMock('@/lib/runtime-config') as {
      getRuntimeConfig: jest.Mock;
    };
    const endpointModule = jest.requireMock('@/lib/transport/endpoint') as {
      buildApiUrl: jest.Mock;
    };

    runtimeConfigModule.getRuntimeConfig.mockReturnValue({
      APP_TARGET: 'desktop',
      API_BASE_URL: 'http://127.0.0.1:8787',
    });
    endpointModule.buildApiUrl.mockImplementation(
      (path: string) => `/api${path.startsWith('/') ? path : `/${path}`}`
    );

    global.fetch = jest.fn();
    desktopRuntime = (await import(
      './desktop-runtime'
    )) as typeof import('./desktop-runtime');
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_DESKTOP_LOCAL_DOWNLOAD_RUNTIME;
  });

  it('reads and updates the desktop download engine snapshot', async () => {
    const snapshot = {
      maxConcurrentTasks: 5,
      tasks: {},
      lastEvent: {
        type: 'maxConcurrentTasksChanged',
        maxConcurrentTasks: 5,
      },
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(snapshot),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(snapshot),
      });

    await expect(
      desktopRuntime.getDesktopDownloadEngineSnapshot()
    ).resolves.toEqual(snapshot);
    await expect(
      desktopRuntime.putDesktopDownloadEngineSettings({
        maxConcurrentTasks: 9,
      })
    ).resolves.toEqual(snapshot);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/download-runtime/tasks',
      {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
      }
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/download-runtime/tasks/settings',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          maxConcurrentTasks: 9,
        }),
        cache: 'no-store',
        credentials: 'omit',
      }
    );
  });

  it('posts task mutations to the local runtime endpoints', async () => {
    const task = buildDownloadTask({
      id: 'task/id 1',
      cacheIndexId: 'cache:task/id 1',
    });
    const snapshot = {
      maxConcurrentTasks: 3,
      tasks: {
        [task.id]: task,
      },
      lastEvent: null,
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(snapshot),
    });

    await desktopRuntime.postDesktopDownloadTask(task);
    await desktopRuntime.pauseDesktopDownloadTask(task.id);
    await desktopRuntime.resumeDesktopDownloadTask(task.id);
    await desktopRuntime.cancelDesktopDownloadTask(task.id);
    await desktopRuntime.deleteDesktopDownloadTask(task.id);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/download-runtime/tasks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(task),
        cache: 'no-store',
        credentials: 'omit',
      }
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/download-runtime/tasks/task%2Fid%201/pause',
      {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
      }
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      '/api/download-runtime/tasks/task%2Fid%201/resume',
      {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
      }
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      '/api/download-runtime/tasks/task%2Fid%201/cancel',
      {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
      }
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      5,
      '/api/download-runtime/tasks/task%2Fid%201',
      {
        method: 'DELETE',
        cache: 'no-store',
        credentials: 'omit',
      }
    );
  });

  it('rejects calls when the desktop local runtime is unavailable', async () => {
    const runtimeConfigModule = jest.requireMock('@/lib/runtime-config') as {
      getRuntimeConfig: jest.Mock;
    };

    runtimeConfigModule.getRuntimeConfig.mockReturnValue({
      APP_TARGET: 'web',
      API_BASE_URL: '',
    });

    await expect(
      desktopRuntime.getDesktopDownloadEngineSnapshot()
    ).rejects.toThrow(
      'Desktop local download runtime is unavailable in the current build.'
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
