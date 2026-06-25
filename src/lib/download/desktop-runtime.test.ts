import * as desktopRuntime from './desktop-runtime';
import type { DownloadTask } from './types';

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(),
}));

jest.mock('@/lib/transport/endpoint', () => ({
  buildApiUrl: jest.fn(
    (
      path: string,
      searchParams?: Record<
        string,
        string | number | boolean | null | undefined
      >
    ) => {
      const normalizedPath = `/api${path.startsWith('/') ? path : `/${path}`}`;
      const query = new URLSearchParams();

      Object.entries(searchParams || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          return;
        }
        query.set(key, String(value));
      });

      const queryString = query.toString();
      return queryString ? `${normalizedPath}?${queryString}` : normalizedPath;
    }
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

function buildJsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(payload),
  };
}

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 1;
  readonly close = jest.fn(() => {
    this.readyState = 2;
  });

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  static reset(): void {
    MockEventSource.instances = [];
  }

  emitSnapshot(snapshot: unknown): void {
    this.onmessage?.({
      data: JSON.stringify(snapshot),
    } as MessageEvent);
  }

  emitRawMessage(data: string): void {
    this.onmessage?.({
      data,
    } as MessageEvent);
  }

  emitError(): void {
    this.onerror?.(new Event('error'));
  }
}

