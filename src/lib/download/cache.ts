import { getRuntimeConfig } from '@/lib/runtime-config';

import {
  clearDesktopDownloadCache,
  deleteDesktopDownloadCacheEntry,
  getDesktopDownloadCachedResponse,
  getDesktopDownloadCacheMeta,
  isDesktopLocalDownloadRuntimeEnabled,
  putDesktopDownloadCacheEntry,
} from './desktop-runtime';
import { DOWNLOAD_CACHE_NAME } from './types';

const CACHE_DELETE_BATCH_SIZE = 50;

function assertCacheStorageAvailable(): void {
  if (typeof window === 'undefined') {
    throw new Error('当前环境不支持 Cache Storage');
  }

  if (!window.isSecureContext) {
    throw new Error('当前页面不是安全上下文，请使用 HTTPS 或 localhost');
  }

  if (typeof caches === 'undefined') {
    throw new Error('当前环境不支持 Cache Storage');
  }
}

function toCacheRequest(input: Request | string): Request {
  return input instanceof Request
    ? input
    : new Request(input, { method: 'GET' });
}

function buildCacheLookupCandidates(input: Request | string): string[] {
  const candidates = new Set<string>();
  const rawUrl = input instanceof Request ? input.url : input;
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://moontv.local';

  const addCandidate = (value: string) => {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return;
    }
    candidates.add(normalizedValue);
  };

  addCandidate(rawUrl);

  try {
    const parsedUrl = new URL(rawUrl, origin);
    addCandidate(parsedUrl.toString());

    if (parsedUrl.origin === origin) {
      addCandidate(`${parsedUrl.pathname}${parsedUrl.search}`);
    }
  } catch (error) {
    // ignore invalid candidate parsing
  }

  return Array.from(candidates);
}

async function openDownloadCache(): Promise<Cache> {
  assertCacheStorageAvailable();
  return caches.open(DOWNLOAD_CACHE_NAME);
}

export function getOfflineDownloadSupportState(): {
  supported: boolean;
  reason?: string;
} {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      reason: '当前环境不支持离线下载',
    };
  }

  if (isDesktopLocalDownloadRuntimeEnabled()) {
    return {
      supported: true,
    };
  }

  if (getRuntimeConfig().APP_TARGET === 'desktop') {
    return {
      supported: false,
      reason: '当前桌面运行时尚未接入可用的离线下载能力',
    };
  }

  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: '当前页面不是安全上下文，请使用 HTTPS 或 localhost',
    };
  }

  if (typeof caches === 'undefined') {
    return {
      supported: false,
      reason: '当前环境不支持 Cache Storage',
    };
  }

  if (typeof indexedDB === 'undefined') {
    return {
      supported: false,
      reason: '当前环境不支持 IndexedDB',
    };
  }

  return {
    supported: true,
  };
}

export function isOfflineDownloadSupported(): boolean {
  return getOfflineDownloadSupportState().supported;
}

export async function putDownloadResponse(
  input: Request | string,
  response: Response
): Promise<void> {
  if (isDesktopLocalDownloadRuntimeEnabled()) {
    const targetUrl = input instanceof Request ? input.url : input;
    await putDesktopDownloadCacheEntry(targetUrl, response);
    return;
  }

  const cache = await openDownloadCache();
  await cache.put(toCacheRequest(input), response);
}

export async function matchDownloadResponse(
  input: Request | string
): Promise<Response | undefined> {
  if (isDesktopLocalDownloadRuntimeEnabled()) {
    for (const candidate of buildCacheLookupCandidates(input)) {
      const matched = await getDesktopDownloadCachedResponse(candidate).catch(
        () => undefined
      );
      if (matched) {
        return matched;
      }
    }

    return undefined;
  }

  const cache = await openDownloadCache();

  for (const candidate of buildCacheLookupCandidates(input)) {
    const matched = await cache.match(candidate);
    if (matched) {
      return matched;
    }
  }

  return undefined;
}

