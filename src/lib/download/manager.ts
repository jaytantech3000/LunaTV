import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { searchPlaybackSources } from '@/lib/playback-source-prefetch';
import { SearchResult } from '@/lib/types';

import { useDownloadStore } from '@/stores/downloadStore';

import {
  deleteCachedDownloads,
  getOfflineDownloadSupportState,
  hasCachedDownload,
  putDownloadResponse,
} from './cache';
import { parseManifestForDownloadWithFallback } from './manifest';
import { normalizeVodEpisodeUrlForDownload } from './normalize';
import {
  deleteResourceIndex,
  getResourceIndex,
  putResourceIndex,
} from './resource-index';
import {
  buildDownloadCacheIndexId,
  buildDownloadContentId,
  buildDownloadTaskId,
  DownloadedContentMeta,
  DownloadTask,
  DownloadTaskStatus,
  normalizeConcurrentDownloadTasks,
} from './types';

interface StartEpisodeDownloadParams {
  detail: SearchResult;
  episodeIndex: number;
  availableSources?: SearchResult[];
}

interface StartBatchEpisodeDownloadParams {
  detail: SearchResult;
  episodeIndexes: number[];
  availableSources?: SearchResult[];
}

interface TaskRunnerState {
  mode: 'running' | 'paused' | 'cancelled' | 'failed';
  controllers: Set<AbortController>;
  task: DownloadTask;
  failureError?: Error;
}

interface DownloadResourceTransferProgress {
  loadedBytes: number;
  totalBytes: number;
}

interface DownloadResourceTransferResult {
  sizeBytes: number;
  totalBytes: number;
}

interface QueueEpisodeDownloadResult {
  task: DownloadTask;
  queued: boolean;
}

interface BatchDownloadResult {
  queuedCount: number;
  skippedCount: number;
  tasks: DownloadTask[];
}

const RESOURCE_DOWNLOAD_WORKER_COUNT = 3;
const MAX_RESOURCE_DOWNLOAD_RETRIES = 2;
const PROGRESS_FLUSH_INTERVAL_MS = 250;
const DOWNLOAD_REQUEST_INTENT_HEADER = 'x-moontv-download-intent';
const BACKGROUND_DOWNLOAD_REQUEST_INTENT = 'background';

function getCurrentOwnerUsername(): string {
  const username = getAuthInfoFromBrowserCookie()?.username?.trim();
  if (!username) {
    throw new Error('当前未登录，无法使用离线下载');
  }
  return username;
}

function now(): number {
  return Date.now();
}

function getEpisodeTitle(detail: SearchResult, episodeIndex: number): string {
  return detail.episodes_titles[episodeIndex] || `第 ${episodeIndex + 1} 集`;
}

function calculateProgress(
  downloadedResources: number,
  totalResources: number
): number {
  if (totalResources <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.round((downloadedResources / totalResources) * 100)
  );
}

function upsertTask(task: DownloadTask): void {
  useDownloadStore.getState().upsertTask(task);
}

function patchTask(
  taskId: string,
  updater: (task: DownloadTask) => DownloadTask
): void {
  useDownloadStore
    .getState()
    .patchTask(taskId, (task) => (task ? updater(task) : undefined));
}

function mergeManifestCandidateUrls(...candidateLists: string[][]): string[] {
  const seen = new Set<string>();
  const mergedCandidates: string[] = [];

  candidateLists.forEach((candidates) => {
    candidates.forEach((candidate) => {
      const normalizedCandidate = candidate.trim();
      if (!normalizedCandidate || seen.has(normalizedCandidate)) {
        return;
      }

      seen.add(normalizedCandidate);
      mergedCandidates.push(normalizedCandidate);
    });
  });

  return mergedCandidates;
}

function collectDownloadManifestCandidateUrls(
  sources: SearchResult[],
  episodeIndex: number
): string[] {
  return mergeManifestCandidateUrls(
    sources.map((candidate) =>
      normalizeVodEpisodeUrlForDownload(
        candidate.source,
        candidate.episodes[episodeIndex] || ''
      )
    )
  );
}

export function buildDownloadManifestCandidateUrls(
  detail: SearchResult,
  episodeIndex: number,
  availableSources: SearchResult[] = []
): string[] {
  return collectDownloadManifestCandidateUrls(
    [detail, ...availableSources],
    episodeIndex
  );
}

function pickPreferredTextValue(
  primaryValue: string | undefined,
  fallbackValue: string | undefined
): string {
  const normalizedPrimaryValue = primaryValue?.trim();
  if (normalizedPrimaryValue) {
    return normalizedPrimaryValue;
  }

  return fallbackValue?.trim() || '';
}

function pickPreferredOptionalTextValue(
  primaryValue: string | undefined,
  fallbackValue: string | undefined
): string | undefined {
  const nextValue = pickPreferredTextValue(primaryValue, fallbackValue);
  return nextValue || undefined;
}

