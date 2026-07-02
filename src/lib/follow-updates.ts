'use client';

import { getAuthInfoFromBrowserCookie } from './auth';
import { fetchContentDetail } from './content-discovery-client';
import { normalizeVodDetailForPlayback } from './download/normalize';
import {
  deleteFollowRecord,
  getAllFollowRecords,
  getCachedFollowRecordsSnapshot,
  saveFollowRecord,
} from './profile/client';
import { isProfileApiAuthPending } from './profile/request-state';
import { resolveProfileRuntime } from './profile/runtime';
import { FollowRecord, SearchResult } from './types';

const FOLLOW_REFRESH_CONCURRENCY = 3;
const FOLLOW_REFRESH_SESSION_THROTTLE_MS = 10 * 1000;

export const FOLLOW_RECORD_REFRESH_THRESHOLD_MS = 30 * 60 * 1000;

export interface FollowEpisodeRange {
  start: number;
  end: number;
}

interface FollowTargetDescriptor {
  source?: string;
  id?: string;
  title?: string;
  origin?: 'vod' | 'live';
  from?: 'playrecord' | 'favorite' | 'search' | 'douban';
  isAggregate?: boolean;
}

interface EnableFollowUpdatesParams {
  source: string;
  id: string;
  title: string;
  sourceName?: string;
  year?: string;
  cover?: string;
  searchTitle?: string;
}

const refreshInFlightByKey = new Map<string, Promise<FollowRecord>>();
let queuedFollowRefreshPromise: Promise<void> | null = null;
let lastFollowRefreshStartedAt = 0;

function emitGlobalError(message: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent('globalError', {
      detail: { message },
    })
  );
}

function normalizeEpisodeCount(
  value: number | undefined,
  fallback = 1
): number {
  const nextValue = Number(value);

  if (!Number.isFinite(nextValue) || nextValue < 1) {
    return fallback;
  }

  return Math.floor(nextValue);
}

function parseFollowStorageKey(key: string): {
  source: string;
  id: string;
} | null {
  const separatorIndex = key.indexOf('+');

  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return null;
  }

  const source = key.slice(0, separatorIndex);
  const id = key.slice(separatorIndex + 1);

  if (!source || !id) {
    return null;
  }

  return {
    source,
    id,
  };
}

function isSameFollowRecord(left: FollowRecord, right: FollowRecord): boolean {
  return (
    left.title === right.title &&
    left.source_name === right.source_name &&
    left.year === right.year &&
    left.cover === right.cover &&
    left.search_title === right.search_title &&
    left.followed_at === right.followed_at &&
    left.followed_episode_count === right.followed_episode_count &&
    left.acknowledged_episode_count === right.acknowledged_episode_count &&
    left.latest_episode_count === right.latest_episode_count &&
    left.last_checked_at === right.last_checked_at
  );
}

async function fetchFollowDetail(
  source: string,
  id: string
): Promise<SearchResult> {
  const payload = await fetchContentDetail(
    {
      source,
      id,
    },
    {
      cache: 'no-store',
    }
  );

  return normalizeVodDetailForPlayback(payload);
}

async function fetchFollowEpisodeCount(
  source: string,
  id: string
): Promise<{
  detail: SearchResult;
  episodeCount: number;
}> {
  const detail = await fetchFollowDetail(source, id);

  return {
    detail,
    episodeCount: normalizeEpisodeCount(detail.episodes?.length, 1),
  };
}

async function runWithConcurrency<T>(
  tasks: T[],
  concurrency: number,
  worker: (task: T) => Promise<void>
): Promise<void> {
  const queue = [...tasks];
  const workerCount = Math.max(1, Math.min(concurrency, queue.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const nextTask = queue.shift();

        if (!nextTask) {
          return;
        }

        await worker(nextTask);
      }
    })
  );
}

export function isDesktopFollowUpdatesEnabled(): boolean {
  return resolveProfileRuntime().appTarget === 'desktop';
}

function usesRemoteFollowStorage(): boolean {
  return resolveProfileRuntime().usesRemoteUserData;
}

