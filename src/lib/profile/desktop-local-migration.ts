/* eslint-disable no-console */
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import {
  type Favorite,
  type PlayRecord,
  PROFILE_USER_DATA_API_PATHS as USER_DATA_API_PATHS,
} from './contracts';
import {
  clearLocalFavorites,
  clearLocalFollowRecords,
  clearLocalPlayRecords,
  clearLocalSearchHistoryValues,
  clearLocalSkipConfigs,
  readLocalFavorites,
  readLocalFollowRecords,
  readLocalPlayRecords,
  readLocalSearchHistoryValues,
  readLocalSkipConfigs,
} from './local-adapter';
import {
  type RemoteProfileRequestInit,
  fetchRemoteProfileJson,
  postRemoteProfilePayload,
} from './remote-adapter';
import { isDesktopLocalProfileRuntime } from './runtime';
import { type FollowRecord, type SkipConfig } from '../types';

type MigrationDomain =
  | 'playrecords'
  | 'favorites'
  | 'follows'
  | 'searchhistory'
  | 'skipconfigs';

const MIGRATION_MARKER_PREFIX = 'lunatv:desktop-local-profile-migrated:v1';
const DEFAULT_DESKTOP_OWNER_USERNAME = 'admin';
const LEGACY_DEFAULT_DESKTOP_OWNER_USERNAME = 'desktop-local-owner';
const NO_REDIRECT_OPTIONS: RemoteProfileRequestInit = {
  redirectOnUnauthorized: false,
};

let hydrationPromise: Promise<void> | null = null;

export async function ensureDesktopLocalProfileStoreHydrated(): Promise<void> {
  if (typeof window === 'undefined' || !isDesktopLocalProfileRuntime()) {
    return;
  }

  if (!hydrationPromise) {
    hydrationPromise = hydrateDesktopLocalProfileStore().finally(() => {
      hydrationPromise = null;
    });
  }

  await hydrationPromise;
}

async function hydrateDesktopLocalProfileStore(): Promise<void> {
  const username = getMigrationUsername();
  const migrations: Array<[MigrationDomain, () => Promise<void>]> = [
    ['playrecords', migratePlayRecords],
    ['favorites', migrateFavorites],
    ['follows', migrateFollowRecords],
    ['searchhistory', migrateSearchHistory],
    ['skipconfigs', migrateSkipConfigs],
  ];

  const results = await Promise.allSettled(
    migrations.map(async ([domain, migrate]) => {
      if (isDomainMigrated(username, domain)) {
        return;
      }

      await migrate();
      markDomainMigrated(username, domain);
    })
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      return;
    }

    const [domain] = migrations[index];
    console.warn(`桌面本地资料迁移失败 (${domain}):`, result.reason);
  });
}

async function migratePlayRecords(): Promise<void> {
  const legacyRecords = readLocalPlayRecords();
  const entries = Object.entries(legacyRecords);

  if (entries.length === 0) {
    return;
  }

  const remoteRecords = await fetchRemoteProfileJson<
    Record<string, PlayRecord>
  >(USER_DATA_API_PATHS.playRecords, NO_REDIRECT_OPTIONS);

  for (const [key, record] of entries) {
    const remoteRecord = remoteRecords[key];
    if (remoteRecord && remoteRecord.save_time >= record.save_time) {
      continue;
    }

    await postRemoteProfilePayload(
      USER_DATA_API_PATHS.playRecords,
      {
        key,
        record,
      },
      NO_REDIRECT_OPTIONS
    );
  }

  clearLocalPlayRecords();
}

async function migrateFavorites(): Promise<void> {
  const legacyFavorites = readLocalFavorites();
  const entries = Object.entries(legacyFavorites);

  if (entries.length === 0) {
    return;
  }

  const remoteFavorites = await fetchRemoteProfileJson<
    Record<string, Favorite>
  >(USER_DATA_API_PATHS.favorites, NO_REDIRECT_OPTIONS);

  for (const [key, favorite] of entries) {
    const remoteFavorite = remoteFavorites[key];
    if (remoteFavorite && remoteFavorite.save_time >= favorite.save_time) {
      continue;
    }

    await postRemoteProfilePayload(
      USER_DATA_API_PATHS.favorites,
      {
        key,
        favorite,
      },
      NO_REDIRECT_OPTIONS
    );
  }

  clearLocalFavorites();
}