function pickPreferredDoubanId(
  primaryValue: number | undefined,
  fallbackValue: number | undefined
): number | undefined {
  if (
    typeof primaryValue === 'number' &&
    Number.isFinite(primaryValue) &&
    primaryValue > 0
  ) {
    return primaryValue;
  }

  if (
    typeof fallbackValue === 'number' &&
    Number.isFinite(fallbackValue) &&
    fallbackValue > 0
  ) {
    return fallbackValue;
  }

  return undefined;
}

function buildInitialTask(
  detail: SearchResult,
  episodeIndex: number,
  availableSources: SearchResult[] = []
): DownloadTask {
  const contentId = buildDownloadContentId(detail.source, detail.id);
  const taskId = buildDownloadTaskId(contentId, episodeIndex);
  const manifestCandidateUrls = buildDownloadManifestCandidateUrls(
    detail,
    episodeIndex,
    availableSources
  );
  const entryManifestUrl =
    manifestCandidateUrls[0] ||
    normalizeVodEpisodeUrlForDownload(
      detail.source,
      detail.episodes[episodeIndex] || ''
    );
  const createdAt = now();

  return {
    id: taskId,
    contentId,
    source: detail.source,
    sourceName: detail.source_name,
    vodId: detail.id,
    episodeIndex,
    title: detail.title,
    poster: detail.poster,
    year: detail.year,
    desc: detail.desc,
    typeName: detail.type_name,
    doubanId: detail.douban_id,
    episodeTitle: getEpisodeTitle(detail, episodeIndex),
    originalM3u8Url: detail.episodes[episodeIndex] || '',
    entryManifestUrl,
    manifestCandidateUrls,
    cacheIndexId: buildDownloadCacheIndexId(taskId),
    status: 'queued',
    progress: 0,
    totalResources: 0,
    downloadedResources: 0,
    sizeBytes: 0,
    currentSizeBytes: 0,
    estimatedTotalSizeBytes: 0,
    downloadSpeedBytesPerSecond: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

export function applyLibraryMetadataFallback(
  task: DownloadTask,
  previousItem: DownloadedContentMeta | undefined
): DownloadTask {
  if (!previousItem) {
    return task;
  }

  return {
    ...task,
    sourceName: pickPreferredTextValue(task.sourceName, previousItem.sourceName),
    title: pickPreferredTextValue(task.title, previousItem.title),
    poster: pickPreferredTextValue(task.poster, previousItem.poster),
    year: pickPreferredTextValue(task.year, previousItem.year),
    desc: pickPreferredOptionalTextValue(task.desc, previousItem.desc),
    typeName: pickPreferredOptionalTextValue(
      task.typeName,
      previousItem.typeName
    ),
    doubanId: pickPreferredDoubanId(task.doubanId, previousItem.doubanId),
  };
}

async function downloadAndCacheUrl(
  url: string,
  controller: AbortController,
  onProgress?: (progress: DownloadResourceTransferProgress) => void
): Promise<DownloadResourceTransferResult> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      [DOWNLOAD_REQUEST_INTENT_HEADER]: BACKGROUND_DOWNLOAD_REQUEST_INTENT,
    },
    signal: controller.signal,
  });

  if (!response.ok) {
    throw new Error(`下载资源失败: ${response.status}`);
  }

  const contentLengthHeader = Number(response.headers.get('content-length') || 0);
  const totalBytes =
    Number.isFinite(contentLengthHeader) && contentLengthHeader > 0
      ? contentLengthHeader
      : 0;

  if (!response.body) {
    await putDownloadResponse(url, response.clone());
    onProgress?.({
      loadedBytes: totalBytes,
      totalBytes,
    });
    return {
      sizeBytes: totalBytes,
      totalBytes,
    };
  }

  const [cacheStream, measureStream] = response.body.tee();
  const cachePromise = putDownloadResponse(
    url,
    new Response(cacheStream, {
      headers: new Headers(response.headers),
      status: response.status,
      statusText: response.statusText,
    })
  );
  const reader = measureStream.getReader();
  let loadedBytes = 0;

  onProgress?.({
    loadedBytes,
    totalBytes,
  });

  try {
    let isDone = false;

    while (!isDone) {
      const { done, value } = await reader.read();

      if (done) {
        isDone = true;
        continue;
      }

      loadedBytes += value?.byteLength || 0;
      onProgress?.({
        loadedBytes,
        totalBytes,
      });
    }
  } finally {
    reader.releaseLock();
  }

  await cachePromise;

  return {
    sizeBytes: loadedBytes,
    totalBytes: Math.max(totalBytes, loadedBytes),
  };
}

function isRetryableDownloadError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === 'AbortError') {
    return true;
  }

  const normalizedMessage = error.message.trim().toLowerCase();
  return (
    normalizedMessage.includes('networkerror') ||
    normalizedMessage.includes('failed to fetch')
  );
}

function waitForRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 200 * attempt);
  });
}

