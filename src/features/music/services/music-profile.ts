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
  type MusicFavoriteRecord,
  type MusicPlayRecord,
  type MusicRecentTrackRecord,
  buildMusicProfileKey,
  buildPersistedTrackSnapshot,
  MAX_RECENT_TRACKS,
  sanitizeMusicFavoriteRecordMap,
  sanitizeMusicPlayRecord,
  sanitizeMusicPlayRecordMap,
  sanitizeMusicRecentTrackRecord,
  sanitizeMusicRecentTrackRecordList,
  sortMusicFavoritesBySavedAt,
  upsertMusicRecentTrackRecord,
} from './music-profile-records';
import type { MusicSourceKey, MusicTrackEntity } from '../domain/entities';

export type { MusicFavoriteRecord, MusicPlayRecord, MusicRecentTrackRecord };
export { buildMusicProfileKey };

export type MusicProfileUpdateEvent =
  | 'musicFavoritesUpdated'
  | 'musicRecentTracksUpdated'
  | 'musicPlayRecordsUpdated';

type MusicProfileMigrationDomain = 'favorites' | 'recentTracks' | 'playRecords';

const LOCAL_MUSIC_FAVORITES_STORAGE_KEY = 'moontv_music_favorites';
const LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY = 'moontv_music_recent_tracks';
const LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY = 'moontv_music_play_records';
const MUSIC_PROFILE_MIGRATION_MARKER_PREFIX =
  'lunatv:desktop-local-music-profile-migrated:v1';
const MUSIC_PROFILE_API_PATHS = {
  favorites: '/music/profile/favorites',
  recentTracks: '/music/profile/recent-tracks',
  playRecords: '/music/profile/play-records',
} as const;

let hydrationPromise: Promise<void> | null = null;

function shouldUseRemoteMusicProfileStorage(): boolean {
  return shouldUseProfileApiStorage();
}

function logMusicProfileFailure(message: string, error: unknown): void {
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
    console.error(`写入音乐本地资料失败: ${storageKey}`, error);
  }
}

function clearLocalJsonValue(storageKey: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(storageKey);
  } catch (error) {
    console.error(`清理音乐本地资料失败: ${storageKey}`, error);
  }
}

function dispatchMusicProfileUpdate<T>(
  eventType: MusicProfileUpdateEvent,
  detail: T
): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(eventType, {
      detail,
    })
  );
}

function readCachedMusicFavorites(): Record<string, MusicFavoriteRecord> {
  return sanitizeMusicFavoriteRecordMap(
    readLocalJsonValue<Record<string, unknown>>(
      LOCAL_MUSIC_FAVORITES_STORAGE_KEY,
      {}
    )
  );
}

function readCachedMusicRecentTracks(): MusicRecentTrackRecord[] {
  return sanitizeMusicRecentTrackRecordList(
    readLocalJsonValue<unknown[]>(LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY, [])
  );
}

function readCachedMusicPlayRecords(): Record<string, MusicPlayRecord> {
  return sanitizeMusicPlayRecordMap(
    readLocalJsonValue<Record<string, unknown>>(
      LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY,
      {}
    )
  );
}

function getMusicMigrationUsername(): string {
  return (
    getAuthInfoFromBrowserCookie()?.username?.trim() || 'desktop-local-owner'
  );
}

function buildMusicMigrationMarker(
  username: string,
  domain: MusicProfileMigrationDomain
): string {
  return `${MUSIC_PROFILE_MIGRATION_MARKER_PREFIX}:${username}:${domain}`;
}

function isMusicMigrationComplete(
  username: string,
  domain: MusicProfileMigrationDomain
): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    return (
      localStorage.getItem(buildMusicMigrationMarker(username, domain)) === '1'
    );
  } catch {
    return false;
  }
}

function markMusicMigrationComplete(
  username: string,
  domain: MusicProfileMigrationDomain
): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(buildMusicMigrationMarker(username, domain), '1');
  } catch {
    // Ignore marker persistence failures and allow a future retry.
  }
}

async function fetchMusicFavoritesFromApi(): Promise<
  Record<string, MusicFavoriteRecord>