export async function getCachedDownloadSizeBytes(
  input: Request | string
): Promise<number> {
  if (isDesktopLocalDownloadRuntimeEnabled()) {
    for (const candidate of buildCacheLookupCandidates(input)) {
      const meta = await getDesktopDownloadCacheMeta(candidate).catch(
        () => undefined
      );
      if (!meta?.exists) {
        continue;
      }

      return typeof meta.sizeBytes === 'number' &&
        Number.isFinite(meta.sizeBytes)
        ? Math.max(0, meta.sizeBytes)
        : 0;
    }

    return 0;
  }

  const matched = await matchDownloadResponse(input);
  if (!matched) {
    return 0;
  }

  const headerSize = Number(matched.headers.get('content-length') || 0);
  if (Number.isFinite(headerSize) && headerSize > 0) {
    return headerSize;
  }

  try {
    const buffer = await matched.clone().arrayBuffer();
    return buffer.byteLength;
  } catch {
    return 0;
  }
}

export async function hasCachedDownload(
  input: Request | string
): Promise<boolean> {
  if (isDesktopLocalDownloadRuntimeEnabled()) {
    for (const candidate of buildCacheLookupCandidates(input)) {
      const meta = await getDesktopDownloadCacheMeta(candidate).catch(
        () => undefined
      );
      if (meta?.exists) {
        return true;
      }
    }

    return false;
  }

  const matched = await matchDownloadResponse(input);
  return Boolean(matched);
}

async function deleteCachedDownloadFromCache(
  cache: Cache,
  input: Request | string
): Promise<boolean> {
  const results = await Promise.all(
    buildCacheLookupCandidates(input).map((candidate) =>
      cache.delete(candidate)
    )
  );
  return results.some(Boolean);
}

export async function deleteCachedDownload(
  input: Request | string
): Promise<boolean> {
  if (isDesktopLocalDownloadRuntimeEnabled()) {
    let deleted = false;
    for (const candidate of buildCacheLookupCandidates(input)) {
      if (await deleteDesktopDownloadCacheEntry(candidate).catch(() => false)) {
        deleted = true;
      }
    }

    return deleted;
  }

  const cache = await openDownloadCache();
  return deleteCachedDownloadFromCache(cache, input);
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function deleteCachedDownloads(urls: string[]): Promise<void> {
  const uniqueUrls = Array.from(new Set(urls));
  if (uniqueUrls.length === 0) {
    return;
  }

  if (isDesktopLocalDownloadRuntimeEnabled()) {
    for (
      let index = 0;
      index < uniqueUrls.length;
      index += CACHE_DELETE_BATCH_SIZE
    ) {
      const batch = uniqueUrls.slice(index, index + CACHE_DELETE_BATCH_SIZE);
      await Promise.allSettled(
        batch.map((url) => deleteDesktopDownloadCacheEntry(url))
      );

      if (index + CACHE_DELETE_BATCH_SIZE < uniqueUrls.length) {
        await yieldToMainThread();
      }
    }
    return;
  }

  const cache = await openDownloadCache();

  for (
    let index = 0;
    index < uniqueUrls.length;
    index += CACHE_DELETE_BATCH_SIZE
  ) {
    const batch = uniqueUrls.slice(index, index + CACHE_DELETE_BATCH_SIZE);
    await Promise.allSettled(
      batch.map((url) => deleteCachedDownloadFromCache(cache, url))
    );

    if (index + CACHE_DELETE_BATCH_SIZE < uniqueUrls.length) {
      await yieldToMainThread();
    }
  }
}

export async function clearDownloadCache(): Promise<void> {
  if (isDesktopLocalDownloadRuntimeEnabled()) {
    await clearDesktopDownloadCache().catch(() => undefined);
    return;
  }

  if (typeof window === 'undefined' || typeof caches === 'undefined') {
    return;
  }
  await caches.delete(DOWNLOAD_CACHE_NAME);
}
