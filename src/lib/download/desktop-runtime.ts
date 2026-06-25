import { getRuntimeConfig } from '@/lib/runtime-config';
import { buildApiUrl } from '@/lib/transport/endpoint';

import {
  DownloadTask,
  ManifestParseResult,
  ResourceIndexRecord,
} from './types';

interface DesktopDownloadCacheMetaResponse {
  exists: boolean;
  url: string;
  status?: number;
  contentType?: string;
  sizeBytes?: number;
}

export interface DesktopDownloadRuntimeStorageInfoResponse {
  runtimeKind: 'desktop-local';
  rootDir: string;
  cacheBodyDir: string;
  cacheMetaDir: string;
  resourceIndexDir: string;
  sqlitePath: string;
}

export interface DesktopDownloadEngineSettingsUpdate {
  maxConcurrentTasks: number;
}

export type DesktopDownloadEngineCommand =
  | 'pause'
  | 'resume'
  | 'retry'
  | 'cancel'
  | 'delete';

export type DesktopDownloadEngineBulkCommand = Exclude<
  DesktopDownloadEngineCommand,
  'delete'
>;

export type DesktopDownloadTaskRemovedReason = 'cancelled' | 'deleted';

export type DesktopDownloadEngineEvent =
  | {
      type: 'taskUpserted';
      taskId: string;
      status: DownloadTask['status'];
    }
  | {
      type: 'taskStatusChanged';
      taskId: string;
      status: DownloadTask['status'];
      command: DesktopDownloadEngineCommand;
    }
  | {
      type: 'taskRemoved';
      taskId: string;
      reason: DesktopDownloadTaskRemovedReason;
    }
  | {
      type: 'maxConcurrentTasksChanged';
      maxConcurrentTasks: number;
    };

export interface DesktopDownloadEngineSnapshot {
  maxConcurrentTasks: number;
  tasks: Record<string, DownloadTask>;
  lastEvent?: DesktopDownloadEngineEvent | null;
}

export interface DesktopDownloadEngineSnapshotSubscriptionOptions {
  onSnapshot: (snapshot: DesktopDownloadEngineSnapshot) => void;
  onError?: (error: Error) => void;
}

const DESKTOP_DOWNLOAD_RUNTIME_POLL_INTERVAL_MS = 2_000;

function ensureDesktopLocalDownloadRuntime(): void {
  if (!isDesktopLocalDownloadRuntimeEnabled()) {
    throw new Error(
      'Desktop local download runtime is unavailable in the current build.'
    );
  }
}

function isDesktopLocalDownloadRuntimeBuildEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DESKTOP_LOCAL_DOWNLOAD_RUNTIME === 'true';
}

function buildDesktopDownloadRuntimeUrl(
  path: string,
  searchParams?: Record<string, string>
): string {
  return buildApiUrl(`/download-runtime${path}`, searchParams);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = `Desktop download runtime request failed: ${response.status}`;

    try {
      const payload = (await response.clone().json()) as {
        error?: string;
      };
      if (typeof payload.error === 'string' && payload.error.trim()) {
        errorMessage = payload.error.trim();
      }
    } catch {
      try {
        const fallbackText = (await response.text()).trim();
        if (fallbackText) {
          errorMessage = fallbackText;
        }
      } catch {
        // Ignore secondary parsing failures and keep the status fallback.
      }
    }

    throw new Error(errorMessage);
  }

  return response.json() as Promise<T>;
}

export function isDesktopLocalDownloadRuntimeEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const runtimeConfig = getRuntimeConfig();
  return Boolean(
    isDesktopLocalDownloadRuntimeBuildEnabled() &&
      runtimeConfig.APP_TARGET === 'desktop' &&
      runtimeConfig.API_BASE_URL?.trim()
  );
}

export function getDesktopDownloadRuntimeLabel(): string {
  return isDesktopLocalDownloadRuntimeEnabled()
    ? '桌面本地下载运行时'
    : '浏览器离线缓存';
}

export async function getDesktopDownloadRuntimeStorageInfo(): Promise<DesktopDownloadRuntimeStorageInfoResponse> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl('/storage-info'),
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  return parseJsonResponse<DesktopDownloadRuntimeStorageInfoResponse>(response);
}

export async function putDesktopDownloadCacheEntry(
  url: string,
  response: Response
): Promise<void> {
  ensureDesktopLocalDownloadRuntime();
  const body = await response.arrayBuffer();

  const uploadResponse = await fetch(
    buildDesktopDownloadRuntimeUrl('/cache', {
      url,
    }),
    {
      method: 'PUT',
      headers: {
        'Content-Type':
          response.headers.get('content-type') || 'application/octet-stream',
        'X-MoonTV-Response-Status': String(response.status),
      },
      body,
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  await parseJsonResponse(uploadResponse);
}

export async function getDesktopDownloadCacheMeta(
  url: string
): Promise<DesktopDownloadCacheMetaResponse> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl('/cache/meta', {
      url,
    }),
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  return parseJsonResponse<DesktopDownloadCacheMetaResponse>(response);
}

export async function getDesktopDownloadCachedResponse(
  url: string
): Promise<Response | undefined> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl('/cache/response', {
      url,
    }),
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(
      `Desktop download runtime request failed: ${response.status}`
    );
  }

  return response;
}

