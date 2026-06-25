import { waitFor } from '@testing-library/react';

import { SearchResult } from '@/lib/types';

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
  getOfflineDownloadSupportState: jest.fn(() => ({
    supported: true,
  })),
  hasCachedDownload: jest.fn(),
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
  resumeDesktopDownloadEngineTask: jest.fn().mockResolvedValue(undefined),
  upsertDesktopDownloadEngineTask: jest.fn().mockResolvedValue(undefined),
}));

import { hasCachedDownload } from './cache';
import { upsertDesktopDownloadEngineTask } from './desktop-engine-sync';
import {
  fetchDesktopDownloadCacheResponse,
  isDesktopLocalDownloadRuntimeEnabled,
} from './desktop-runtime';
import { downloadManager, resolveDownloadResourceCachedState } from './manager';
import { parseManifestForDownloadWithFallback } from './manifest';

const mockedHasCachedDownload = hasCachedDownload as jest.MockedFunction<
  typeof hasCachedDownload
>;
const mockedParseManifestForDownloadWithFallback =
  parseManifestForDownloadWithFallback as jest.MockedFunction<
    typeof parseManifestForDownloadWithFallback
  >;

function buildSearchResult(partial: Partial<SearchResult> = {}): SearchResult {
  return {
    id: partial.id || 'vod-id',
    title: partial.title || '主角',
    poster: partial.poster || '',
    episodes: partial.episodes || ['https://example.com/current/index.m3u8'],
    episodes_titles: partial.episodes_titles || ['第1集'],
    source: partial.source || 'demo',
    source_name: partial.source_name || '演示源',
    year: partial.year || '2026',
    desc: partial.desc,
    type_name: partial.type_name,
    douban_id: partial.douban_id,
  };
}

function resetDownloadStore(): void {
  useDownloadStore.setState({
    hasHydrated: true,
    maxConcurrentTasks: 1,
    ownerUsername: null,
    tasks: {},
    library: {},
  });
}

describe('resolveDownloadResourceCachedState', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedHasCachedDownload.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('falls back to uncached when cache lookup stalls', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mockedHasCachedDownload.mockImplementation(
      () => new Promise<boolean>(() => undefined)
    );

    const promise = resolveDownloadResourceCachedState(
      'https://example.com/final.ts',
      {
        timeoutMs: 25,
      }
    );

    jest.advanceTimersByTime(25);

    await expect(promise).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('downloadManager cache lookup fallback', () => {
  const originalFetch = global.fetch;
  const mockIsDesktopLocalDownloadRuntimeEnabled = jest.mocked(
    isDesktopLocalDownloadRuntimeEnabled
  );
  const mockFetchDesktopDownloadCacheResponse = jest.mocked(
    fetchDesktopDownloadCacheResponse
  );
  const mockUpsertDesktopDownloadEngineTask = jest.mocked(
    upsertDesktopDownloadEngineTask
  );

  beforeEach(() => {
    jest.useRealTimers();
    mockedHasCachedDownload.mockReset();
    mockedParseManifestForDownloadWithFallback.mockReset();
    mockIsDesktopLocalDownloadRuntimeEnabled.mockReturnValue(true);
    mockFetchDesktopDownloadCacheResponse.mockReset();
    mockUpsertDesktopDownloadEngineTask.mockReset();
    mockUpsertDesktopDownloadEngineTask.mockResolvedValue(undefined as never);
    resetDownloadStore();
    localStorage.clear();
  });

  afterEach(() => {
    downloadManager.abortAll();
    resetDownloadStore();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('continues downloading when the final resource cache lookup fails', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mockedHasCachedDownload
      .mockRejectedValueOnce(
        new Error('Desktop download runtime request timed out')
      )
      .mockResolvedValue(false);
    mockedParseManifestForDownloadWithFallback.mockResolvedValue({
      rootManifestUrl: 'https://example.com/root.m3u8',
      playbackManifestUrl: 'https://example.com/root.m3u8',
      resources: [
        {
          url: 'https://example.com/final.ts',
          type: 'segment',
        },
      ],
      resourceUrls: ['https://example.com/final.ts'],
      isMasterPlaylist: false,
    });

    mockFetchDesktopDownloadCacheResponse.mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          'content-length': '12',
          'content-type': 'video/mp2t',
        },
      })
    );

    const task = await downloadManager.startEpisodeDownload({
      detail: buildSearchResult(),
      episodeIndex: 0,
    });

    await waitFor(() => {
      expect(useDownloadStore.getState().tasks[task.id]?.status).toBe('done');
    });

    expect(useDownloadStore.getState().tasks[task.id]).toMatchObject({
      status: 'done',
      totalResources: 1,
      downloadedResources: 1,
      progress: 100,
      sizeBytes: 12,
    });
    expect(mockUpsertDesktopDownloadEngineTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: task.id,
        status: 'done',
        progress: 100,
        downloadedResources: 1,
        totalResources: 1,
      })
    );
    expect(fetchDesktopDownloadCacheResponse).toHaveBeenCalledWith(
      'https://example.com/final.ts',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
    expect(warnSpy).toHaveBeenCalled();
  });
});