> {
  const payload = await fetchRemoteProfileJson<Record<string, unknown>>(
    MUSIC_PROFILE_API_PATHS.favorites,
    PROFILE_API_NO_REDIRECT_OPTIONS
  );

  return sanitizeMusicFavoriteRecordMap(payload);
}

async function fetchMusicRecentTracksFromApi(): Promise<
  MusicRecentTrackRecord[]
> {
  const payload = await fetchRemoteProfileJson<unknown[]>(
    MUSIC_PROFILE_API_PATHS.recentTracks,
    PROFILE_API_NO_REDIRECT_OPTIONS
  );

  return sanitizeMusicRecentTrackRecordList(payload);
}

async function fetchMusicPlayRecordsFromApi(): Promise<
  Record<string, MusicPlayRecord>
> {
  const payload = await fetchRemoteProfileJson<Record<string, unknown>>(
    MUSIC_PROFILE_API_PATHS.playRecords,
    PROFILE_API_NO_REDIRECT_OPTIONS
  );

  return sanitizeMusicPlayRecordMap(payload);
}

async function migrateDesktopMusicFavorites(): Promise<void> {
  const legacyFavorites = readCachedMusicFavorites();
  const entries = Object.entries(legacyFavorites);

  if (entries.length === 0) {
    return;
  }

  const remoteFavorites = await fetchMusicFavoritesFromApi();

  for (const [key, favorite] of entries) {
    const remoteFavorite = remoteFavorites[key];
    if (remoteFavorite && remoteFavorite.savedAt >= favorite.savedAt) {
      continue;
    }

    await postRemoteProfilePayload(
      MUSIC_PROFILE_API_PATHS.favorites,
      {
        key,
        favorite,
      },
      PROFILE_API_NO_REDIRECT_OPTIONS
    );
  }

  clearLocalJsonValue(LOCAL_MUSIC_FAVORITES_STORAGE_KEY);
}

async function migrateDesktopMusicRecentTracks(): Promise<void> {
  const legacyTracks = readCachedMusicRecentTracks();

  if (legacyTracks.length === 0) {
    return;
  }

  const remoteTracks = await fetchMusicRecentTracksFromApi();
  const remoteTrackMap = new Map(
    remoteTracks.map((record) => [
      buildMusicProfileKey(record.track.source, record.track.id),
      record,
    ])
  );

  for (const record of [...legacyTracks].reverse()) {
    const key = buildMusicProfileKey(record.track.source, record.track.id);
    const remoteTrack = remoteTrackMap.get(key);

    if (remoteTrack && remoteTrack.playedAt >= record.playedAt) {
      continue;
    }

    await postRemoteProfilePayload(
      MUSIC_PROFILE_API_PATHS.recentTracks,
      {
        track: record,
      },
      PROFILE_API_NO_REDIRECT_OPTIONS
    );
  }

  clearLocalJsonValue(LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY);
}

async function migrateDesktopMusicPlayRecords(): Promise<void> {
  const legacyRecords = readCachedMusicPlayRecords();
  const entries = Object.entries(legacyRecords);

  if (entries.length === 0) {
    return;
  }

  const remoteRecords = await fetchMusicPlayRecordsFromApi();

  for (const [key, record] of entries) {
    const remoteRecord = remoteRecords[key];
    if (
      remoteRecord &&
      remoteRecord.playedAt >= record.playedAt &&
      remoteRecord.playTimeMs >= record.playTimeMs &&
      (remoteRecord.completed || !record.completed)
    ) {
      continue;
    }

    await postRemoteProfilePayload(
      MUSIC_PROFILE_API_PATHS.playRecords,
      {
        key,
        record,
      },
      PROFILE_API_NO_REDIRECT_OPTIONS
    );
  }

  clearLocalJsonValue(LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY);
}

async function hydrateDesktopMusicProfileStore(): Promise<void> {
  const username = getMusicMigrationUsername();
  const migrations: Array<[MusicProfileMigrationDomain, () => Promise<void>]> =
    [
      ['favorites', migrateDesktopMusicFavorites],
      ['recentTracks', migrateDesktopMusicRecentTracks],
      ['playRecords', migrateDesktopMusicPlayRecords],
    ];

  const results = await Promise.allSettled(
    migrations.map(async ([domain, migrate]) => {
      if (isMusicMigrationComplete(username, domain)) {
        return;
      }

      await migrate();
      markMusicMigrationComplete(username, domain);
    })
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      return;
    }

    const [domain] = migrations[index];
    logMusicProfileFailure(
      `桌面本地音乐资料迁移失败 (${domain}):`,
      result.reason
    );
  });
}