export function canManageFollowUpdates(
  descriptor: FollowTargetDescriptor
): boolean {
  if (descriptor.origin === 'live') {
    return false;
  }

  return Boolean(
    (descriptor.source && descriptor.id) || descriptor.title?.trim()
  );
}

export function hasNewEpisodes(
  follow: FollowRecord | null | undefined
): follow is FollowRecord {
  if (!follow) {
    return false;
  }

  return (
    normalizeEpisodeCount(follow.latest_episode_count) >
    normalizeEpisodeCount(
      follow.acknowledged_episode_count,
      normalizeEpisodeCount(follow.followed_episode_count)
    )
  );
}

export function getNewEpisodeRange(
  follow: FollowRecord | null | undefined
): FollowEpisodeRange | null {
  if (!hasNewEpisodes(follow)) {
    return null;
  }

  return {
    start: normalizeEpisodeCount(follow.acknowledged_episode_count) + 1,
    end: normalizeEpisodeCount(follow.latest_episode_count),
  };
}

export function isFollowRecordStale(
  follow: FollowRecord,
  now = Date.now()
): boolean {
  const lastCheckedAt =
    typeof follow.last_checked_at === 'number' ? follow.last_checked_at : 0;

  return now - lastCheckedAt >= FOLLOW_RECORD_REFRESH_THRESHOLD_MS;
}

export function mergeLatestEpisodeCountWithoutRegression(
  follow: FollowRecord,
  episodeCount: number,
  checkedAt = Date.now()
): FollowRecord {
  const followedEpisodeCount = normalizeEpisodeCount(
    follow.followed_episode_count
  );
  const acknowledgedEpisodeCount = normalizeEpisodeCount(
    follow.acknowledged_episode_count,
    followedEpisodeCount
  );
  const latestEpisodeCount = Math.max(
    normalizeEpisodeCount(follow.latest_episode_count, followedEpisodeCount),
    followedEpisodeCount,
    acknowledgedEpisodeCount,
    normalizeEpisodeCount(episodeCount, followedEpisodeCount)
  );

  return {
    ...follow,
    followed_episode_count: followedEpisodeCount,
    acknowledged_episode_count: acknowledgedEpisodeCount,
    latest_episode_count: latestEpisodeCount,
    last_checked_at: checkedAt,
  };
}

export function advanceAcknowledgedEpisodeCount(
  follow: FollowRecord,
  episodeNumber: number,
  options?: {
    latestEpisodeCount?: number;
    checkedAt?: number;
  }
): FollowRecord {
  const followedEpisodeCount = normalizeEpisodeCount(
    follow.followed_episode_count
  );
  const nextLatestEpisodeCount = Math.max(
    normalizeEpisodeCount(follow.latest_episode_count, followedEpisodeCount),
    followedEpisodeCount,
    normalizeEpisodeCount(
      options?.latestEpisodeCount,
      normalizeEpisodeCount(follow.latest_episode_count, followedEpisodeCount)
    ),
    normalizeEpisodeCount(episodeNumber, followedEpisodeCount)
  );
  const nextAcknowledgedEpisodeCount = Math.max(
    normalizeEpisodeCount(
      follow.acknowledged_episode_count,
      followedEpisodeCount
    ),
    Math.min(
      normalizeEpisodeCount(episodeNumber, followedEpisodeCount),
      nextLatestEpisodeCount
    )
  );

  return {
    ...follow,
    followed_episode_count: followedEpisodeCount,
    acknowledged_episode_count: nextAcknowledgedEpisodeCount,
    latest_episode_count: nextLatestEpisodeCount,
    last_checked_at: options?.checkedAt ?? follow.last_checked_at,
  };
}

export async function enableFollowUpdates(
  params: EnableFollowUpdatesParams
): Promise<FollowRecord> {
  const { detail, episodeCount } = await fetchFollowEpisodeCount(
    params.source,
    params.id
  );
  const now = Date.now();
  const followRecord: FollowRecord = {
    title: detail.title || params.title,
    source_name: detail.source_name || params.sourceName || '',
    year: detail.year || params.year || '',
    cover: detail.poster || params.cover || '',
    search_title: params.searchTitle || params.title,
    followed_at: now,
    followed_episode_count: episodeCount,
    acknowledged_episode_count: episodeCount,
    latest_episode_count: episodeCount,
    last_checked_at: now,
  };

  await saveFollowRecord(params.source, params.id, followRecord);
  return followRecord;
}