export function mergeLibraryItem(
  previousItem: DownloadedContentMeta | undefined,
  task: DownloadTask,
  ownerUsername: string,
  playbackManifestUrl: string,
  rootManifestUrl: string,
  resourceCount: number,
  episodeSizeBytes: number
): DownloadedContentMeta {
  const episodeTitles = previousItem?.episodeTitles?.length
    ? [...previousItem.episodeTitles]
    : [];
  episodeTitles[task.episodeIndex] = task.episodeTitle;

  const nextEpisodes = [
    ...(previousItem?.episodes || []).filter(
      (episode) => episode.episodeIndex !== task.episodeIndex
    ),
    {
      episodeIndex: task.episodeIndex,
      episodeTitle: task.episodeTitle,
      rootManifestUrl,
      playbackManifestUrl,
      cacheIndexId: task.cacheIndexId,
      resourceCount,
      sizeBytes: episodeSizeBytes,
      downloadedAt: now(),
    },
  ].sort((left, right) => left.episodeIndex - right.episodeIndex);

  const totalSizeBytes = nextEpisodes.reduce(
    (sum, episode) => sum + episode.sizeBytes,
    0
  );

  return {
    contentId: task.contentId,
    source: task.source,
    vodId: task.vodId,
    sourceName: pickPreferredTextValue(task.sourceName, previousItem?.sourceName),
    title: pickPreferredTextValue(task.title, previousItem?.title),
    poster: pickPreferredTextValue(task.poster, previousItem?.poster),
    year: pickPreferredTextValue(task.year, previousItem?.year),
    desc: pickPreferredOptionalTextValue(task.desc, previousItem?.desc),
    typeName: pickPreferredOptionalTextValue(
      task.typeName,
      previousItem?.typeName
    ),
    doubanId: pickPreferredDoubanId(task.doubanId, previousItem?.doubanId),
    episodeTitles,
    ownerUsername,
    episodes: nextEpisodes,
    totalSizeBytes,
    updatedAt: now(),
  };
}

class DownloadManager {
  private runners = new Map<string, TaskRunnerState>();

  private resourceCleanupJobs = new Map<string, Promise<void>>();

  private getMaxActiveTaskCount(): number {
    return normalizeConcurrentDownloadTasks(
      useDownloadStore.getState().maxConcurrentTasks
    );
  }

  private getResourceCleanupJob(cacheIndexId: string): Promise<void> | null {
    return this.resourceCleanupJobs.get(cacheIndexId) || null;
  }

  private async waitForTaskCleanup(taskId: string): Promise<void> {
    const cleanupJob = this.getResourceCleanupJob(
      buildDownloadCacheIndexId(taskId)
    );
    if (cleanupJob) {
      await cleanupJob;
    }
  }

  private schedulePendingTasks(): void {
    const runningRunnerCount = Array.from(this.runners.values()).filter(
      (runner) => runner.mode === 'running'
    ).length;
    const availableSlots = this.getMaxActiveTaskCount() - runningRunnerCount;
    if (availableSlots <= 0) {
      return;
    }

    const pendingTasks = Object.values(useDownloadStore.getState().tasks)
      .filter((task) => task.status === 'queued' && !this.runners.has(task.id))
      .sort((left, right) => {
        if (left.createdAt !== right.createdAt) {
          return left.createdAt - right.createdAt;
        }

        if (left.title !== right.title) {
          return left.title.localeCompare(right.title, 'zh-CN');
        }

        return left.episodeIndex - right.episodeIndex;
      })
      .slice(0, availableSlots);

    pendingTasks.forEach((task) => {
      void this.runTask(task.id);
    });
  }

  private ensureSupport(): void {
    const supportState = getOfflineDownloadSupportState();
    if (!supportState.supported) {
      throw new Error(supportState.reason || '当前环境不支持离线下载');
    }
  }

  private ensureOwner(): string {
    const ownerUsername = getCurrentOwnerUsername();
    const { ownerUsername: storeOwner, setOwnerUsername } =
      useDownloadStore.getState();

    if (!storeOwner) {
      setOwnerUsername(ownerUsername);
      return ownerUsername;
    }

    if (storeOwner !== ownerUsername) {
      throw new Error('检测到登录用户已变化，请刷新页面后重试');
    }

    return ownerUsername;
  }

  private getTask(taskId: string): DownloadTask | undefined {
    return useDownloadStore.getState().tasks[taskId];
  }

  private setTaskStatus(
    taskId: string,
    status: DownloadTaskStatus,
    extra: Partial<DownloadTask> = {}
  ): void {
    patchTask(taskId, (task) => ({
      ...task,
      ...(status === 'downloading'
        ? {}
        : {
            currentSizeBytes:
              typeof extra.currentSizeBytes === 'number'
                ? extra.currentSizeBytes
                : typeof extra.sizeBytes === 'number'
                ? extra.sizeBytes
                : task.sizeBytes,
            downloadSpeedBytesPerSecond:
              typeof extra.downloadSpeedBytesPerSecond === 'number'
                ? extra.downloadSpeedBytesPerSecond
                : 0,
          }),
      ...extra,
      status,
      updatedAt: now(),
    }));
  }

