import { act, render, waitFor } from '@testing-library/react';

import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';

import { useDownloadStore } from '@/stores/downloadStore';

jest.mock('@/lib/download/desktop-runtime', () => ({
  clearDesktopDownloadStoreSnapshot: jest.fn().mockResolvedValue(undefined),
  getDesktopDownloadEngineSnapshot: jest.fn(),
  getDesktopDownloadStoreSnapshot: jest.fn(),
  isDesktopLocalDownloadRuntimeEnabled: jest.fn(),
  putDesktopDownloadStoreSnapshot: jest.fn().mockResolvedValue(undefined),
  subscribeToDesktopDownloadEngineSnapshots: jest.fn(),
}));

jest.mock('@/lib/download/desktop-engine-sync', () => {
  const actual = jest.requireActual('@/lib/download/desktop-engine-sync');
  return {
    __esModule: true,
    ...actual,
    syncDesktopDownloadEngineState: jest.fn().mockResolvedValue(undefined),
  };
});

import { syncDesktopDownloadEngineState } from '@/lib/download/desktop-engine-sync';
import {
  getDesktopDownloadEngineSnapshot,
  getDesktopDownloadStoreSnapshot,
  isDesktopLocalDownloadRuntimeEnabled,
  putDesktopDownloadStoreSnapshot,
  subscribeToDesktopDownloadEngineSnapshots,
} from '@/lib/download/desktop-runtime';
import type { DownloadTask } from '@/lib/download/types';

import DesktopDownloadStoreSync from './DesktopDownloadStoreSync';

type DesktopDownloadRuntimeSnapshot = Awaited<
  ReturnType<typeof getDesktopDownloadEngineSnapshot>
>;

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

