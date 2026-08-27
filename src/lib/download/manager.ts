import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { searchPlaybackSources } from '@/lib/playback-source-client';
import { SearchResult } from '@/lib/types';

import { useDownloadStore } from '@/stores/downloadStore';

import {
  deleteCachedDownloads,
  getCachedDownloadSizeBytes,
  getOfflineDownloadSupportState,
  hasCachedDownload,
  putDownloadResponse,
} from './cache';
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
import {
  applyLibraryMetadataFallback,
  mergeLibraryItem,
  pickPreferredOptionalTextValue,
} from './library';
import { parseManifestForDownloadWithFallback } from './manifest';
import { normalizeVodEpisodeUrlForDownload } from './normalize';
import {
  createMissingPlaybackSourceDownloadError,
  createTimeoutAbortSignal,
  DOWNLOAD_ERROR_CODE_MISSING_PLAYBACK_SOURCE,
  DownloadRequestError,
  isDownloadDomainErrorCode,
  isRetryableDownloadError,
  waitForRetry,
} from './request';
import {
  deleteResourceIndex,
  getResourceIndex,
  putResourceIndex,
} from './resource-index';
import {
  buildDownloadCacheIndexId,
  buildDownloadContentId,
  buildDownloadTaskId,
  DownloadTask,
  DownloadTaskStatus,
  normalizeConcurrentDownloadTasks,
} from './types';

interface StartEpisodeDownloadParams {
  detail: SearchResult;
  episodeIndex: number;
  availableSources?: SearchResult[];
  searchTitle?: string;
  searchType?: string;
}

interface StartBatchEpisodeDownloadParams {
  detail: SearchResult;
  episodeIndexes: number[];
  availableSources?: SearchResult[];
  searchTitle?: string;
  searchType?: string;
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
  restartedCount: number;
  skippedCount: number;
  tasks: DownloadTask[];
}

const RESOURCE_DOWNLOAD_WORKER_COUNT = 3;
const MAX_RESOURCE_DOWNLOAD_RETRIES = 2;
const RESOURCE_DOWNLOAD_TIMEOUT_MS = 45_000;
const RESOURCE_CACHE_LOOKUP_TIMEOUT_MS = 8_000;
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

function withOperationTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorFactory: () => Error
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(errorFactory());
    }, Math.max(1, timeoutMs));

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
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
  useDownloadStore.getState().patchTask(taskId, (task) => {
    if (!task) {
      return undefined;
    }

    return updater(task);
  });
}

function removeTask(taskId: string): void {
  useDownloadStore.getState().removeTask(taskId);
}