describe('desktop download runtime task sdk', () => {
  beforeEach(() => {
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
      (
        path: string,
        searchParams?: Record<
          string,
          string | number | boolean | null | undefined
        >
      ) => {
        const normalizedPath = `/api${
          path.startsWith('/') ? path : `/${path}`
        }`;
        const query = new URLSearchParams();

        Object.entries(searchParams || {}).forEach(([key, value]) => {
          if (value === undefined || value === null || value === '') {
            return;
          }
          query.set(key, String(value));
        });

        const queryString = query.toString();
        return queryString
          ? `${normalizedPath}?${queryString}`
          : normalizedPath;
      }
    );

    global.fetch = jest.fn();
    global.EventSource =
      MockEventSource as unknown as typeof global.EventSource;
    MockEventSource.reset();
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
      .mockResolvedValueOnce(buildJsonResponse(snapshot))
      .mockResolvedValueOnce(buildJsonResponse(snapshot));

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

  it('fetches uncached desktop download resources through the local runtime', async () => {
    const runtimeResponse = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'content-type': 'video/mp2t',
      },
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce(runtimeResponse);

    const response = await desktopRuntime.fetchDesktopDownloadCacheResponse(
      'http://127.0.0.1:8787/media/vod/segment?source=demo&url=https%3A%2F%2Fcdn.example.com%2F0001.ts'
    );

    expect(response).toBe(runtimeResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/download-runtime/cache/fetch?url=http%3A%2F%2F127.0.0.1%3A8787%2Fmedia%2Fvod%2Fsegment%3Fsource%3Ddemo%26url%3Dhttps%253A%252F%252Fcdn.example.com%252F0001.ts',
      {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: undefined,
      }
    );
  });

  it('posts task mutations and clear-all commands to the local runtime endpoints', async () => {
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
    const clearedSnapshot = {
      maxConcurrentTasks: 3,
      tasks: {},
      lastEvent: null,
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(buildJsonResponse(snapshot))
      .mockResolvedValueOnce(buildJsonResponse(snapshot))
      .mockResolvedValueOnce(buildJsonResponse(snapshot))
      .mockResolvedValueOnce(buildJsonResponse(snapshot))
      .mockResolvedValueOnce(buildJsonResponse(snapshot))
      .mockResolvedValueOnce(buildJsonResponse(clearedSnapshot));

    await desktopRuntime.postDesktopDownloadTask(task);
    await desktopRuntime.pauseDesktopDownloadTask(task.id);
    await desktopRuntime.resumeDesktopDownloadTask(task.id);
    await desktopRuntime.cancelDesktopDownloadTask(task.id);
    await desktopRuntime.deleteDesktopDownloadTask(task.id);
    await expect(
      desktopRuntime.clearDesktopDownloadEngineTasks()
    ).resolves.toEqual(clearedSnapshot);

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
    expect(global.fetch).toHaveBeenNthCalledWith(
      6,
      '/api/download-runtime/tasks',
      {
        method: 'DELETE',
        cache: 'no-store',
        credentials: 'omit',
      }
    );
  });

  it('resolves desktop download manifests through the local runtime endpoint', async () => {
    const manifestResult = {
      rootManifestUrl:
        '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Froot.m3u8',
      playbackManifestUrl:
        'http://127.0.0.1:8787/media/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Fplayback.m3u8',
      resources: [
        {
          type: 'manifest',
          url: '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Froot.m3u8',
        },
        {
          type: 'segment',
          url: 'http://127.0.0.1:8787/media/vod/segment?source=demo&url=https%3A%2F%2Fcdn.example.com%2F0001.ts',
        },
      ],
      resourceUrls: [
        '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Froot.m3u8',
        'http://127.0.0.1:8787/media/vod/segment?source=demo&url=https%3A%2F%2Fcdn.example.com%2F0001.ts',
      ],
      isMasterPlaylist: false,
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      buildJsonResponse(manifestResult)
    );

    await expect(
      desktopRuntime.resolveDesktopDownloadManifest([
        '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Froot.m3u8',
      ])
    ).resolves.toEqual(manifestResult);

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/download-runtime/manifest/resolve',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entryManifestUrls: [
            '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Froot.m3u8',
          ],
        }),
        cache: 'no-store',
        credentials: 'omit',
        signal: undefined,
      }
    );
  });

  it('subscribes to desktop download engine snapshots over EventSource', async () => {
    const snapshot = {
      maxConcurrentTasks: 4,
      tasks: {},
      lastEvent: null,
    };
    const fallbackSnapshot = {
      maxConcurrentTasks: 4,
      tasks: {
        [buildDownloadTask().id]: buildDownloadTask({
          status: 'downloading',
          progress: 50,
          downloadedResources: 5,
        }),
      },
      lastEvent: {
        type: 'taskUpserted',
        taskId: buildDownloadTask().id,
        status: 'downloading',
      },
    };
    const onSnapshot = jest.fn();
    const onError = jest.fn();
    (global.fetch as jest.Mock).mockResolvedValue(
      buildJsonResponse(fallbackSnapshot)
    );

    const unsubscribe =
      desktopRuntime.subscribeToDesktopDownloadEngineSnapshots({
        onSnapshot,
        onError,
      });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(
      '/api/download-runtime/tasks/stream'
    );

    MockEventSource.instances[0].emitSnapshot(snapshot);
    expect(onSnapshot).toHaveBeenCalledWith(snapshot);

    MockEventSource.instances[0].emitRawMessage('{');
    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    onSnapshot.mockClear();
    onError.mockClear();
    const fallbackSnapshotPromise = new Promise((resolve) => {
      onSnapshot.mockImplementationOnce(resolve as (value: unknown) => void);
    });
    MockEventSource.instances[0].emitError();
    await expect(fallbackSnapshotPromise).resolves.toEqual(fallbackSnapshot);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Desktop download runtime snapshot stream disconnected.',
      })
    );
    expect(global.fetch).toHaveBeenCalledWith('/api/download-runtime/tasks', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
    });
    expect(onSnapshot).toHaveBeenLastCalledWith(fallbackSnapshot);

    unsubscribe();
    expect(MockEventSource.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling when EventSource is unavailable', async () => {
    jest.useFakeTimers();
    const mutableGlobal = globalThis as typeof globalThis & {
      EventSource?: typeof EventSource;
    };
    const originalEventSource = mutableGlobal.EventSource;
    const snapshot = {
      maxConcurrentTasks: 2,
      tasks: {},
      lastEvent: {
        type: 'maxConcurrentTasksChanged',
        maxConcurrentTasks: 2,
      },
    };
    const onSnapshot = jest.fn();
    const onError = jest.fn();

    try {
      mutableGlobal.EventSource = undefined as unknown as typeof EventSource;
      (global.fetch as jest.Mock).mockResolvedValue(
        buildJsonResponse(snapshot)
      );
      const firstSnapshotPromise = new Promise((resolve) => {
        onSnapshot.mockImplementationOnce(resolve as (value: unknown) => void);
      });

      const unsubscribe =
        desktopRuntime.subscribeToDesktopDownloadEngineSnapshots({
          onSnapshot,
          onError,
        });

      await expect(firstSnapshotPromise).resolves.toEqual(snapshot);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(onSnapshot).toHaveBeenCalledWith(snapshot);
      expect(onError).not.toHaveBeenCalled();

      const secondSnapshotPromise = new Promise((resolve) => {
        onSnapshot.mockImplementationOnce(resolve as (value: unknown) => void);
      });
      jest.advanceTimersByTime(2_000);
      await expect(secondSnapshotPromise).resolves.toEqual(snapshot);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      unsubscribe();
      jest.advanceTimersByTime(2_000);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      mutableGlobal.EventSource = originalEventSource;
      jest.useRealTimers();
    }
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
