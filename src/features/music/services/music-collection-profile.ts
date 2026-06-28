/* eslint-disable no-console */

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  deleteRemoteProfileResource,
  fetchRemoteProfileJson,
  postRemoteProfilePayload,
} from '@/lib/profile/remote-adapter';
import {
  isProfileApiAuthPending,
  PROFILE_API_NO_REDIRECT_OPTIONS,
} from '@/lib/profile/request-state';
import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';

import {
  type SavedMusicCollectionRecord,
  buildMusicCollectionProfileKey,
  sanitizeMusicCollectionRecordList,
  sortMusicCollectionsBySavedAt,
} from './music-collection-profile-records';
import type {
  MusicCollectionSummaryEntity,
  MusicSourceKey,
} from '../domain/entities';

export type { SavedMusicCollectionRecord };
export { buildMusicCollectionProfileKey };

const LOCAL_MUSIC_COLLECTIONS_STORAGE_KEY = 'moontv_music_collections';
const MUSIC_COLLECTIONS_API_PATH = '/music/profile/collections';
const MUSIC_COLLECTIONS_MIGRATION_MARKER_PREFIX =
  'lunatv:desktop-local-music-collections-migrated:v1';

let hydrationPromise: Promise<void> | null = null;

function shouldUseRemoteMusicCollectionsStorage(): boolean {
  return shouldUseProfileApiStorage();
}

function logMusicCollectionFailure(message: string, error: unknown): void {
  console.error(message, error);
}

function readLocalJsonValue<T>(storageKey: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = localStorage.getItem(storageKey);

    if (!raw) {
      return fallback;
    }

    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalJsonValue(storageKey: string, value: unknown): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch (error) {
    logMusicCollectionFailure(`写入音乐合集资料失败: ${storageKey}`, error);
  }
}

function clearLocalJsonValue(storageKey: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(storageKey);
  } catch (error) {
    logMusicCollectionFailure(`清理音乐合集资料失败: ${storageKey}`, error);
  }
}

function readCachedMusicCollections(): SavedMusicCollectionRecord[] {
  return sanitizeMusicCollectionRecordList(
    readLocalJsonValue<unknown[]>(LOCAL_MUSIC_COLLECTIONS_STORAGE_KEY, [])
  );
}

function writeCachedMusicCollections(
  records: SavedMusicCollectionRecord[]
): void {
  writeLocalJsonValue(LOCAL_MUSIC_COLLECTIONS_STORAGE_KEY, records);
}

function dispatchMusicCollectionsUpdated(
  detail: SavedMusicCollectionRecord[]
): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent('musicCollectionsUpdated', {
      detail,
    })
  );
}

function getMusicMigrationUsername(): string {
  return (
    getAuthInfoFromBrowserCookie()?.username?.trim() || 'desktop-local-owner'
  );
}

function buildMusicCollectionsMigrationMarker(username: string): string {
  return `${MUSIC_COLLECTIONS_MIGRATION_MARKER_PREFIX}:${username}`;
}

function isMusicCollectionsMigrationComplete(username: string): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    return (
      localStorage.getItem(buildMusicCollectionsMigrationMarker(username)) ===
      '1'
    );
  } catch {
    return false;
  }
}

function markMusicCollectionsMigrationComplete(username: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(buildMusicCollectionsMigrationMarker(username), '1');
  } catch {
    // Ignore marker persistence failures and retry later.
  }
}

function upsertMusicCollectionRecord(
  records: SavedMusicCollectionRecord[],
  nextRecord: SavedMusicCollectionRecord
): SavedMusicCollectionRecord[] {
  const nextKey = buildMusicCollectionProfileKey(
    nextRecord.summary.source,
    nextRecord.summary.id
  );

  return [
    nextRecord,
    ...records.filter((record) => {
      const recordKey = buildMusicCollectionProfileKey(
        record.summary.source,
        record.summary.id
      );

      return recordKey !== nextKey;
    }),
  ].sort(sortMusicCollectionsBySavedAt);
}

async function fetchMusicCollectionsFromApi(): Promise<
  SavedMusicCollectionRecord[]
> {
  const payload = await fetchRemoteProfileJson<unknown[]>(
    MUSIC_COLLECTIONS_API_PATH,
    PROFILE_API_NO_REDIRECT_OPTIONS
  );

  return sanitizeMusicCollectionRecordList(payload);
}

async function migrateDesktopMusicCollections(): Promise<void> {
  const legacyCollections = readCachedMusicCollections();

  if (legacyCollections.length === 0) {
    return;
  }

  const remoteCollections = await fetchMusicCollectionsFromApi();
  const remoteCollectionMap = new Map(
    remoteCollections.map((record) => [
      buildMusicCollectionProfileKey(record.summary.source, record.summary.id),
      record,
    ])
  );

  for (const record of [...legacyCollections].reverse()) {
    const key = buildMusicCollectionProfileKey(
      record.summary.source,
      record.summary.id
    );
    const remoteRecord = remoteCollectionMap.get(key);

    if (remoteRecord && remoteRecord.savedAt >= record.savedAt) {
      continue;
    }

    await postRemoteProfilePayload(
      MUSIC_COLLECTIONS_API_PATH,
      {
        key,
        collection: record,
      },
      PROFILE_API_NO_REDIRECT_OPTIONS
    );
  }

  clearLocalJsonValue(LOCAL_MUSIC_COLLECTIONS_STORAGE_KEY);
}

async function hydrateDesktopMusicCollectionsStore(): Promise<void> {
  const username = getMusicMigrationUsername();

  if (isMusicCollectionsMigrationComplete(username)) {
    return;
  }

  await migrateDesktopMusicCollections();
  markMusicCollectionsMigrationComplete(username);
}

