import { getRuntimeConfig } from '@/lib/runtime-config';

import { DOWNLOAD_CACHE_NAME } from './types';

const CACHE_DELETE_BATCH_SIZE = 50;
const DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY_FLAG =
  process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY === 'true';

function assertCacheStorageAvailable(): void {
  if (typeof window === 'undefined' || typeof caches === 'undefined') {
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

  if (
    getRuntimeConfig().APP_TARGET === 'desktop' &&
    (!DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY_FLAG ||
      process.env.NODE_ENV !== 'development')
  ) {
    return {
      supported: false,
      reason: '当前桌面运行时尚未接入可用的离线下载能力',
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
  const cache = await openDownloadCache();
  await cache.put(toCacheRequest(input), response);
}

export async function matchDownloadResponse(
  input: Request | string
): Promise<Response | undefined> {
  const cache = await openDownloadCache();

  for (const candidate of buildCacheLookupCandidates(input)) {
    const matched = await cache.match(candidate);
    if (matched) {
      return matched;
    }
  }

  return undefined;
}

export async function hasCachedDownload(
  input: Request | string
): Promise<boolean> {
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
  if (typeof window === 'undefined' || typeof caches === 'undefined') {
    return;
  }
  await caches.delete(DOWNLOAD_CACHE_NAME);
}