async function migrateFollowRecords(): Promise<void> {
  const legacyFollows = readLocalFollowRecords();
  const entries = Object.entries(legacyFollows);

  if (entries.length === 0) {
    return;
  }

  const remoteFollows = await fetchRemoteProfileJson<
    Record<string, FollowRecord>
  >(USER_DATA_API_PATHS.follows, NO_REDIRECT_OPTIONS);

  for (const [key, follow] of entries) {
    const remoteFollow = remoteFollows[key];
    if (
      remoteFollow &&
      remoteFollow.last_checked_at >= follow.last_checked_at &&
      remoteFollow.followed_episode_count >= follow.followed_episode_count &&
      remoteFollow.acknowledged_episode_count >=
        follow.acknowledged_episode_count &&
      remoteFollow.latest_episode_count >= follow.latest_episode_count
    ) {
      continue;
    }

    await postRemoteProfilePayload(
      USER_DATA_API_PATHS.follows,
      {
        key,
        follow,
      },
      NO_REDIRECT_OPTIONS
    );
  }

  clearLocalFollowRecords();
}

async function migrateSearchHistory(): Promise<void> {
  const legacyHistory = readLocalSearchHistoryValues();

  if (legacyHistory.length === 0) {
    return;
  }

  const remoteHistory = await fetchRemoteProfileJson<string[]>(
    USER_DATA_API_PATHS.searchHistory,
    NO_REDIRECT_OPTIONS
  );
  const remoteValues = new Set(remoteHistory);
  const missingValues = legacyHistory.filter(
    (value) => !remoteValues.has(value)
  );

  for (const keyword of [...missingValues].reverse()) {
    await postRemoteProfilePayload(
      USER_DATA_API_PATHS.searchHistory,
      {
        keyword,
      },
      NO_REDIRECT_OPTIONS
    );
  }

  clearLocalSearchHistoryValues();
}

async function migrateSkipConfigs(): Promise<void> {
  const legacyConfigs = readLocalSkipConfigs();
  const entries = Object.entries(legacyConfigs);

  if (entries.length === 0) {
    return;
  }

  const remoteConfigs = await fetchRemoteProfileJson<
    Record<string, SkipConfig>
  >(USER_DATA_API_PATHS.skipConfigs, NO_REDIRECT_OPTIONS);

  for (const [key, config] of entries) {
    if (remoteConfigs[key]) {
      continue;
    }

    await postRemoteProfilePayload(
      USER_DATA_API_PATHS.skipConfigs,
      {
        key,
        config,
      },
      NO_REDIRECT_OPTIONS
    );
  }

  clearLocalSkipConfigs();
}

function getMigrationUsername(): string {
  return (
    getAuthInfoFromBrowserCookie()?.username?.trim() ||
    DEFAULT_DESKTOP_OWNER_USERNAME
  );
}

export function buildDomainMarker(
  username: string,
  domain: MigrationDomain
): string {
  return `${MIGRATION_MARKER_PREFIX}:${username}:${domain}`;
}

export function isDomainMigrated(
  username: string,
  domain: MigrationDomain
): boolean {
  try {
    if (localStorage.getItem(buildDomainMarker(username, domain)) === '1') {
      return true;
    }

    return (
      username === DEFAULT_DESKTOP_OWNER_USERNAME &&
      localStorage.getItem(
        buildDomainMarker(LEGACY_DEFAULT_DESKTOP_OWNER_USERNAME, domain)
      ) === '1'
    );
  } catch {
    return false;
  }
}

function markDomainMigrated(username: string, domain: MigrationDomain): void {
  try {
    localStorage.setItem(buildDomainMarker(username, domain), '1');
  } catch {
    // Ignore marker persistence failures; migration is still best-effort.
  }
}