async function ensureMusicCollectionsStoreHydrated(): Promise<void> {
  if (
    typeof window === 'undefined' ||
    !shouldUseRemoteMusicCollectionsStorage() ||
    isProfileApiAuthPending()
  ) {
    return;
  }

  if (!hydrationPromise) {
    hydrationPromise = hydrateDesktopMusicCollectionsStore()
      .catch((error) => {
        logMusicCollectionFailure('桌面音乐合集迁移失败:', error);
      })
      .finally(() => {
        hydrationPromise = null;
      });
  }

  await hydrationPromise;
}

export function subscribeToMusicCollectionProfileUpdates(
  callback: (records: SavedMusicCollectionRecord[]) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleEvent = (event: Event) => {
    callback([
      ...((event as CustomEvent<readonly SavedMusicCollectionRecord[]>)
        .detail || []),
    ]);
  };

  window.addEventListener('musicCollectionsUpdated', handleEvent);

  return () => {
    window.removeEventListener('musicCollectionsUpdated', handleEvent);
  };
}

export async function getMusicSavedCollections(): Promise<
  SavedMusicCollectionRecord[]
> {
  if (shouldUseRemoteMusicCollectionsStorage()) {
    if (isProfileApiAuthPending()) {
      return readCachedMusicCollections();
    }

    try {
      await ensureMusicCollectionsStoreHydrated();
      const collections = await fetchMusicCollectionsFromApi();
      writeCachedMusicCollections(collections);
      return collections;
    } catch (error) {
      logMusicCollectionFailure('读取音乐已保存合集失败:', error);
      return readCachedMusicCollections();
    }
  }

  return readCachedMusicCollections();
}

export async function saveMusicCollection(
  summary: MusicCollectionSummaryEntity,
  savedAt = Date.now()
): Promise<SavedMusicCollectionRecord> {
  const key = buildMusicCollectionProfileKey(summary.source, summary.id);
  const nextRecord: SavedMusicCollectionRecord = {
    summary,
    savedAt,
  };

  if (shouldUseRemoteMusicCollectionsStorage() && !isProfileApiAuthPending()) {
    await ensureMusicCollectionsStoreHydrated();

    const previousCollections = readCachedMusicCollections();
    const nextCollections = upsertMusicCollectionRecord(
      previousCollections,
      nextRecord
    );

    writeCachedMusicCollections(nextCollections);
    dispatchMusicCollectionsUpdated(nextCollections);

    try {
      await postRemoteProfilePayload(
        MUSIC_COLLECTIONS_API_PATH,
        {
          key,
          collection: nextRecord,
        },
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
    } catch (error) {
      writeCachedMusicCollections(previousCollections);
      dispatchMusicCollectionsUpdated(previousCollections);
      throw error;
    }

    return nextRecord;
  }

  const nextCollections = upsertMusicCollectionRecord(
    readCachedMusicCollections(),
    nextRecord
  );
  writeCachedMusicCollections(nextCollections);
  dispatchMusicCollectionsUpdated(nextCollections);

  return nextRecord;
}

export async function deleteMusicCollection(
  source: MusicSourceKey,
  collectionId: string
): Promise<void> {
  const key = buildMusicCollectionProfileKey(source, collectionId);

  if (shouldUseRemoteMusicCollectionsStorage() && !isProfileApiAuthPending()) {
    await ensureMusicCollectionsStoreHydrated();

    const previousCollections = readCachedMusicCollections();
    const nextCollections = previousCollections.filter((record) => {
      const recordKey = buildMusicCollectionProfileKey(
        record.summary.source,
        record.summary.id
      );

      return recordKey !== key;
    });

    writeCachedMusicCollections(nextCollections);
    dispatchMusicCollectionsUpdated(nextCollections);

    try {
      await deleteRemoteProfileResource(
        MUSIC_COLLECTIONS_API_PATH,
        {
          key,
        },
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
    } catch (error) {
      writeCachedMusicCollections(previousCollections);
      dispatchMusicCollectionsUpdated(previousCollections);
      throw error;
    }

    return;
  }

  const nextCollections = readCachedMusicCollections().filter((record) => {
    const recordKey = buildMusicCollectionProfileKey(
      record.summary.source,
      record.summary.id
    );

    return recordKey !== key;
  });
  writeCachedMusicCollections(nextCollections);
  dispatchMusicCollectionsUpdated(nextCollections);
}

export async function clearMusicCollections(): Promise<void> {
  if (shouldUseRemoteMusicCollectionsStorage() && !isProfileApiAuthPending()) {
    await ensureMusicCollectionsStoreHydrated();

    const previousCollections = readCachedMusicCollections();
    writeCachedMusicCollections([]);
    dispatchMusicCollectionsUpdated([]);

    try {
      await deleteRemoteProfileResource(
        MUSIC_COLLECTIONS_API_PATH,
        undefined,
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
    } catch (error) {
      writeCachedMusicCollections(previousCollections);
      dispatchMusicCollectionsUpdated(previousCollections);
      throw error;
    }

    return;
  }

  clearLocalJsonValue(LOCAL_MUSIC_COLLECTIONS_STORAGE_KEY);
  dispatchMusicCollectionsUpdated([]);
}

export async function isMusicCollectionSaved(
  source: MusicSourceKey,
  collectionId: string
): Promise<boolean> {
  const collections = await getMusicSavedCollections();
  const key = buildMusicCollectionProfileKey(source, collectionId);

  return collections.some((record) => {
    const recordKey = buildMusicCollectionProfileKey(
      record.summary.source,
      record.summary.id
    );

    return recordKey === key;
  });
}