function applyDesktopDownloadEngineSnapshot(
  snapshot: Awaited<ReturnType<typeof upsertDesktopDownloadEngineTask>>
): void {
  useDownloadStore.getState().replaceRuntimeState(snapshot);
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

export async function resolveDownloadResourceCachedState(
  url: string,
  options: {
    timeoutMs?: number;
  } = {}
): Promise<boolean> {
  try {
    return await withOperationTimeout(
      hasCachedDownload(url),
      options.timeoutMs ?? RESOURCE_CACHE_LOOKUP_TIMEOUT_MS,
      () => new Error(`检查离线缓存超时: ${url}`)
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('检查离线缓存失败，按未缓存处理:', error);
    return false;
  }
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

function buildInitialTask(
  detail: SearchResult,
  episodeIndex: number,
  availableSources: SearchResult[] = [],
  searchTitle?: string,
  searchType?: string
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
    searchTitle: searchTitle?.trim() || undefined,
    searchType: searchType?.trim() || undefined,
    poster: detail.poster,
    remarks: detail.remarks?.trim() || undefined,
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

async function downloadAndCacheUrl(
  url: string,
  controller: AbortController,
  onProgress?: (progress: DownloadResourceTransferProgress) => void
): Promise<DownloadResourceTransferResult> {
  const timeoutSignal = createTimeoutAbortSignal({
    sourceSignal: controller.signal,
    timeoutMs: RESOURCE_DOWNLOAD_TIMEOUT_MS,
  });
  const useDesktopRuntimeFetch = isDesktopLocalDownloadRuntimeEnabled();

  try {
    const response = useDesktopRuntimeFetch
      ? await fetchDesktopDownloadCacheResponse(url, {
          signal: timeoutSignal.signal,
        })
      : await fetch(url, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: {
            [DOWNLOAD_REQUEST_INTENT_HEADER]:
              BACKGROUND_DOWNLOAD_REQUEST_INTENT,
          },
          signal: timeoutSignal.signal,
        });

    if (!response.ok) {
      throw new DownloadRequestError({
        message: `下载资源失败: ${response.status}`,
        kind: 'http',
        status: response.status,
        url,
      });
    }

    const contentLengthHeader = Number(
      response.headers.get('content-length') || 0
    );
    const totalBytes =
      Number.isFinite(contentLengthHeader) && contentLengthHeader > 0
        ? contentLengthHeader
        : 0;

    if (!response.body) {
      if (!useDesktopRuntimeFetch) {
        await putDownloadResponse(url, response.clone());
      }
      onProgress?.({
        loadedBytes: totalBytes,
        totalBytes,
      });
      return {
        sizeBytes: totalBytes,
        totalBytes,
      };
    }
    const responseBody = response.body;

    let cachePromise: Promise<void> | null = null;
    const progressStream = useDesktopRuntimeFetch
      ? responseBody
      : (() => {
          const [cacheStream, measureStream] = responseBody.tee();
          cachePromise = putDownloadResponse(
            url,
            new Response(cacheStream, {
              headers: new Headers(response.headers),
              status: response.status,
              statusText: response.statusText,
            })
          );
          return measureStream;
        })();
    const reader = progressStream.getReader();
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
    } catch (error) {
      if (timeoutSignal.didTimeout()) {
        throw new DownloadRequestError({
          message: `下载资源超时: ${url}`,
          kind: 'timeout',
          url,
          cause: error,
        });
      }

      throw error;
    } finally {
      reader.releaseLock();
    }

    const pendingCachePromise = cachePromise;

    if (pendingCachePromise) {
      await new Promise<void>((resolve, reject) => {
        const cacheTimeoutId = setTimeout(() => {
          reject(
            new DownloadRequestError({
              message: `写入离线缓存超时: ${url}`,
              kind: 'timeout',
              url,
            })
          );
        }, RESOURCE_DOWNLOAD_TIMEOUT_MS);

        pendingCachePromise.then(
          () => {
            clearTimeout(cacheTimeoutId);
            resolve();
          },
          (error) => {
            clearTimeout(cacheTimeoutId);
            reject(error);
          }
        );
      });
    }

    return {
      sizeBytes: loadedBytes,
      totalBytes: Math.max(totalBytes, loadedBytes),
    };
  } catch (error) {
    if (timeoutSignal.didTimeout()) {
      throw new DownloadRequestError({
        message: `下载资源超时: ${url}`,
        kind: 'timeout',
        url,
        cause: error,
      });
    }

    if (error instanceof DownloadRequestError || controller.signal.aborted) {
      throw error;
    }

    if (error instanceof TypeError) {
      throw new DownloadRequestError({
        message: `下载资源失败: ${url} (${error.message})`,
        kind: 'network',
        url,
        cause: error,
      });
    }

    throw error;
  } finally {
    timeoutSignal.cleanup();
  }
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
    if (isDesktopLocalDownloadRuntimeEnabled()) {
      return;
    }

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
        collectDownloadManifestCandidateUrls(fallbackSources, task.episodeIndex)
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
    void this.ensureCleanupJob(cacheIndexId).catch((error) => {
      // eslint-disable-next-line no-console
      console.error('清理离线下载缓存失败:', error);
    });
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

  private async queueEpisodeDownload(
    params: StartEpisodeDownloadParams
  ): Promise<QueueEpisodeDownloadResult> {
    this.ensureSupport();
    const ownerUsername = this.ensureOwner();
    const task = buildInitialTask(
      params.detail,
      params.episodeIndex,
      params.availableSources,
      params.searchTitle,
      params.searchType
    );
    const existingLibraryItem =
      useDownloadStore.getState().library[task.contentId];
    const nextTask = applyLibraryMetadataFallback(task, existingLibraryItem);

    if (!nextTask.entryManifestUrl) {
      throw createMissingPlaybackSourceDownloadError();
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
          (existingTask.manifestCandidateUrls?.length || 0) ||
        pickPreferredOptionalTextValue(
          existingTask.searchTitle,
          task.searchTitle
        ) !== existingTask.searchTitle ||
        pickPreferredOptionalTextValue(
          existingTask.searchType,
          task.searchType
        ) !== existingTask.searchType ||
        pickPreferredOptionalTextValue(existingTask.remarks, task.remarks) !==
          existingTask.remarks
      ) {
        const updatedTask: DownloadTask = {
          ...existingTask,
          manifestCandidateUrls: mergedManifestCandidateUrls,
          searchTitle: pickPreferredOptionalTextValue(
            existingTask.searchTitle,
            task.searchTitle
          ),
          searchType: pickPreferredOptionalTextValue(
            existingTask.searchType,
            task.searchType
          ),
          remarks: pickPreferredOptionalTextValue(
            existingTask.remarks,
            task.remarks
          ),
          updatedAt: now(),
        };

        if (isDesktopLocalDownloadRuntimeEnabled()) {
          const snapshot = await upsertDesktopDownloadEngineTask(updatedTask);
          applyDesktopDownloadEngineSnapshot(snapshot);
        } else {
          upsertTask(updatedTask);
        }
      }

      return {
        task: this.getTask(existingTask.id) || existingTask,
        queued: false,
      };
    }

    useDownloadStore.getState().setOwnerUsername(ownerUsername);

    if (existingTask && ['paused', 'error'].includes(existingTask.status)) {
      const requeuedTask: DownloadTask = {
        ...existingTask,
        status: 'queued',
        errorMessage: undefined,
        manifestCandidateUrls: mergeManifestCandidateUrls(
          existingTask.manifestCandidateUrls || [existingTask.entryManifestUrl],
          task.manifestCandidateUrls || [task.entryManifestUrl]
        ),
        searchTitle: pickPreferredOptionalTextValue(
          existingTask.searchTitle,
          task.searchTitle
        ),
        searchType: pickPreferredOptionalTextValue(
          existingTask.searchType,
          task.searchType
        ),
        remarks: pickPreferredOptionalTextValue(
          existingTask.remarks,
          task.remarks
        ),
        updatedAt: now(),
      };

      if (isDesktopLocalDownloadRuntimeEnabled()) {
        const snapshot = await upsertDesktopDownloadEngineTask(requeuedTask);
        applyDesktopDownloadEngineSnapshot(snapshot);
      } else {
        upsertTask(requeuedTask);
      }

      return {
        task: this.getTask(existingTask.id) || requeuedTask,
        queued: true,
      };
    }

    if (isDesktopLocalDownloadRuntimeEnabled()) {
      const snapshot = await upsertDesktopDownloadEngineTask(nextTask);
      applyDesktopDownloadEngineSnapshot(snapshot);
    } else {
      upsertTask(nextTask);
    }

    return {
      task: this.getTask(nextTask.id) || nextTask,
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
        (manifestCandidateUrls[0] &&
          manifestCandidateUrls[0] !== task.entryManifestUrl)
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
      const activeTransfers = new Map<
        string,
        DownloadResourceTransferProgress
      >();

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
          } else if (
            force ||
            speedSampleElapsed >= PROGRESS_FLUSH_INTERVAL_MS
          ) {
            smoothedSpeedBytesPerSecond =
              activeTransfers.size > 0 ? smoothedSpeedBytesPerSecond * 0.75 : 0;
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

          const isCached = await resolveDownloadResourceCachedState(
            resource.url
          );
          ensureRunnerActive();

          if (isCached) {
            const cachedSizeBytes = await getCachedDownloadSizeBytes(
              resource.url
            ).catch(() => 0);
            resolvedResources += 1;
            if (cachedSizeBytes > 0) {
              completedSizeBytes += cachedSizeBytes;
              completedSizedResourcesCount += 1;
            }
            if (
              resolvedResources === totalResources ||
              resolvedResources % 25 === 0
            ) {
              flushProgress(true);
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
          removeTask(taskId);
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
    const result = await this.queueEpisodeDownload(params);
    this.schedulePendingTasks();
    return result.task;
  }

  async startBatchEpisodeDownloads(
    params: StartBatchEpisodeDownloadParams
  ): Promise<BatchDownloadResult> {
    return this.queueBatchEpisodeDownloads(params, {
      restartDownloadedEpisodes: false,
    });
  }

  async restartBatchEpisodeDownloads(
    params: StartBatchEpisodeDownloadParams
  ): Promise<BatchDownloadResult> {
    return this.queueBatchEpisodeDownloads(params, {
      restartDownloadedEpisodes: true,
    });
  }

  private async queueBatchEpisodeDownloads(
    params: StartBatchEpisodeDownloadParams,
    options: {
      restartDownloadedEpisodes: boolean;
    }
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
    let restartedCount = 0;
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

    for (const episodeIndex of uniqueEpisodeIndexes) {
      if (!params.detail.episodes[episodeIndex]) {
        skippedCount += 1;
        continue;
      }

      try {
        const libraryItem = useDownloadStore.getState().library[contentId];
        const existingTask = this.getTask(
          buildDownloadTaskId(contentId, episodeIndex)
        );
        const isDownloaded =
          existingTask?.status === 'done' ||
          libraryItem?.episodes.some(
            (episode) => episode.episodeIndex === episodeIndex
          );

        if (options.restartDownloadedEpisodes && isDownloaded) {
          await this.removeDownloadedEpisodeForRestart(contentId, episodeIndex);
          await this.waitForTaskCleanup(
            buildDownloadTaskId(contentId, episodeIndex)
          );
        }

        const result = await this.queueEpisodeDownload({
          detail: params.detail,
          episodeIndex,
          availableSources: params.availableSources,
          searchTitle: params.searchTitle,
          searchType: params.searchType,
        });
        tasks.push(result.task);
        if (result.queued) {
          if (options.restartDownloadedEpisodes && isDownloaded) {
            restartedCount += 1;
          } else {
            queuedCount += 1;
          }
        } else {
          skippedCount += 1;
        }
      } catch (error) {
        if (
          isDownloadDomainErrorCode(
            error,
            DOWNLOAD_ERROR_CODE_MISSING_PLAYBACK_SOURCE
          )
        ) {
          skippedCount += 1;
          continue;
        }

        throw error;
      }
    }

    this.schedulePendingTasks();

    return {
      queuedCount,
      restartedCount,
      skippedCount,
      tasks,
    };
  }

  private async removeDownloadedEpisodeForRestart(
    contentId: string,
    episodeIndex: number
  ): Promise<void> {
    const taskId = buildDownloadTaskId(contentId, episodeIndex);
    const task = this.getTask(taskId);

    if (task && task.status !== 'done') {
      await this.cancelTask(taskId);
      await this.waitForTaskCleanup(taskId);
      return;
    }

    const { library, removeLibraryItem, upsertLibraryItem } =
      useDownloadStore.getState();
    const content = library[contentId];

    if (!content) {
      if (isDesktopLocalDownloadRuntimeEnabled()) {
        const snapshot = await deleteMirroredDesktopDownloadTask(taskId);
        applyDesktopDownloadEngineSnapshot(snapshot);
      } else {
        removeTask(taskId);
      }
      return;
    }

    const targetEpisode = content.episodes.find(
      (episode) => episode.episodeIndex === episodeIndex
    );
    const nextEpisodes = content.episodes.filter(
      (episode) => episode.episodeIndex !== episodeIndex
    );

    if (isDesktopLocalDownloadRuntimeEnabled()) {
      const snapshot = await deleteMirroredDesktopDownloadTask(taskId);
      applyDesktopDownloadEngineSnapshot(snapshot);
    } else {
      removeTask(taskId);
    }

    if (targetEpisode) {
      await this.removeTaskResources(targetEpisode);
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

  async pauseTask(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (!task) {
      return;
    }

    if (isDesktopLocalDownloadRuntimeEnabled()) {
      const snapshot = await pauseDesktopDownloadEngineTask(taskId);
      applyDesktopDownloadEngineSnapshot(snapshot);
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

    if (isDesktopLocalDownloadRuntimeEnabled()) {
      const snapshot = await (task.status === 'error'
        ? retryDesktopDownloadEngineTask(taskId)
        : resumeDesktopDownloadEngineTask(taskId));
      applyDesktopDownloadEngineSnapshot(snapshot);
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

  async pauseAllTasks(): Promise<void> {
    const candidateTaskIds = Object.values(useDownloadStore.getState().tasks)
      .filter((task) => ['queued', 'downloading'].includes(task.status))
      .map((task) => task.id);

    if (candidateTaskIds.length === 0) {
      return;
    }

    if (!isDesktopLocalDownloadRuntimeEnabled()) {
      await Promise.all(
        candidateTaskIds.map((taskId) => this.pauseTask(taskId))
      );
      return;
    }

    const snapshot = await postDesktopDownloadEngineTaskBulkCommand(
      'pause',
      candidateTaskIds
    );
    applyDesktopDownloadEngineSnapshot(snapshot);
  }

  async resumeAllTasks(): Promise<void> {
    const candidateTasks = Object.values(
      useDownloadStore.getState().tasks
    ).filter((task) => ['paused', 'error'].includes(task.status));

    if (candidateTasks.length === 0) {
      return;
    }

    if (!isDesktopLocalDownloadRuntimeEnabled()) {
      await Promise.all(candidateTasks.map((task) => this.resumeTask(task.id)));
      return;
    }

    const pausedTaskIds: string[] = [];
    const errorTaskIds: string[] = [];

    candidateTasks.forEach((task) => {
      if (task.status === 'error') {
        errorTaskIds.push(task.id);
      } else {
        pausedTaskIds.push(task.id);
      }
    });

    if (pausedTaskIds.length > 0) {
      const snapshot = await postDesktopDownloadEngineTaskBulkCommand(
        'resume',
        pausedTaskIds
      );
      applyDesktopDownloadEngineSnapshot(snapshot);
    }

    if (errorTaskIds.length > 0) {
      const snapshot = await postDesktopDownloadEngineTaskBulkCommand(
        'retry',
        errorTaskIds
      );
      applyDesktopDownloadEngineSnapshot(snapshot);
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (!task) {
      return;
    }

    if (isDesktopLocalDownloadRuntimeEnabled()) {
      const snapshot = await cancelDesktopDownloadEngineTask(taskId);
      applyDesktopDownloadEngineSnapshot(snapshot);
      this.removeTaskResourcesInBackground(task);
      return;
    }

    const runner = this.runners.get(taskId);
    if (runner) {
      runner.mode = 'cancelled';
      runner.controllers.forEach((controller) => controller.abort());
      removeTask(taskId);
      this.schedulePendingTasks();
      return;
    }

    removeTask(taskId);
    this.removeTaskResourcesInBackground(task);
    this.schedulePendingTasks();
  }

  async cancelAllTasks(): Promise<void> {
    const candidateTasks = Object.values(
      useDownloadStore.getState().tasks
    ).filter((task) => task.status !== 'done');

    if (candidateTasks.length === 0) {
      return;
    }

    if (!isDesktopLocalDownloadRuntimeEnabled()) {
      for (const taskId of candidateTasks.map((task) => task.id)) {
        await this.cancelTask(taskId);
      }
      return;
    }

    const snapshot = await postDesktopDownloadEngineTaskBulkCommand(
      'cancel',
      candidateTasks.map((task) => task.id)
    );
    applyDesktopDownloadEngineSnapshot(snapshot);
    candidateTasks.forEach((task) => {
      this.removeTaskResourcesInBackground(task);
    });
  }

  async deleteEpisode(contentId: string, episodeIndex: number): Promise<void> {
    const taskId = buildDownloadTaskId(contentId, episodeIndex);
    const task = this.getTask(taskId);

    if (task && task.status !== 'done') {
      await this.cancelTask(taskId);
      return;
    }

    const { library, removeLibraryItem, upsertLibraryItem } =
      useDownloadStore.getState();
    const content = library[contentId];
    if (!content) {
      if (isDesktopLocalDownloadRuntimeEnabled()) {
        const snapshot = await deleteMirroredDesktopDownloadTask(taskId);
        applyDesktopDownloadEngineSnapshot(snapshot);
      } else {
        removeTask(taskId);
      }
      return;
    }

    const targetEpisode = content.episodes.find(
      (episode) => episode.episodeIndex === episodeIndex
    );
    const nextEpisodes = content.episodes.filter(
      (episode) => episode.episodeIndex !== episodeIndex
    );

    if (isDesktopLocalDownloadRuntimeEnabled()) {
      const snapshot = await deleteMirroredDesktopDownloadTask(taskId);
      applyDesktopDownloadEngineSnapshot(snapshot);
    } else {
      removeTask(taskId);
    }

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
