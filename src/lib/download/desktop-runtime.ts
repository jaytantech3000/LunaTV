import { getRuntimeConfig } from '@/lib/runtime-config';
import { buildApiUrl } from '@/lib/transport/endpoint';

import { ResourceIndexRecord } from './types';

const DESKTOP_LOCAL_DOWNLOAD_RUNTIME_ENABLED =
  process.env.NEXT_PUBLIC_DESKTOP_LOCAL_DOWNLOAD_RUNTIME === 'true';

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

function ensureDesktopLocalDownloadRuntime(): void {
  if (!isDesktopLocalDownloadRuntimeEnabled()) {
    throw new Error(
      'Desktop local download runtime is unavailable in the current build.'
    );
  }
}

function buildDesktopDownloadRuntimeUrl(
  path: string,
  searchParams?: Record<string, string>
): string {
  return buildApiUrl(`/download-runtime${path}`, searchParams);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(
      `Desktop download runtime request failed: ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}

export function isDesktopLocalDownloadRuntimeEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const runtimeConfig = getRuntimeConfig();
  return Boolean(
    DESKTOP_LOCAL_DOWNLOAD_RUNTIME_ENABLED &&
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