export async function fetchDesktopDownloadCacheResponse(
  url: string,
  options: {
    signal?: AbortSignal;
  } = {}
): Promise<Response> {
  ensureDesktopLocalDownloadRuntime();
  return fetch(
    buildDesktopDownloadRuntimeUrl('/cache/fetch', {
      url,
    }),
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: options.signal,
    }
  );
}

export async function deleteDesktopDownloadCacheEntry(
  url: string
): Promise<boolean> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl('/cache/delete', {
      url,
    }),
    {
      method: 'DELETE',
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  const payload = (await parseJsonResponse(response)) as {
    deleted?: boolean;
  };
  return Boolean(payload.deleted);
}

export async function clearDesktopDownloadCache(): Promise<void> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(buildDesktopDownloadRuntimeUrl('/cache/all'), {
    method: 'DELETE',
    cache: 'no-store',
    credentials: 'omit',
  });

  await parseJsonResponse(response);
}

export async function putDesktopResourceIndex(
  record: ResourceIndexRecord
): Promise<void> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl('/resource-index'),
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(record),
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  await parseJsonResponse(response);
}

export async function getDesktopResourceIndex(
  id: string
): Promise<ResourceIndexRecord | null> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl('/resource-index', {
      id,
    }),
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  return parseJsonResponse<ResourceIndexRecord | null>(response);
}

export async function deleteDesktopResourceIndex(id: string): Promise<void> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl('/resource-index', {
      id,
    }),
    {
      method: 'DELETE',
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  await parseJsonResponse(response);
}

export async function clearDesktopResourceIndexes(): Promise<void> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl('/resource-index/all'),
    {
      method: 'DELETE',
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  await parseJsonResponse(response);
}

export async function getDesktopDownloadStoreSnapshot<T>(): Promise<T | null> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(buildDesktopDownloadRuntimeUrl('/store'), {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
  });

  return parseJsonResponse<T | null>(response);
}

export async function putDesktopDownloadStoreSnapshot(
  snapshot: unknown
): Promise<void> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(buildDesktopDownloadRuntimeUrl('/store'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(snapshot),
    cache: 'no-store',
    credentials: 'omit',
  });

  await parseJsonResponse(response);
}

export async function clearDesktopDownloadStoreSnapshot(): Promise<void> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(buildDesktopDownloadRuntimeUrl('/store'), {
    method: 'DELETE',
    cache: 'no-store',
    credentials: 'omit',
  });

  await parseJsonResponse(response);
}

export async function resolveDesktopDownloadManifest(
  entryManifestUrls: string[],
  options: {
    signal?: AbortSignal;
  } = {}
): Promise<ManifestParseResult> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl('/manifest/resolve'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entryManifestUrls,
      }),
      cache: 'no-store',
      credentials: 'omit',
      signal: options.signal,
    }
  );

  return parseJsonResponse<ManifestParseResult>(response);
}

export async function getDesktopDownloadEngineSnapshot(): Promise<DesktopDownloadEngineSnapshot> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(buildDesktopDownloadRuntimeUrl('/tasks'), {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
  });

  return parseJsonResponse<DesktopDownloadEngineSnapshot>(response);
}

export async function getDesktopDownloadEngineTask(
  taskId: string
): Promise<DownloadTask | undefined> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl(`/tasks/${encodeURIComponent(taskId)}`),
    {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  if (response.status === 404) {
    return undefined;
  }

  return parseJsonResponse<DownloadTask>(response);
}

export async function clearDesktopDownloadEngineTasks(): Promise<DesktopDownloadEngineSnapshot> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(buildDesktopDownloadRuntimeUrl('/tasks'), {
    method: 'DELETE',
    cache: 'no-store',
    credentials: 'omit',
  });

  return parseJsonResponse<DesktopDownloadEngineSnapshot>(response);
}

async function postDesktopDownloadTaskCommand(
  taskId: string,
  command: DesktopDownloadEngineBulkCommand
): Promise<DesktopDownloadEngineSnapshot> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl(
      `/tasks/${encodeURIComponent(taskId)}/${command}`
    ),
    {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  return parseJsonResponse<DesktopDownloadEngineSnapshot>(response);
}

