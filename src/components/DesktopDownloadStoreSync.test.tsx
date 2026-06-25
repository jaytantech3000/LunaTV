import { render, waitFor } from '@testing-library/react';

import { useDownloadStore } from '@/stores/downloadStore';

jest.mock('@/lib/download/desktop-runtime', () => ({
  clearDesktopDownloadStoreSnapshot: jest.fn().mockResolvedValue(undefined),
  getDesktopDownloadEngineSnapshot: jest.fn(),
  getDesktopDownloadStoreSnapshot: jest.fn(),
  isDesktopLocalDownloadRuntimeEnabled: jest.fn(),
  putDesktopDownloadStoreSnapshot: jest.fn().mockResolvedValue(undefined),
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
} from '@/lib/download/desktop-runtime';
import type { DownloadTask } from '@/lib/download/types';

import DesktopDownloadStoreSync from './DesktopDownloadStoreSync';

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
  const mockSyncDesktopDownloadEngineState = jest.mocked(
    syncDesktopDownloadEngineState
  );

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    resetDownloadStore();
    mockIsDesktopLocalDownloadRuntimeEnabled.mockReturnValue(true);
    mockPutDesktopDownloadStoreSnapshot.mockResolvedValue(undefined as never);
    mockSyncDesktopDownloadEngineState.mockResolvedValue(undefined as never);
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

    expect(mockSyncDesktopDownloadEngineState).toHaveBeenCalledWith({
      maxConcurrentTasks: 5,
      tasks: {
        [engineTask.id]: expect.objectContaining({
          status: 'paused',
        }),
      },
    });
    expect(mockPutDesktopDownloadStoreSnapshot).not.toHaveBeenCalled();
  });
});