async function ensureMusicProfileStoreHydrated(): Promise<void> {
  if (typeof window === 'undefined' || !shouldUseRemoteMusicProfileStorage()) {
    return;
  }

  if (!hydrationPromise) {
    hydrationPromise = hydrateDesktopMusicProfileStore().finally(() => {
      hydrationPromise = null;
    });
  }

  await hydrationPromise;
}

export function subscribeToMusicProfileUpdates<T>(
  eventType: MusicProfileUpdateEvent,
  callback: (data: T) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleEvent = (event: Event) => {
    callback((event as CustomEvent<T>).detail);
  };

  window.addEventListener(eventType, handleEvent);

  return () => {
    window.removeEventListener(eventType, handleEvent);
  };
}

export async function getAllMusicFavorites(): Promise<
  Record<string, MusicFavoriteRecord>
> {
  if (shouldUseRemoteMusicProfileStorage()) {
    if (isProfileApiAuthPending()) {
      return {};
    }

    try {
      await ensureMusicProfileStoreHydrated();
      const favorites = await fetchMusicFavoritesFromApi();
      writeLocalJsonValue(LOCAL_MUSIC_FAVORITES_STORAGE_KEY, favorites);
      return favorites;
    } catch (error) {
      logMusicProfileFailure('读取桌面本地音乐收藏失败:', error);
      return readCachedMusicFavorites();
    }
  }

  return readCachedMusicFavorites();
}

export async function getMusicFavoritesList(): Promise<MusicFavoriteRecord[]> {
  return Object.values(await getAllMusicFavorites()).sort(
    sortMusicFavoritesBySavedAt
  );
}

export async function saveMusicFavorite(
  track: MusicTrackEntity,
  savedAt = Date.now()
): Promise<MusicFavoriteRecord> {
  const key = buildMusicProfileKey(track.source, track.id);
  const nextRecord: MusicFavoriteRecord = {
    track: buildPersistedTrackSnapshot(track),
    savedAt,
  };

  if (shouldUseRemoteMusicProfileStorage()) {
    await ensureMusicProfileStoreHydrated();

    const previousFavorites = readCachedMusicFavorites();
    const nextFavorites = {
      ...previousFavorites,
      [key]: nextRecord,
    };

    writeLocalJsonValue(LOCAL_MUSIC_FAVORITES_STORAGE_KEY, nextFavorites);
    dispatchMusicProfileUpdate('musicFavoritesUpdated', nextFavorites);

    try {
      await postRemoteProfilePayload(MUSIC_PROFILE_API_PATHS.favorites, {
        key,
        favorite: nextRecord,
      });
    } catch (error) {
      writeLocalJsonValue(LOCAL_MUSIC_FAVORITES_STORAGE_KEY, previousFavorites);
      dispatchMusicProfileUpdate('musicFavoritesUpdated', previousFavorites);
      throw error;
    }

    return nextRecord;
  }

  const nextFavorites = await getAllMusicFavorites();
  nextFavorites[key] = nextRecord;
  writeLocalJsonValue(LOCAL_MUSIC_FAVORITES_STORAGE_KEY, nextFavorites);
  dispatchMusicProfileUpdate('musicFavoritesUpdated', nextFavorites);

  return nextRecord;
}