  private async ensureStoragePersistence(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.storage) {
      return;
    }

    try {
      await navigator.storage.persist?.();
      await navigator.storage.estimate?.();
    } catch (error) {
      // 忽略浏览器不支持或拒绝持久化的情况
    }
  }

  private async updateResourceIndex(
    task: DownloadTask,
    urls: string[]
  ): Promise<void> {
    const ownerUsername = this.ensureOwner();
    const timestamp = now();

    await putResourceIndex({
      id: task.cacheIndexId,
      ownerUsername,
      taskId: task.id,
      contentId: task.contentId,
      source: task.source,
      vodId: task.vodId,
      episodeIndex: task.episodeIndex,
      urls,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private async resolveManifestCandidateUrls(
    task: DownloadTask
  ): Promise<string[]> {
    const currentCandidates = mergeManifestCandidateUrls(
      task.manifestCandidateUrls || [],
      task.entryManifestUrl ? [task.entryManifestUrl] : []
    );

    if (currentCandidates.length > 1 || !task.title.trim()) {
      return currentCandidates;
    }

    try {
      const fallbackSources = await searchPlaybackSources({
        title: task.title,
        year: task.year,
        doubanId: task.doubanId,
      });

      return mergeManifestCandidateUrls(
        currentCandidates,
        collectDownloadManifestCandidateUrls(
          fallbackSources,
          task.episodeIndex
        )
      );
    } catch (error) {
      return currentCandidates;
    }
  }

  private stopRunner(taskId: string): void {
    const runner = this.runners.get(taskId);
    if (!runner) {
      return;
    }

    runner.controllers.forEach((controller) => controller.abort());
    runner.controllers.clear();
    this.runners.delete(taskId);
  }

  private async cleanupCacheIndex(cacheIndexId: string): Promise<void> {
    const resourceIndex = await getResourceIndex(cacheIndexId);
    if (!resourceIndex) {
      return;
    }

    if (resourceIndex.urls.length) {
      await deleteCachedDownloads(resourceIndex.urls);
    }

    const latestResourceIndex = await getResourceIndex(cacheIndexId);
    if (
      latestResourceIndex &&
      (latestResourceIndex.createdAt !== resourceIndex.createdAt ||
        latestResourceIndex.updatedAt !== resourceIndex.updatedAt)
    ) {
      return;
    }

    await deleteResourceIndex(cacheIndexId);
  }

  private ensureCleanupJob(cacheIndexId: string): Promise<void> {
    const existingJob = this.getResourceCleanupJob(cacheIndexId);
    if (existingJob) {
      return existingJob;
    }

    const cleanupJob = this.cleanupCacheIndex(cacheIndexId).finally(() => {
      if (this.resourceCleanupJobs.get(cacheIndexId) === cleanupJob) {
        this.resourceCleanupJobs.delete(cacheIndexId);
      }
    });

    this.resourceCleanupJobs.set(cacheIndexId, cleanupJob);
    return cleanupJob;
  }

  private queueCacheCleanup(cacheIndexId: string): void {
    void this.ensureCleanupJob(cacheIndexId).catch(() => undefined);
  }

  private async removeTaskResources(
    task: Pick<DownloadTask, 'cacheIndexId'>
  ): Promise<void> {
    await this.ensureCleanupJob(task.cacheIndexId);
  }

  private removeTaskResourcesInBackground(
    task: Pick<DownloadTask, 'cacheIndexId'>
  ): void {
    this.queueCacheCleanup(task.cacheIndexId);
  }

  private async finalizeTask(taskId: string): Promise<void> {
    this.runners.delete(taskId);
  }

  private abortOtherControllers(
    runner: TaskRunnerState,
    currentController?: AbortController
  ): void {
    runner.controllers.forEach((controller) => {
      if (controller === currentController) {
        return;
      }

      controller.abort();
    });
  }

  private queueEpisodeDownload(
    params: StartEpisodeDownloadParams
  ): QueueEpisodeDownloadResult {
    this.ensureSupport();
    const ownerUsername = this.ensureOwner();
    const task = buildInitialTask(
      params.detail,
      params.episodeIndex,
      params.availableSources
    );
    const existingLibraryItem =
      useDownloadStore.getState().library[task.contentId];
    const nextTask = applyLibraryMetadataFallback(task, existingLibraryItem);

    if (!nextTask.entryManifestUrl) {
      throw new Error('当前剧集缺少可下载的播放地址');
    }

    const existingTask = this.getTask(nextTask.id);

    if (
      existingTask?.status === 'done' ||
      existingLibraryItem?.episodes.some(
        (episode) => episode.episodeIndex === params.episodeIndex
      )
    ) {
      return {
        task: existingTask || nextTask,
        queued: false,
      };
    }

    if (
      existingTask &&
      ['downloading', 'queued'].includes(existingTask.status)
    ) {
      const mergedManifestCandidateUrls = mergeManifestCandidateUrls(
        existingTask.manifestCandidateUrls || [existingTask.entryManifestUrl],
        task.manifestCandidateUrls || [task.entryManifestUrl]
      );

      if (
        mergedManifestCandidateUrls.length !==
        (existingTask.manifestCandidateUrls?.length || 0)
      ) {
        patchTask(existingTask.id, (currentTask) => ({
          ...currentTask,
          manifestCandidateUrls: mergedManifestCandidateUrls,
          updatedAt: now(),
        }));
      }

      return {
        task: existingTask,
        queued: false,
      };
    }

    useDownloadStore.getState().setOwnerUsername(ownerUsername);

    if (existingTask && ['paused', 'error'].includes(existingTask.status)) {
      this.setTaskStatus(existingTask.id, 'queued', {
        errorMessage: undefined,
        manifestCandidateUrls: mergeManifestCandidateUrls(
          existingTask.manifestCandidateUrls || [existingTask.entryManifestUrl],
          task.manifestCandidateUrls || [task.entryManifestUrl]
        ),
      });
      return {
        task: this.getTask(existingTask.id) || {
          ...existingTask,
          status: 'queued',
          errorMessage: undefined,
        },
        queued: true,
      };
    }

    upsertTask(nextTask);
    return {
      task: nextTask,
      queued: true,
    };
  }

  private async runTask(taskId: string): Promise<void> {
    const existingRunner = this.runners.get(taskId);
    if (existingRunner?.mode === 'running') {
      return;
    }

    const task = this.getTask(taskId);
    if (!task) {
      return;
    }

    const runner: TaskRunnerState = {
      mode: 'running',
      controllers: new Set(),
      task,
    };
    let latestCompletedSizeBytes = Math.max(task.sizeBytes, 0);
    const initialCurrentSizeBytes = Math.max(
      task.currentSizeBytes || task.sizeBytes,
      latestCompletedSizeBytes
    );
    let latestEstimatedTotalSizeBytes = Math.max(
      task.estimatedTotalSizeBytes || initialCurrentSizeBytes,
      initialCurrentSizeBytes
    );
    this.runners.set(taskId, runner);
    this.setTaskStatus(taskId, 'downloading', {
      errorMessage: undefined,
    });

    try {
      this.ensureSupport();
      const ownerUsername = this.ensureOwner();
      await this.ensureStoragePersistence();

      const createTrackedController = (): AbortController => {
        const controller = new AbortController();
        runner.controllers.add(controller);
        return controller;
      };
      const ensureRunnerActive = (): void => {
        if (runner.mode === 'running') {
          return;
        }

        if (runner.mode === 'failed' && runner.failureError) {
          throw runner.failureError;
        }

        throw new Error(
          runner.mode === 'paused'
            ? '下载已暂停'
            : runner.mode === 'cancelled'
            ? '下载已取消'
            : '下载已停止'
        );
      };

      const manifestCandidateUrls = await this.resolveManifestCandidateUrls(
        task
      );
      ensureRunnerActive();

      if (
        manifestCandidateUrls.length !==
          (task.manifestCandidateUrls?.length || 0) ||
        (manifestCandidateUrls[0] && manifestCandidateUrls[0] !== task.entryManifestUrl)
      ) {
        patchTask(taskId, (currentTask) => ({
          ...currentTask,
          entryManifestUrl:
            manifestCandidateUrls[0] || currentTask.entryManifestUrl,
          manifestCandidateUrls,
          updatedAt: now(),
        }));
      }

      const manifestController = createTrackedController();
      const manifestResult = await parseManifestForDownloadWithFallback(
        manifestCandidateUrls.length
          ? manifestCandidateUrls
          : [task.entryManifestUrl],
        {
          signal: manifestController.signal,
        }
      );
      runner.controllers.delete(manifestController);
      ensureRunnerActive();

      if (manifestResult.rootManifestUrl !== task.entryManifestUrl) {
        patchTask(taskId, (currentTask) => ({
          ...currentTask,
          entryManifestUrl: manifestResult.rootManifestUrl,
          manifestCandidateUrls: mergeManifestCandidateUrls(
            [manifestResult.rootManifestUrl],
            currentTask.manifestCandidateUrls || [currentTask.entryManifestUrl]
          ),
          updatedAt: now(),
        }));
      }

      await this.updateResourceIndex(task, manifestResult.resourceUrls);
      ensureRunnerActive();

      const totalResources = manifestResult.resources.length;
      const initialDownloadedResources = Math.min(
        Math.max(task.downloadedResources, 0),
        totalResources
      );
      let resolvedResources = 0;
      let completedSizeBytes = Math.max(task.sizeBytes, 0);
      let completedSizedResourcesCount = initialDownloadedResources;
      let smoothedSpeedBytesPerSecond = 0;
      let lastFlushedAt = 0;
      let lastFlushedDownloadedResources = -1;
      let lastFlushedCompletedSizeBytes = -1;
      let lastFlushedCurrentSizeBytes = -1;
      let lastFlushedEstimatedTotalSizeBytes = -1;
      let lastFlushedSpeedBytesPerSecond = -1;
      let lastSpeedSampleAt = now();
      let lastSpeedSampleBytes = completedSizeBytes;
      const activeTransfers = new Map<string, DownloadResourceTransferProgress>();

      const getCurrentSizeBytes = (): number => {
        let currentSizeBytes = completedSizeBytes;

        activeTransfers.forEach((transfer) => {
          currentSizeBytes += transfer.loadedBytes;
        });

        return currentSizeBytes;
      };

      const getEstimatedTotalSizeBytes = (
        downloadedResources: number,
        currentSizeBytes: number
      ): number => {
        if (totalResources <= 0) {
          return currentSizeBytes;
        }

        const averageCompletedResourceSize =
          completedSizedResourcesCount > 0
            ? completedSizeBytes / completedSizedResourcesCount
            : 0;
        let activeEstimatedSizeBytes = 0;

        activeTransfers.forEach((transfer) => {
          activeEstimatedSizeBytes +=
            transfer.totalBytes > 0
              ? transfer.totalBytes
              : Math.max(transfer.loadedBytes, averageCompletedResourceSize);
        });

        const pendingResourceCount = Math.max(
          0,
          totalResources - downloadedResources - activeTransfers.size
        );
        const estimatedTotalSizeBytes =
          completedSizeBytes +
          activeEstimatedSizeBytes +
          averageCompletedResourceSize * pendingResourceCount;

        return Math.max(currentSizeBytes, Math.round(estimatedTotalSizeBytes));
      };

      const flushProgress = (force = false): void => {
        const currentTimestamp = now();
        const downloadedResources = Math.min(
          totalResources,
          Math.max(initialDownloadedResources, resolvedResources)
        );
        const currentSizeBytes = getCurrentSizeBytes();
        const estimatedTotalSizeBytes = getEstimatedTotalSizeBytes(
          downloadedResources,
          currentSizeBytes
        );

        if (
          !force &&
          currentTimestamp - lastFlushedAt < PROGRESS_FLUSH_INTERVAL_MS &&
          downloadedResources === lastFlushedDownloadedResources &&
          completedSizeBytes === lastFlushedCompletedSizeBytes &&
          currentSizeBytes === lastFlushedCurrentSizeBytes &&
          estimatedTotalSizeBytes === lastFlushedEstimatedTotalSizeBytes
        ) {
          return;
        }

        const speedSampleElapsed = currentTimestamp - lastSpeedSampleAt;
        if (speedSampleElapsed > 0) {
          const transferredSizeDelta = Math.max(
            0,
            currentSizeBytes - lastSpeedSampleBytes
          );

          if (
            transferredSizeDelta > 0 &&
            (force || speedSampleElapsed >= PROGRESS_FLUSH_INTERVAL_MS)
          ) {
            const instantSpeedBytesPerSecond =
              (transferredSizeDelta * 1000) / speedSampleElapsed;
            smoothedSpeedBytesPerSecond =
              smoothedSpeedBytesPerSecond > 0
                ? smoothedSpeedBytesPerSecond * 0.45 +
                  instantSpeedBytesPerSecond * 0.55
                : instantSpeedBytesPerSecond;
            lastSpeedSampleAt = currentTimestamp;
            lastSpeedSampleBytes = currentSizeBytes;
          } else if (force || speedSampleElapsed >= PROGRESS_FLUSH_INTERVAL_MS) {
            smoothedSpeedBytesPerSecond =
              activeTransfers.size > 0
                ? smoothedSpeedBytesPerSecond * 0.75
                : 0;
            lastSpeedSampleAt = currentTimestamp;
            lastSpeedSampleBytes = currentSizeBytes;
          }
        }

        const roundedSpeedBytesPerSecond = Math.max(
          0,
          Math.round(smoothedSpeedBytesPerSecond)
        );

        if (
          !force &&
          downloadedResources === lastFlushedDownloadedResources &&
          completedSizeBytes === lastFlushedCompletedSizeBytes &&
          currentSizeBytes === lastFlushedCurrentSizeBytes &&
          estimatedTotalSizeBytes === lastFlushedEstimatedTotalSizeBytes &&
          roundedSpeedBytesPerSecond === lastFlushedSpeedBytesPerSecond
        ) {
          return;
        }

        lastFlushedAt = currentTimestamp;
        lastFlushedDownloadedResources = downloadedResources;
        lastFlushedCompletedSizeBytes = completedSizeBytes;
        lastFlushedCurrentSizeBytes = currentSizeBytes;
        lastFlushedEstimatedTotalSizeBytes = estimatedTotalSizeBytes;
        lastFlushedSpeedBytesPerSecond = roundedSpeedBytesPerSecond;
        latestCompletedSizeBytes = completedSizeBytes;
        latestEstimatedTotalSizeBytes = estimatedTotalSizeBytes;

        patchTask(taskId, (currentTask) => ({
          ...currentTask,
          playbackManifestUrl: manifestResult.playbackManifestUrl,
          totalResources,
          downloadedResources,
          sizeBytes: completedSizeBytes,
          currentSizeBytes,
          estimatedTotalSizeBytes,
          downloadSpeedBytesPerSecond: roundedSpeedBytesPerSecond,
          progress: calculateProgress(downloadedResources, totalResources),
          updatedAt: currentTimestamp,
        }));
      };

      flushProgress(true);

      let cursor = 0;

      const work = async () => {
        while (cursor < manifestResult.resources.length) {
          ensureRunnerActive();

          const resource = manifestResult.resources[cursor];
          cursor += 1;

          const isCached = await hasCachedDownload(resource.url);
          ensureRunnerActive();

          if (isCached) {
            resolvedResources += 1;
            if (
              resolvedResources === totalResources ||
              resolvedResources % 25 === 0
            ) {
              flushProgress();
            }
            continue;
          }

          let resourceSize = 0;

          for (
            let attempt = 1;
            attempt <= MAX_RESOURCE_DOWNLOAD_RETRIES + 1;
            attempt += 1
          ) {
            const controller = createTrackedController();

            try {
              const resourceResult = await downloadAndCacheUrl(
                resource.url,
                controller,
                (transferProgress) => {
                  activeTransfers.set(resource.url, transferProgress);
                  flushProgress();
                }
              );
              resourceSize = resourceResult.sizeBytes;
              break;
            } catch (error) {
              if (activeTransfers.delete(resource.url)) {
                flushProgress(true);
              }

              if (controller.signal.aborted && runner.mode !== 'running') {
                ensureRunnerActive();
              }

              const shouldRetry =
                runner.mode === 'running' &&
                attempt <= MAX_RESOURCE_DOWNLOAD_RETRIES &&
                isRetryableDownloadError(error);

              if (shouldRetry) {
                await waitForRetry(attempt);
                continue;
              }

              if (runner.mode === 'running') {
                runner.mode = 'failed';
                runner.failureError =
                  error instanceof Error
                    ? error
                    : new Error('下载失败，请稍后重试');
                this.abortOtherControllers(runner, controller);
              }

              throw runner.failureError || error;
            } finally {
              runner.controllers.delete(controller);
            }
          }

          ensureRunnerActive();

          resolvedResources += 1;
          completedSizeBytes += resourceSize;
          completedSizedResourcesCount += 1;
          activeTransfers.delete(resource.url);
          flushProgress(true);
        }
      };

      await Promise.all(
        Array.from({ length: RESOURCE_DOWNLOAD_WORKER_COUNT }, () => work())
      );

      if (runner.mode !== 'running') {
        return;
      }

      flushProgress(true);

      const latestTask = this.getTask(taskId);
      if (!latestTask) {
        return;
      }

      const { library, upsertLibraryItem } = useDownloadStore.getState();
      const nextLibraryItem = mergeLibraryItem(
        library[latestTask.contentId],
        latestTask,
        ownerUsername,
        manifestResult.playbackManifestUrl,
        manifestResult.rootManifestUrl,
        manifestResult.resources.length,
        completedSizeBytes
      );

      upsertLibraryItem(nextLibraryItem);

      this.setTaskStatus(taskId, 'done', {
        playbackManifestUrl: manifestResult.playbackManifestUrl,
        totalResources: manifestResult.resources.length,
        downloadedResources: manifestResult.resources.length,
        progress: 100,
        sizeBytes: completedSizeBytes,
        currentSizeBytes: completedSizeBytes,
        estimatedTotalSizeBytes: completedSizeBytes,
        downloadSpeedBytesPerSecond: 0,
        errorMessage: undefined,
      });
    } catch (error) {
      const runnerState = this.runners.get(taskId);
      const currentTask = this.getTask(taskId);
      const taskForCleanup = currentTask || runnerState?.task || task;
      const taskError = runnerState?.failureError || error;

      if (!currentTask && runnerState?.mode !== 'cancelled') {
        await this.finalizeTask(taskId);
        return;
      }

      if (runnerState?.mode === 'paused') {
        if (currentTask?.status === 'paused') {
          this.setTaskStatus(taskId, 'paused', {
            sizeBytes: latestCompletedSizeBytes,
            currentSizeBytes: latestCompletedSizeBytes,
            estimatedTotalSizeBytes: Math.max(
              latestEstimatedTotalSizeBytes,
              latestCompletedSizeBytes
            ),
            downloadSpeedBytesPerSecond: 0,
            errorMessage: undefined,
          });
        }
      } else if (runnerState?.mode === 'cancelled') {
        await this.removeTaskResources(taskForCleanup);
        if (
          !currentTask ||
          currentTask.createdAt === taskForCleanup.createdAt
        ) {
          useDownloadStore.getState().removeTask(taskId);
        }
      } else {
        if (currentTask) {
          this.setTaskStatus(taskId, 'error', {
            sizeBytes: latestCompletedSizeBytes,
            currentSizeBytes: latestCompletedSizeBytes,
            estimatedTotalSizeBytes: Math.max(
              latestEstimatedTotalSizeBytes,
              latestCompletedSizeBytes
            ),
            downloadSpeedBytesPerSecond: 0,
            errorMessage:
              taskError instanceof Error
                ? taskError.message
                : '下载失败，请稍后重试',
          });
        }
      }
    } finally {
      await this.finalizeTask(taskId);
      this.schedulePendingTasks();
    }
  }

  async startEpisodeDownload(
    params: StartEpisodeDownloadParams
  ): Promise<DownloadTask> {
    const contentId = buildDownloadContentId(
      params.detail.source,
      params.detail.id
    );
    await this.waitForTaskCleanup(
      buildDownloadTaskId(contentId, params.episodeIndex)
    );
    const result = this.queueEpisodeDownload(params);
    this.schedulePendingTasks();
    return result.task;
  }

  async startBatchEpisodeDownloads(
    params: StartBatchEpisodeDownloadParams
  ): Promise<BatchDownloadResult> {
    const uniqueEpisodeIndexes = Array.from(
      new Set(
        params.episodeIndexes.filter(
          (episodeIndex) =>
            Number.isInteger(episodeIndex) &&
            episodeIndex >= 0 &&
            episodeIndex < params.detail.episodes.length
        )
      )
    ).sort((left, right) => left - right);

    const tasks: DownloadTask[] = [];
    let queuedCount = 0;
    let skippedCount = 0;
    const contentId = buildDownloadContentId(
      params.detail.source,
      params.detail.id
    );

    await Promise.all(
      uniqueEpisodeIndexes.map((episodeIndex) =>
        this.waitForTaskCleanup(buildDownloadTaskId(contentId, episodeIndex))
      )
    );

    uniqueEpisodeIndexes.forEach((episodeIndex) => {
      if (!params.detail.episodes[episodeIndex]) {
        skippedCount += 1;
        return;
      }

      try {
        const result = this.queueEpisodeDownload({
          detail: params.detail,
          episodeIndex,
          availableSources: params.availableSources,
        });
        tasks.push(result.task);
        if (result.queued) {
          queuedCount += 1;
        } else {
          skippedCount += 1;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === '当前剧集缺少可下载的播放地址'
        ) {
          skippedCount += 1;
          return;
        }

        throw error;
      }
    });

    this.schedulePendingTasks();

    return {
      queuedCount,
      skippedCount,
      tasks,
    };
  }

  async pauseTask(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (!task) {
      return;
    }

    const runner = this.runners.get(taskId);
    if (runner) {
      runner.mode = 'paused';
      runner.controllers.forEach((controller) => controller.abort());
    }

    this.setTaskStatus(taskId, 'paused', {
      errorMessage: undefined,
    });
    this.schedulePendingTasks();
  }

  async resumeTask(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (!task) {
      return;
    }

    if (task.status === 'done') {
      return;
    }

    this.setTaskStatus(taskId, 'queued', {
      errorMessage: undefined,
    });
    this.schedulePendingTasks();
  }

  refreshScheduling(): void {
    this.schedulePendingTasks();
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (!task) {
      return;
    }

    const runner = this.runners.get(taskId);
    if (runner) {
      runner.mode = 'cancelled';
      runner.controllers.forEach((controller) => controller.abort());
      useDownloadStore.getState().removeTask(taskId);
      this.schedulePendingTasks();
      return;
    }

    useDownloadStore.getState().removeTask(taskId);
    this.removeTaskResourcesInBackground(task);
    this.schedulePendingTasks();
  }

  async deleteEpisode(contentId: string, episodeIndex: number): Promise<void> {
    const taskId = buildDownloadTaskId(contentId, episodeIndex);
    const task = this.getTask(taskId);

    if (task && task.status !== 'done') {
      await this.cancelTask(taskId);
      return;
    }

    const { library, removeLibraryItem, removeTask, upsertLibraryItem } =
      useDownloadStore.getState();
    const content = library[contentId];
    if (!content) {
      removeTask(taskId);
      return;
    }

    const targetEpisode = content.episodes.find(
      (episode) => episode.episodeIndex === episodeIndex
    );
    const nextEpisodes = content.episodes.filter(
      (episode) => episode.episodeIndex !== episodeIndex
    );

    removeTask(taskId);

    if (targetEpisode) {
      this.removeTaskResourcesInBackground(targetEpisode);
    }

    if (nextEpisodes.length === 0) {
      removeLibraryItem(contentId);
      return;
    }

    upsertLibraryItem({
      ...content,
      episodes: nextEpisodes,
      totalSizeBytes: nextEpisodes.reduce(
        (sum, episode) => sum + episode.sizeBytes,
        0
      ),
      updatedAt: now(),
    });
  }

  abortAll(): void {
    Array.from(this.runners.keys()).forEach((taskId) => {
      this.stopRunner(taskId);
    });
  }
}

export const downloadManager = new DownloadManager();