function subscribeToDesktopDownloadEngineSnapshotsByPolling({
  onSnapshot,
  onError,
}: DesktopDownloadEngineSnapshotSubscriptionOptions): () => void {
  let active = true;
  let nextPollTimer: ReturnType<typeof setTimeout> | null = null;

  const clearNextPollTimer = () => {
    if (!nextPollTimer) {
      return;
    }

    clearTimeout(nextPollTimer);
    nextPollTimer = null;
  };

  const scheduleNextPoll = () => {
    clearNextPollTimer();
    if (!active) {
      return;
    }

    nextPollTimer = setTimeout(() => {
      void pollSnapshot();
    }, DESKTOP_DOWNLOAD_RUNTIME_POLL_INTERVAL_MS);
  };

  const pollSnapshot = async () => {
    try {
      const snapshot = await getDesktopDownloadEngineSnapshot();
      if (!active) {
        return;
      }

      onSnapshot(snapshot);
    } catch (error) {
      if (!active) {
        return;
      }

      onError?.(
        error instanceof Error
          ? error
          : new Error('Desktop download runtime snapshot polling failed.')
      );
    } finally {
      scheduleNextPoll();
    }
  };

  void pollSnapshot();

  return () => {
    active = false;
    clearNextPollTimer();
  };
}

export function subscribeToDesktopDownloadEngineSnapshots({
  onSnapshot,
  onError,
}: DesktopDownloadEngineSnapshotSubscriptionOptions): () => void {
  ensureDesktopLocalDownloadRuntime();

  if (typeof EventSource === 'undefined') {
    return subscribeToDesktopDownloadEngineSnapshotsByPolling({
      onSnapshot,
      onError,
    });
  }

  const eventSource = new EventSource(
    buildDesktopDownloadRuntimeUrl('/tasks/stream')
  );
  let unsubscribePolling: (() => void) | null = null;
  let active = true;

  const switchToPolling = (error: Error) => {
    if (!active || unsubscribePolling) {
      return;
    }

    active = false;
    eventSource.onmessage = null;
    eventSource.onerror = null;
    eventSource.close();
    onError?.(error);
    unsubscribePolling = subscribeToDesktopDownloadEngineSnapshotsByPolling({
      onSnapshot,
      onError,
    });
  };

  eventSource.onmessage = (event) => {
    if (!event.data) {
      return;
    }

    try {
      onSnapshot(JSON.parse(event.data) as DesktopDownloadEngineSnapshot);
    } catch (error) {
      onError?.(
        error instanceof Error
          ? error
          : new Error(
              'Failed to parse a desktop download runtime snapshot event.'
            )
      );
    }
  };

  eventSource.onerror = () => {
    switchToPolling(
      new Error('Desktop download runtime snapshot stream disconnected.')
    );
  };

  return () => {
    if (unsubscribePolling) {
      unsubscribePolling();
      return;
    }

    active = false;
    eventSource.onmessage = null;
    eventSource.onerror = null;
    eventSource.close();
  };
}

export async function putDesktopDownloadEngineSettings(
  settings: DesktopDownloadEngineSettingsUpdate
): Promise<DesktopDownloadEngineSnapshot> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl('/tasks/settings'),
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  return parseJsonResponse<DesktopDownloadEngineSnapshot>(response);
}

export async function postDesktopDownloadTask(
  task: DownloadTask
): Promise<DesktopDownloadEngineSnapshot> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(buildDesktopDownloadRuntimeUrl('/tasks'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(task),
    cache: 'no-store',
    credentials: 'omit',
  });

  return parseJsonResponse<DesktopDownloadEngineSnapshot>(response);
}

export async function pauseDesktopDownloadTask(
  taskId: string
): Promise<DesktopDownloadEngineSnapshot> {
  return postDesktopDownloadTaskCommand(taskId, 'pause');
}

export async function resumeDesktopDownloadTask(
  taskId: string
): Promise<DesktopDownloadEngineSnapshot> {
  return postDesktopDownloadTaskCommand(taskId, 'resume');
}

export async function retryDesktopDownloadTask(
  taskId: string
): Promise<DesktopDownloadEngineSnapshot> {
  return postDesktopDownloadTaskCommand(taskId, 'retry');
}

export async function cancelDesktopDownloadTask(
  taskId: string
): Promise<DesktopDownloadEngineSnapshot> {
  return postDesktopDownloadTaskCommand(taskId, 'cancel');
}

export async function postDesktopDownloadTaskBulkCommand(
  command: DesktopDownloadEngineBulkCommand,
  taskIds: string[]
): Promise<DesktopDownloadEngineSnapshot> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(buildDesktopDownloadRuntimeUrl('/tasks/bulk'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      command,
      taskIds,
    }),
    cache: 'no-store',
    credentials: 'omit',
  });

  return parseJsonResponse<DesktopDownloadEngineSnapshot>(response);
}

export async function deleteDesktopDownloadTask(
  taskId: string
): Promise<DesktopDownloadEngineSnapshot> {
  ensureDesktopLocalDownloadRuntime();
  const response = await fetch(
    buildDesktopDownloadRuntimeUrl(`/tasks/${encodeURIComponent(taskId)}`),
    {
      method: 'DELETE',
      cache: 'no-store',
      credentials: 'omit',
    }
  );

  return parseJsonResponse<DesktopDownloadEngineSnapshot>(response);
}