export async function deleteMusicFavorite(
  source: MusicSourceKey,
  trackId: string
): Promise<void> {
  const key = buildMusicProfileKey(source, trackId);

  if (shouldUseRemoteMusicProfileStorage()) {
    await ensureMusicProfileStoreHydrated();

    const previousFavorites = readCachedMusicFavorites();
    const nextFavorites = {
      ...previousFavorites,
    };

    delete nextFavorites[key];
    writeLocalJsonValue(LOCAL_MUSIC_FAVORITES_STORAGE_KEY, nextFavorites);
    dispatchMusicProfileUpdate('musicFavoritesUpdated', nextFavorites);

    try {
      await deleteRemoteProfileResource(MUSIC_PROFILE_API_PATHS.favorites, {
        key,
      });
    } catch (error) {
      writeLocalJsonValue(LOCAL_MUSIC_FAVORITES_STORAGE_KEY, previousFavorites);
      dispatchMusicProfileUpdate('musicFavoritesUpdated', previousFavorites);
      throw error;
    }

    return;
  }

  const nextFavorites = await getAllMusicFavorites();
  delete nextFavorites[key];
  writeLocalJsonValue(LOCAL_MUSIC_FAVORITES_STORAGE_KEY, nextFavorites);
  dispatchMusicProfileUpdate('musicFavoritesUpdated', nextFavorites);
}

