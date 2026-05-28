import { fetchDoubanData } from '@/lib/douban';

interface DoubanSubjectRatingResponse {
  rating?: {
    value?: number | null;
  };
}

interface CachedDoubanRatingEntry {
  expiresAt: number;
  value: string;
}

const DOUBAN_RATING_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时
const CACHE_CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟
const MAX_CACHE_SIZE = 3000;
const DOUBAN_RATING_CACHE = new Map<number, CachedDoubanRatingEntry>();
const INFLIGHT_RATING_REQUESTS = new Map<number, Promise<string>>();

let cleanupTimer: NodeJS.Timeout | null = null;
let lastCleanupTime = 0;

function normalizeDoubanIds(ids: Array<number | string>): number[] {
  return Array.from(
    new Set(
      ids
        .map((id) =>
          typeof id === 'number'
            ? id
            : Number.parseInt(id.toString().trim(), 10)
        )
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
}

function getCachedDoubanRating(id: number): string | undefined {
  const entry = DOUBAN_RATING_CACHE.get(id);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    DOUBAN_RATING_CACHE.delete(id);
    return undefined;
  }

  return entry.value;
}

function setCachedDoubanRating(id: number, value: string): void {
  ensureAutoCleanupStarted();

  const now = Date.now();
  if (now - lastCleanupTime > CACHE_CLEANUP_INTERVAL_MS) {
    performCacheCleanup();
  }

  DOUBAN_RATING_CACHE.set(id, {
    expiresAt: now + DOUBAN_RATING_CACHE_TTL_MS,
    value,
  });
}

function ensureAutoCleanupStarted(): void {
  if (cleanupTimer) {
    return;
  }

  cleanupTimer = setInterval(() => {
    performCacheCleanup();
  }, CACHE_CLEANUP_INTERVAL_MS);

  if (typeof process !== 'undefined' && cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

function performCacheCleanup(): void {
  const now = Date.now();

  DOUBAN_RATING_CACHE.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      DOUBAN_RATING_CACHE.delete(key);
    }
  });

  if (DOUBAN_RATING_CACHE.size > MAX_CACHE_SIZE) {
    const entries = Array.from(DOUBAN_RATING_CACHE.entries()).sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt
    );
    const removeCount = DOUBAN_RATING_CACHE.size - MAX_CACHE_SIZE;

    for (let i = 0; i < removeCount; i++) {
      DOUBAN_RATING_CACHE.delete(entries[i][0]);
    }
  }

  lastCleanupTime = now;
}

async function fetchDoubanRatingFromApi(id: number): Promise<string> {
  const target = `https://m.douban.com/rexxar/api/v2/subject/${id}?for_mobile=1`;
  const data = await fetchDoubanData<DoubanSubjectRatingResponse>(target);
  const rating = data.rating?.value;

  return typeof rating === 'number' && Number.isFinite(rating)
    ? rating.toFixed(1)
    : '';
}

export async function getDoubanRatingById(id: number): Promise<string> {
  const cached = getCachedDoubanRating(id);
  if (cached !== undefined) {
    return cached;
  }

  const inflight = INFLIGHT_RATING_REQUESTS.get(id);
  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    const rating = await fetchDoubanRatingFromApi(id);
    setCachedDoubanRating(id, rating);
    return rating;
  })().finally(() => {
    INFLIGHT_RATING_REQUESTS.delete(id);
  });

  INFLIGHT_RATING_REQUESTS.set(id, request);
  return request;
}

export async function getDoubanRatingsByIds(
  ids: Array<number | string>,
  maxConcurrency = 5
): Promise<Record<string, string>> {
  const uniqueIds = normalizeDoubanIds(ids);
  if (uniqueIds.length === 0) {
    return {};
  }

  const ratings: Record<string, string> = {};
  const workerCount = Math.max(1, Math.min(maxConcurrency, uniqueIds.length));
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < uniqueIds.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      const doubanId = uniqueIds[currentIndex];
      if (doubanId === undefined) {
        return;
      }

      try {
        ratings[doubanId.toString()] = await getDoubanRatingById(doubanId);
      } catch {
        continue;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return ratings;
}
