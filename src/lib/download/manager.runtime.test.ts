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
  isDesktopLocalDownloadRuntimeEnabled: jest.fn(),
}));

jest.mock('./desktop-engine-sync', () => ({
  cancelDesktopDownloadEngineTask: jest.fn().mockResolvedValue(undefined),
  deleteMirroredDesktopDownloadTask: jest.fn().mockResolvedValue(undefined),
  pauseDesktopDownloadEngineTask: jest.fn().mockResolvedValue(undefined),
  resumeDesktopDownloadEngineTask: jest.fn().mockResolvedValue(undefined),
  upsertDesktopDownloadEngineTask: jest.fn().mockResolvedValue(undefined),
}));

import {
  cancelDesktopDownloadEngineTask,
  deleteMirroredDesktopDownloadTask,
  pauseDesktopDownloadEngineTask,
  resumeDesktopDownloadEngineTask,
  upsertDesktopDownloadEngineTask,
} from './desktop-engine-sync';
import { isDesktopLocalDownloadRuntimeEnabled } from './desktop-runtime';
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
  const mockParseManifestForDownloadWithFallback = jest.mocked(
    parseManifestForDownloadWithFallback
  );

  beforeEach(() => {
    jest.clearAllMocks();
    resetDownloadStore();
    mockIsDesktopLocalDownloadRuntimeEnabled.mockReturnValue(true);
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
  });

  afterEach(() => {
    downloadManager.abortAll();
    resetDownloadStore();
  });

  it('mirrors pause, resume and cancel actions into the desktop runtime', async () => {
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
        [task.id]: task,
      },
    });

    await downloadManager.cancelTask(task.id);
    expect(useDownloadStore.getState().tasks[task.id]).toBeUndefined();
    expect(cancelDesktopDownloadEngineTask).toHaveBeenCalledWith(task.id);
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

    expect(upsertDesktopDownloadEngineTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: task.id,
        status: 'queued',
      })
    );
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
    expect(resumeDesktopDownloadEngineTask).not.toHaveBeenCalled();
    expect(cancelDesktopDownloadEngineTask).not.toHaveBeenCalled();
    expect(upsertDesktopDownloadEngineTask).not.toHaveBeenCalled();
  });
});