export async function clearAllMusicFavorites(): Promise<void> {
  if (shouldUseRemoteMusicProfileStorage() && !isProfileApiAuthPending()) {
    await ensureMusicProfileStoreHydrated();

    const previousFavorites = readCachedMusicFavorites();
    writeLocalJsonValue(LOCAL_MUSIC_FAVORITES_STORAGE_KEY, {});
    dispatchMusicProfileUpdate('musicFavoritesUpdated', {});

    try {
      await deleteRemoteProfileResource(
        MUSIC_PROFILE_API_PATHS.favorites,
        undefined,
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
    } catch (error) {
      writeLocalJsonValue(LOCAL_MUSIC_FAVORITES_STORAGE_KEY, previousFavorites);
      dispatchMusicProfileUpdate('musicFavoritesUpdated', previousFavorites);
      throw error;
    }

    return;
  }

  clearLocalJsonValue(LOCAL_MUSIC_FAVORITES_STORAGE_KEY);
  dispatchMusicProfileUpdate('musicFavoritesUpdated', {});
}

export async function isMusicFavorited(
  source: MusicSourceKey,
  trackId: string
): Promise<boolean> {
  const favorites = await getAllMusicFavorites();
  return Boolean(favorites[buildMusicProfileKey(source, trackId)]);
}

export async function getMusicRecentTracks(): Promise<
  MusicRecentTrackRecord[]
> {
  if (shouldUseRemoteMusicProfileStorage()) {
    if (isProfileApiAuthPending()) {
      return [];
    }

    try {
      await ensureMusicProfileStoreHydrated();
      const tracks = await fetchMusicRecentTracksFromApi();
      writeLocalJsonValue(LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY, tracks);
      return tracks;
    } catch (error) {
      logMusicProfileFailure('读取桌面本地音乐最近播放失败:', error);
      return readCachedMusicRecentTracks();
    }
  }

  return readCachedMusicRecentTracks();
}

export async function saveMusicRecentTrack(
  track: MusicTrackEntity,
  playedAt = Date.now()
): Promise<MusicRecentTrackRecord[]> {
  const nextRecord = sanitizeMusicRecentTrackRecord({
    track: buildPersistedTrackSnapshot(track),
    playedAt,
  });

  if (!nextRecord) {
    throw new Error('无法保存无效的最近播放记录');
  }

  if (shouldUseRemoteMusicProfileStorage()) {
    await ensureMusicProfileStoreHydrated();

    const previousTracks = readCachedMusicRecentTracks();
    const nextTracks = upsertMusicRecentTrackRecord(previousTracks, nextRecord);
    writeLocalJsonValue(LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY, nextTracks);
    dispatchMusicProfileUpdate('musicRecentTracksUpdated', nextTracks);

    try {
      await postRemoteProfilePayload(MUSIC_PROFILE_API_PATHS.recentTracks, {
        track: nextRecord,
      });
    } catch (error) {
      writeLocalJsonValue(
        LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY,
        previousTracks
      );
      dispatchMusicProfileUpdate('musicRecentTracksUpdated', previousTracks);
      throw error;
    }

    return nextTracks;
  }

  const currentTracks = await getMusicRecentTracks();
  const nextTracks = upsertMusicRecentTrackRecord(
    currentTracks,
    nextRecord
  ).slice(0, MAX_RECENT_TRACKS);
  writeLocalJsonValue(LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY, nextTracks);
  dispatchMusicProfileUpdate('musicRecentTracksUpdated', nextTracks);

  return nextTracks;
}

export async function clearAllMusicRecentTracks(): Promise<void> {
  if (shouldUseRemoteMusicProfileStorage() && !isProfileApiAuthPending()) {
    await ensureMusicProfileStoreHydrated();

    const previousTracks = readCachedMusicRecentTracks();
    writeLocalJsonValue(LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY, []);
    dispatchMusicProfileUpdate('musicRecentTracksUpdated', []);

    try {
      await deleteRemoteProfileResource(
        MUSIC_PROFILE_API_PATHS.recentTracks,
        undefined,
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
    } catch (error) {
      writeLocalJsonValue(
        LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY,
        previousTracks
      );
      dispatchMusicProfileUpdate('musicRecentTracksUpdated', previousTracks);
      throw error;
    }

    return;
  }

  clearLocalJsonValue(LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY);
  dispatchMusicProfileUpdate('musicRecentTracksUpdated', []);
}

export async function getAllMusicPlayRecords(): Promise<
  Record<string, MusicPlayRecord>
> {
  if (shouldUseRemoteMusicProfileStorage()) {
    if (isProfileApiAuthPending()) {
      return {};
    }

    try {
      await ensureMusicProfileStoreHydrated();
      const records = await fetchMusicPlayRecordsFromApi();
      writeLocalJsonValue(LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY, records);
      return records;
    } catch (error) {
      logMusicProfileFailure('读取桌面本地音乐播放记录失败:', error);
      return readCachedMusicPlayRecords();
    }
  }

  return readCachedMusicPlayRecords();
}

export async function saveMusicPlayRecord(
  track: MusicTrackEntity,
  params: {
    playedAt?: number;
    playTimeMs: number;
    durationMs: number;
    completed?: boolean;
  }
): Promise<MusicPlayRecord> {
  const key = buildMusicProfileKey(track.source, track.id);
  const nextRecord = sanitizeMusicPlayRecord({
    track: buildPersistedTrackSnapshot(track),
    playedAt: params.playedAt,
    playTimeMs: params.playTimeMs,
    durationMs: params.durationMs,
    completed: params.completed,
  });

  if (!nextRecord) {
    throw new Error('无法保存无效的音乐播放记录');
  }

  if (shouldUseRemoteMusicProfileStorage()) {
    await ensureMusicProfileStoreHydrated();

    const previousRecords = readCachedMusicPlayRecords();
    const nextRecords = {
      ...previousRecords,
      [key]: nextRecord,
    };

    writeLocalJsonValue(LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY, nextRecords);
    dispatchMusicProfileUpdate('musicPlayRecordsUpdated', nextRecords);

    try {
      await postRemoteProfilePayload(MUSIC_PROFILE_API_PATHS.playRecords, {
        key,
        record: nextRecord,
      });
    } catch (error) {
      writeLocalJsonValue(
        LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY,
        previousRecords
      );
      dispatchMusicProfileUpdate('musicPlayRecordsUpdated', previousRecords);
      throw error;
    }

    return nextRecord;
  }

  const nextRecords = await getAllMusicPlayRecords();
  nextRecords[key] = nextRecord;
  writeLocalJsonValue(LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY, nextRecords);
  dispatchMusicProfileUpdate('musicPlayRecordsUpdated', nextRecords);

  return nextRecord;
}

export async function clearAllMusicPlayRecords(): Promise<void> {
  if (shouldUseRemoteMusicProfileStorage() && !isProfileApiAuthPending()) {
    await ensureMusicProfileStoreHydrated();

    const previousRecords = readCachedMusicPlayRecords();
    writeLocalJsonValue(LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY, {});
    dispatchMusicProfileUpdate('musicPlayRecordsUpdated', {});

    try {
      await deleteRemoteProfileResource(
        MUSIC_PROFILE_API_PATHS.playRecords,
        undefined,
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
    } catch (error) {
      writeLocalJsonValue(
        LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY,
        previousRecords
      );
      dispatchMusicProfileUpdate('musicPlayRecordsUpdated', previousRecords);
      throw error;
    }

    return;
  }

  clearLocalJsonValue(LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY);
  dispatchMusicProfileUpdate('musicPlayRecordsUpdated', {});
}