describe('DesktopDownloadStoreSync', () => {
  const mockGetDesktopDownloadStoreSnapshot = jest.mocked(
    getDesktopDownloadStoreSnapshot
  );
  const mockGetDesktopDownloadEngineSnapshot = jest.mocked(
    getDesktopDownloadEngineSnapshot
  );
  const mockIsDesktopLocalDownloadRuntimeEnabled = jest.mocked(
    isDesktopLocalDownloadRuntimeEnabled
  );
  const mockPutDesktopDownloadStoreSnapshot = jest.mocked(
    putDesktopDownloadStoreSnapshot
  );
  const mockSubscribeToDesktopDownloadEngineSnapshots = jest.mocked(
    subscribeToDesktopDownloadEngineSnapshots
  );
  const mockSyncDesktopDownloadEngineState = jest.mocked(
    syncDesktopDownloadEngineState
  );
  let runtimeSnapshotHandler:
    | ((snapshot: DesktopDownloadRuntimeSnapshot) => void)
    | null = null;
  let runtimeSubscriptionUnsubscribe: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    resetDownloadStore();
    mockIsDesktopLocalDownloadRuntimeEnabled.mockReturnValue(true);
    mockPutDesktopDownloadStoreSnapshot.mockResolvedValue(undefined as never);
    mockSyncDesktopDownloadEngineState.mockResolvedValue(undefined as never);
    runtimeSnapshotHandler = null;
    runtimeSubscriptionUnsubscribe = jest.fn();
    mockSubscribeToDesktopDownloadEngineSnapshots.mockImplementation(
      ({ onSnapshot }) => {
        runtimeSnapshotHandler = onSnapshot as typeof runtimeSnapshotHandler;
        return runtimeSubscriptionUnsubscribe;
      }
    );
  });

  it('hydrates task state from the rust engine snapshot on startup', async () => {
    const persistedTask = buildDownloadTask({
      status: 'downloading',
      progress: 25,
    });
    const engineTask = {
      ...persistedTask,
      status: 'paused' as const,
      progress: 25,
    };

    useDownloadStore.setState({
      hasHydrated: true,
      maxConcurrentTasks: 3,
      ownerUsername: null,
      tasks: {
        [persistedTask.id]: persistedTask,
      },
      library: {},
    });

    mockGetDesktopDownloadStoreSnapshot.mockResolvedValue({
      maxConcurrentTasks: 3,
      ownerUsername: 'monica',
      tasks: {
        [persistedTask.id]: persistedTask,
      },
      library: {},
    });
    mockGetDesktopDownloadEngineSnapshot.mockResolvedValue({
      maxConcurrentTasks: 5,
      tasks: {
        [engineTask.id]: engineTask,
      },
      lastEvent: null,
    });

    render(<DesktopDownloadStoreSync />);

    await waitFor(() => {
      expect(useDownloadStore.getState().maxConcurrentTasks).toBe(5);
      expect(useDownloadStore.getState().tasks[engineTask.id]?.status).toBe(
        'paused'
      );
      expect(useDownloadStore.getState().ownerUsername).toBe('monica');
    });

    expect(mockSyncDesktopDownloadEngineState).toHaveBeenCalledWith(
      {
        maxConcurrentTasks: 5,
        tasks: {
          [engineTask.id]: expect.objectContaining({
            status: 'paused',
          }),
        },
      },
      {
        maxConcurrentTasks: 5,
        tasks: {
          [engineTask.id]: expect.objectContaining({
            status: 'paused',
          }),
        },
        lastEvent: null,
      }
    );
    expect(mockPutDesktopDownloadStoreSnapshot).not.toHaveBeenCalled();
  });

  it('applies incoming runtime snapshots without resetting downloading state or echoing back to rust', async () => {
    const localTask = buildDownloadTask({
      id: 'demo:runtime:1',
      cacheIndexId: 'cache:demo:runtime:1',
      status: 'paused',
      progress: 30,
    });
    const runtimeTask = buildDownloadTask({
      id: localTask.id,
      cacheIndexId: localTask.cacheIndexId,
      status: 'downloading',
      progress: 65,
      currentSizeBytes: 4096,
      sizeBytes: 2048,
      downloadSpeedBytesPerSecond: 1024,
      updatedAt: 2,
    });

    useDownloadStore.setState({
      hasHydrated: true,
      maxConcurrentTasks: 3,
      ownerUsername: 'monica',
      tasks: {
        [localTask.id]: localTask,
      },
      library: {
        'demo:1': {
          contentId: 'demo:1',
          source: 'demo',
          vodId: '1',
          sourceName: 'Demo Source',
          title: 'Demo Title',
          poster: 'https://img.example.com/demo.jpg',
          year: '2026',
          episodeTitles: ['Episode 1'],
          ownerUsername: 'monica',
          episodes: [],
          totalSizeBytes: 0,
          updatedAt: 1,
        },
      },
    });

    mockGetDesktopDownloadStoreSnapshot.mockResolvedValue({
      maxConcurrentTasks: 3,
      ownerUsername: 'monica',
      tasks: {
        [localTask.id]: localTask,
      },
      library: {
        'demo:1': {
          contentId: 'demo:1',
          source: 'demo',
          vodId: '1',
          sourceName: 'Demo Source',
          title: 'Demo Title',
          poster: 'https://img.example.com/demo.jpg',
          year: '2026',
          episodeTitles: ['Episode 1'],
          ownerUsername: 'monica',
          episodes: [],
          totalSizeBytes: 0,
          updatedAt: 1,
        },
      },
    });
    mockGetDesktopDownloadEngineSnapshot.mockResolvedValue({
      maxConcurrentTasks: 3,
      tasks: {
        [localTask.id]: localTask,
      },
      lastEvent: null,
    });

    const view = render(<DesktopDownloadStoreSync />);

    await waitFor(() => {
      expect(runtimeSnapshotHandler).not.toBeNull();
      expect(mockSyncDesktopDownloadEngineState).toHaveBeenCalledTimes(1);
    });

    mockSyncDesktopDownloadEngineState.mockClear();

    act(() => {
      runtimeSnapshotHandler?.({
        maxConcurrentTasks: 5,
        tasks: {
          [runtimeTask.id]: runtimeTask,
        },
        lastEvent: null,
      });
    });

    await waitFor(() => {
      const state = useDownloadStore.getState();
      expect(state.maxConcurrentTasks).toBe(5);
      expect(state.tasks[runtimeTask.id]?.status).toBe('downloading');
      expect(state.tasks[runtimeTask.id]?.currentSizeBytes).toBe(4096);
      expect(state.ownerUsername).toBe('monica');
      expect(state.library['demo:1']).toEqual(
        expect.objectContaining({
          ownerUsername: 'monica',
        })
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(mockSyncDesktopDownloadEngineState).not.toHaveBeenCalled();
    expect(mockPutDesktopDownloadStoreSnapshot).not.toHaveBeenCalled();

    view.unmount();
    expect(runtimeSubscriptionUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('persists local store changes without re-mirroring the entire task set back to rust', async () => {
    const localTask = buildDownloadTask({
      id: 'demo:local:1',
      cacheIndexId: 'cache:demo:local:1',
      status: 'queued',
      progress: 10,
    });

    mockGetDesktopDownloadStoreSnapshot.mockResolvedValue(null);
    mockGetDesktopDownloadEngineSnapshot.mockResolvedValue({
      maxConcurrentTasks: 3,
      tasks: {},
      lastEvent: null,
    });

    render(<DesktopDownloadStoreSync />);

    await waitFor(() => {
      expect(runtimeSnapshotHandler).not.toBeNull();
      expect(mockSyncDesktopDownloadEngineState).toHaveBeenCalledTimes(1);
    });

    mockPutDesktopDownloadStoreSnapshot.mockClear();
    mockSyncDesktopDownloadEngineState.mockClear();

    act(() => {
      useDownloadStore.setState({
        tasks: {
          [localTask.id]: localTask,
        },
      });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(mockPutDesktopDownloadStoreSnapshot).toHaveBeenCalledTimes(1);
    expect(mockPutDesktopDownloadStoreSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: {
          [localTask.id]: expect.objectContaining({
            id: localTask.id,
            status: 'queued',
          }),
        },
      })
    );
    expect(mockSyncDesktopDownloadEngineState).not.toHaveBeenCalled();
  });

  it('hydrates runtime-completed tasks into the offline library and persists the merged snapshot', async () => {
    const doneTask = buildDownloadTask({
      id: 'demo:done:1',
      cacheIndexId: 'cache:demo:done:1',
      status: 'done',
      progress: 100,
      totalResources: 2,
      downloadedResources: 2,
      sizeBytes: 8192,
      currentSizeBytes: 8192,
      estimatedTotalSizeBytes: 8192,
      updatedAt: 2,
    });

    useDownloadStore.setState({
      hasHydrated: true,
      maxConcurrentTasks: 3,
      ownerUsername: 'monica',
      tasks: {},
      library: {},
    });

    mockGetDesktopDownloadStoreSnapshot.mockResolvedValue({
      maxConcurrentTasks: 3,
      ownerUsername: 'monica',
      tasks: {},
      library: {},
    });
    mockGetDesktopDownloadEngineSnapshot.mockResolvedValue({
      maxConcurrentTasks: 3,
      tasks: {},
      lastEvent: null,
    });

    render(<DesktopDownloadStoreSync />);

    await waitFor(() => {
      expect(runtimeSnapshotHandler).not.toBeNull();
    });

    mockPutDesktopDownloadStoreSnapshot.mockClear();

    act(() => {
      runtimeSnapshotHandler?.({
        maxConcurrentTasks: 3,
        tasks: {
          [doneTask.id]: doneTask,
        },
        lastEvent: {
          type: 'taskUpserted',
          taskId: doneTask.id,
          status: 'done',
        },
      });
    });

    await waitFor(() => {
      const libraryItem =
        useDownloadStore.getState().library[doneTask.contentId];
      expect(libraryItem).toEqual(
        expect.objectContaining({
          ownerUsername: 'monica',
          contentId: doneTask.contentId,
          totalSizeBytes: 8192,
        })
      );
      expect(libraryItem?.episodes).toEqual([
        expect.objectContaining({
          episodeIndex: doneTask.episodeIndex,
          cacheIndexId: doneTask.cacheIndexId,
          rootManifestUrl: doneTask.entryManifestUrl,
          playbackManifestUrl: doneTask.playbackManifestUrl,
          resourceCount: 2,
          sizeBytes: 8192,
        }),
      ]);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(mockPutDesktopDownloadStoreSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUsername: 'monica',
        library: {
          [doneTask.contentId]: expect.objectContaining({
            totalSizeBytes: 8192,
            episodes: [
              expect.objectContaining({
                cacheIndexId: doneTask.cacheIndexId,
                sizeBytes: 8192,
              }),
            ],
          }),
        },
      })
    );
  });

  it('reloads the desktop snapshot after runtime refresh events to finish owner handoff', async () => {
    useDownloadStore.setState({
      hasHydrated: true,
      maxConcurrentTasks: 3,
      ownerUsername: 'remote-owner',
      tasks: {},
      library: {
        'demo:1': {
          contentId: 'demo:1',
          source: 'demo',
          vodId: '1',
          sourceName: 'Demo Source',
          title: 'Demo Title',
          poster: 'https://img.example.com/demo.jpg',
          year: '2026',
          episodeTitles: ['Episode 1'],
          ownerUsername: 'admin',
          episodes: [],
          totalSizeBytes: 0,
          updatedAt: 1,
        },
      },
    });

    mockGetDesktopDownloadStoreSnapshot
      .mockResolvedValueOnce({
        maxConcurrentTasks: 3,
        ownerUsername: 'remote-owner',
        tasks: {},
        library: {
          'demo:1': {
            contentId: 'demo:1',
            source: 'demo',
            vodId: '1',
            sourceName: 'Demo Source',
            title: 'Demo Title',
            poster: 'https://img.example.com/demo.jpg',
            year: '2026',
            episodeTitles: ['Episode 1'],
            ownerUsername: 'admin',
            episodes: [],
            totalSizeBytes: 0,
            updatedAt: 1,
          },
        },
      })
      .mockResolvedValue({
        maxConcurrentTasks: 3,
        ownerUsername: 'remote-owner',
        tasks: {},
        library: {
          'demo:1': {
            contentId: 'demo:1',
            source: 'demo',
            vodId: '1',
            sourceName: 'Demo Source',
            title: 'Demo Title',
            poster: 'https://img.example.com/demo.jpg',
            year: '2026',
            episodeTitles: ['Episode 1'],
            ownerUsername: 'remote-owner',
            episodes: [],
            totalSizeBytes: 0,
            updatedAt: 2,
          },
        },
      });
    mockGetDesktopDownloadEngineSnapshot.mockResolvedValue({
      maxConcurrentTasks: 3,
      tasks: {},
      lastEvent: null,
    });

    render(<DesktopDownloadStoreSync />);

    await waitFor(() => {
      expect(mockSyncDesktopDownloadEngineState).toHaveBeenCalledTimes(1);
    });

    expect(useDownloadStore.getState().library['demo:1']?.ownerUsername).toBe(
      'admin'
    );

    act(() => {
      window.dispatchEvent(new Event(DESKTOP_RUNTIME_UPDATED_EVENT));
    });

    await waitFor(() => {
      expect(useDownloadStore.getState().library['demo:1']?.ownerUsername).toBe(
        'remote-owner'
      );
    });
  });
});