export async function disableFollowUpdates(
  source: string,
  id: string
): Promise<void> {
  await deleteFollowRecord(source, id);
}

export async function refreshFollowRecord(
  key: string,
  follow: FollowRecord,
  options: {
    force?: boolean;
  } = {}
): Promise<FollowRecord> {
  const parsedKey = parseFollowStorageKey(key);

  if (!parsedKey) {
    return follow;
  }

  const now = Date.now();

  if (!options.force && !isFollowRecordStale(follow, now)) {
    return follow;
  }

  const existingPromise = refreshInFlightByKey.get(key);
  if (existingPromise) {
    return existingPromise;
  }

  const refreshPromise = (async () => {
    const { source, id } = parsedKey;
    const { detail, episodeCount } = await fetchFollowEpisodeCount(source, id);
    const mergedFollow = mergeLatestEpisodeCountWithoutRegression(
      {
        ...follow,
        title: detail.title || follow.title,
        source_name: detail.source_name || follow.source_name,
        year: detail.year || follow.year,
        cover: detail.poster || follow.cover,
      },
      episodeCount,
      now
    );

    if (!isSameFollowRecord(follow, mergedFollow)) {
      await saveFollowRecord(source, id, mergedFollow);
    }

    return mergedFollow;
  })().finally(() => {
    refreshInFlightByKey.delete(key);
  });

  refreshInFlightByKey.set(key, refreshPromise);

  return refreshPromise;
}

export async function refreshFollowRecords(options?: {
  force?: boolean;
}): Promise<void> {
  if (!isDesktopFollowUpdatesEnabled()) {
    return;
  }

  if (isProfileApiAuthPending()) {
    return;
  }

  if (usesRemoteFollowStorage() && !getAuthInfoFromBrowserCookie()?.username) {
    return;
  }

  const now = Date.now();

  if (queuedFollowRefreshPromise) {
    return queuedFollowRefreshPromise;
  }

  if (
    !options?.force &&
    now - lastFollowRefreshStartedAt < FOLLOW_REFRESH_SESSION_THROTTLE_MS
  ) {
    return;
  }

  lastFollowRefreshStartedAt = now;
  const refreshPromise = (async () => {
    const snapshot = getCachedFollowRecordsSnapshot();
    const followRecords =
      snapshot ??
      (await getAllFollowRecords({
        suppressGlobalError: true,
      }));
    const pendingEntries = Object.entries(followRecords).filter(
      ([key, follow]) =>
        Boolean(parseFollowStorageKey(key)) &&
        Boolean(follow) &&
        (options?.force || isFollowRecordStale(follow, now))
    );

    if (pendingEntries.length === 0) {
      return;
    }

    await runWithConcurrency(
      pendingEntries,
      FOLLOW_REFRESH_CONCURRENCY,
      async ([key, follow]) => {
        try {
          await refreshFollowRecord(key, follow, options);
        } catch {
          // 首版刷新失败保持静默，避免把短时波动放大成持续噪音。
        }
      }
    );
  })().finally(() => {
    queuedFollowRefreshPromise = null;
  });

  queuedFollowRefreshPromise = refreshPromise;
  return refreshPromise;
}

export async function enableFollowUpdatesWithFeedback(
  params: EnableFollowUpdatesParams
): Promise<FollowRecord> {
  try {
    return await enableFollowUpdates(params);
  } catch (error) {
    emitGlobalError(
      error instanceof Error ? error.message : '开启追更失败，请稍后重试'
    );
    throw error;
  }
}

export async function disableFollowUpdatesWithFeedback(
  source: string,
  id: string
): Promise<void> {
  try {
    await disableFollowUpdates(source, id);
  } catch (error) {
    emitGlobalError(
      error instanceof Error ? error.message : '取消追更失败，请稍后重试'
    );
    throw error;
  }
}
