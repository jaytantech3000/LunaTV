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
import { isDesktopLocalProfileRuntime } from '@/lib/profile/runtime';

import type { MusicTrack, PlayerQueueItem } from './types';

export interface MusicFavoriteRecord extends PlayerQueueItem {
  savedAt: number;
}

export interface MusicRecentTrackRecord extends PlayerQueueItem {
  playedAt: number;
}

export interface MusicPlayRecord extends PlayerQueueItem {
  playedAt: number;
  playTimeSec: number;
  durationSec: number;
  completed: boolean;
}

export type MusicProfileUpdateEvent =
  | 'musicFavoritesUpdated'
  | 'musicRecentTracksUpdated'
  | 'musicPlayRecordsUpdated';

type MusicProfileMigrationDomain = 'favorites' | 'recentTracks' | 'playRecords';

const LOCAL_MUSIC_FAVORITES_STORAGE_KEY = 'moontv_music_favorites';
const LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY = 'moontv_music_recent_tracks';
const LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY = 'moontv_music_play_records';
const MAX_RECENT_TRACKS = 16;
const MUSIC_PROFILE_MIGRATION_MARKER_PREFIX =
  'lunatv:desktop-local-music-profile-migrated:v1';
const MUSIC_PROFILE_API_PATHS = {
  favorites: '/music/profile/favorites',
  recentTracks: '/music/profile/recent-tracks',
  playRecords: '/music/profile/play-records',
} as const;

let hydrationPromise: Promise<void> | null = null;

function shouldUseDesktopMusicProfileApiStorage(): boolean {
  return isDesktopLocalProfileRuntime();
}

function logMusicProfileFailure(message: string, error: unknown): void {
  // eslint-disable-next-line no-console
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

  localStorage.setItem(storageKey, JSON.stringify(value));
}

function clearLocalJsonValue(storageKey: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(storageKey);
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

function isValidQueueItem(value: unknown): value is PlayerQueueItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PlayerQueueItem>;
  return Boolean(
    typeof candidate.trackId === 'string' &&
      typeof candidate.source === 'string' &&
      typeof candidate.title === 'string' &&
      typeof candidate.artistsText === 'string'
  );
}

function sanitizeFavoriteRecord(value: unknown): MusicFavoriteRecord | null {
  if (!isValidQueueItem(value)) {
    return null;
  }

  const candidate = value as Partial<MusicFavoriteRecord>;
  return {
    ...value,
    savedAt:
      typeof candidate.savedAt === 'number' && candidate.savedAt > 0
        ? candidate.savedAt
        : Date.now(),
  };
}

function sanitizeRecentTrackRecord(
  value: unknown
): MusicRecentTrackRecord | null {
  if (!isValidQueueItem(value)) {
    return null;
  }

  const candidate = value as Partial<MusicRecentTrackRecord>;
  return {
    ...value,
    playedAt:
      typeof candidate.playedAt === 'number' && candidate.playedAt > 0
        ? candidate.playedAt
        : Date.now(),
  };
}

function sanitizePlayRecord(value: unknown): MusicPlayRecord | null {
  if (!isValidQueueItem(value)) {
    return null;
  }

  const candidate = value as Partial<MusicPlayRecord>;
  const playTimeSec =
    typeof candidate.playTimeSec === 'number' && candidate.playTimeSec >= 0
      ? candidate.playTimeSec
      : 0;
  const durationSec =
    typeof candidate.durationSec === 'number' && candidate.durationSec >= 0
      ? candidate.durationSec
      : 0;

  return {
    ...value,
    playedAt:
      typeof candidate.playedAt === 'number' && candidate.playedAt > 0
        ? candidate.playedAt
        : Date.now(),
    playTimeSec,
    durationSec,
    completed: Boolean(
      candidate.completed ||
        (durationSec > 0 && Math.abs(durationSec - playTimeSec) < 1)
    ),
  };
}

function sanitizeFavoriteRecordMap(
  value: Record<string, unknown>
): Record<string, MusicFavoriteRecord> {
  const entries = Object.entries(value).flatMap(([key, record]) => {
    const nextRecord = sanitizeFavoriteRecord(record);
    return nextRecord ? [[key, nextRecord] as const] : [];
  });

  return Object.fromEntries(entries);
}

function sanitizeRecentTrackRecordList(
  value: unknown[]
): MusicRecentTrackRecord[] {
  return value
    .map((entry) => sanitizeRecentTrackRecord(entry))
    .filter((entry): entry is MusicRecentTrackRecord => Boolean(entry))
    .sort(sortByPlayedAt)
    .slice(0, MAX_RECENT_TRACKS);
}

function sanitizePlayRecordMap(
  value: Record<string, unknown>
): Record<string, MusicPlayRecord> {
  const entries = Object.entries(value).flatMap(([key, record]) => {
    const nextRecord = sanitizePlayRecord(record);
    return nextRecord ? [[key, nextRecord] as const] : [];
  });

  return Object.fromEntries(entries);
}

function readCachedMusicFavorites(): Record<string, MusicFavoriteRecord> {
  return sanitizeFavoriteRecordMap(
    readLocalJsonValue<Record<string, unknown>>(
      LOCAL_MUSIC_FAVORITES_STORAGE_KEY,
      {}
    )
  );
}

function readCachedMusicRecentTracks(): MusicRecentTrackRecord[] {
  return sanitizeRecentTrackRecordList(
    readLocalJsonValue<unknown[]>(LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY, [])
  );
}

function readCachedMusicPlayRecords(): Record<string, MusicPlayRecord> {
  return sanitizePlayRecordMap(
    readLocalJsonValue<Record<string, unknown>>(
      LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY,
      {}
    )
  );
}

function sortBySavedAt(
  left: MusicFavoriteRecord,
  right: MusicFavoriteRecord
): number {
  return right.savedAt - left.savedAt;
}

function sortByPlayedAt(
  left: MusicRecentTrackRecord,
  right: MusicRecentTrackRecord
): number {
  return right.playedAt - left.playedAt;
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
    // Swallowing marker persistence errors is acceptable; the migration itself
    // remains source-of-truth safe and can retry later.
  }
}

async function fetchMusicFavoritesFromApi(): Promise<
  Record<string, MusicFavoriteRecord>
> {
  const payload = await fetchRemoteProfileJson<Record<string, unknown>>(
    MUSIC_PROFILE_API_PATHS.favorites,
    PROFILE_API_NO_REDIRECT_OPTIONS
  );

  return sanitizeFavoriteRecordMap(payload);
}

async function fetchMusicRecentTracksFromApi(): Promise<
  MusicRecentTrackRecord[]
> {
  const payload = await fetchRemoteProfileJson<unknown[]>(
    MUSIC_PROFILE_API_PATHS.recentTracks,
    PROFILE_API_NO_REDIRECT_OPTIONS
  );

  return sanitizeRecentTrackRecordList(payload);
}

async function fetchMusicPlayRecordsFromApi(): Promise<
  Record<string, MusicPlayRecord>
> {
  const payload = await fetchRemoteProfileJson<Record<string, unknown>>(
    MUSIC_PROFILE_API_PATHS.playRecords,
    PROFILE_API_NO_REDIRECT_OPTIONS
  );

  return sanitizePlayRecordMap(payload);
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
    remoteTracks.map((track) => [
      buildMusicProfileKey(track.source, track.trackId),
      track,
    ])
  );

  for (const track of [...legacyTracks].reverse()) {
    const key = buildMusicProfileKey(track.source, track.trackId);
    const remoteTrack = remoteTrackMap.get(key);
    if (remoteTrack && remoteTrack.playedAt >= track.playedAt) {
      continue;
    }

    await postRemoteProfilePayload(
      MUSIC_PROFILE_API_PATHS.recentTracks,
      {
        track,
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
      remoteRecord.playTimeSec >= record.playTimeSec &&
      remoteRecord.completed >= record.completed
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

async function ensureDesktopLocalMusicProfileStoreHydrated(): Promise<void> {
  if (
    typeof window === 'undefined' ||
    !shouldUseDesktopMusicProfileApiStorage()
  ) {
    return;
  }

  if (!hydrationPromise) {
    hydrationPromise = hydrateDesktopMusicProfileStore().finally(() => {
      hydrationPromise = null;
    });
  }

  await hydrationPromise;
}

export function buildMusicProfileKey(source: string, trackId: string): string {
  return `${source}+${trackId}`;
}

export function buildMusicTrackFromQueueItem(
  track: PlayerQueueItem
): MusicTrack {
  return {
    id: track.trackId,
    source: track.source,
    title: track.title,
    artists: track.artistsText
      .split(' / ')
      .filter(Boolean)
      .map((name) => ({ name })),
    album: track.albumTitle
      ? {
          title: track.albumTitle,
        }
      : undefined,
    cover: track.cover,
    durationMs: track.durationMs,
    playable: true,
    subtitle: track.subtitle,
  };
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
  if (shouldUseDesktopMusicProfileApiStorage()) {
    if (isProfileApiAuthPending()) {
      return {};
    }

    try {
      await ensureDesktopLocalMusicProfileStoreHydrated();
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
  return Object.values(await getAllMusicFavorites()).sort(sortBySavedAt);
}

export async function saveMusicFavorite(
  track: PlayerQueueItem,
  savedAt = Date.now()
): Promise<MusicFavoriteRecord> {
  const key = buildMusicProfileKey(track.source, track.trackId);
  const nextRecord: MusicFavoriteRecord = {
    ...track,
    savedAt,
  };

  if (shouldUseDesktopMusicProfileApiStorage()) {
    await ensureDesktopLocalMusicProfileStoreHydrated();

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
  source: string,
  trackId: string
): Promise<void> {
  const key = buildMusicProfileKey(source, trackId);

  if (shouldUseDesktopMusicProfileApiStorage()) {
    await ensureDesktopLocalMusicProfileStoreHydrated();

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

export async function isMusicFavorited(
  source: string,
  trackId: string
): Promise<boolean> {
  const favorites = await getAllMusicFavorites();
  return Boolean(favorites[buildMusicProfileKey(source, trackId)]);
}

export async function getMusicRecentTracks(): Promise<
  MusicRecentTrackRecord[]
> {
  if (shouldUseDesktopMusicProfileApiStorage()) {
    if (isProfileApiAuthPending()) {
      return [];
    }

    try {
      await ensureDesktopLocalMusicProfileStoreHydrated();
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
  track: PlayerQueueItem,
  playedAt = Date.now()
): Promise<MusicRecentTrackRecord[]> {
  const key = buildMusicProfileKey(track.source, track.trackId);
  const nextRecord: MusicRecentTrackRecord = {
    ...track,
    playedAt,
  };

  if (shouldUseDesktopMusicProfileApiStorage()) {
    await ensureDesktopLocalMusicProfileStoreHydrated();

    const previousTracks = readCachedMusicRecentTracks();
    const nextTracks = [
      nextRecord,
      ...previousTracks.filter(
        (entry) => buildMusicProfileKey(entry.source, entry.trackId) !== key
      ),
    ].slice(0, MAX_RECENT_TRACKS);
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
  const nextTracks = [
    nextRecord,
    ...currentTracks.filter(
      (entry) => buildMusicProfileKey(entry.source, entry.trackId) !== key
    ),
  ].slice(0, MAX_RECENT_TRACKS);

  writeLocalJsonValue(LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY, nextTracks);
  dispatchMusicProfileUpdate('musicRecentTracksUpdated', nextTracks);

  return nextTracks;
}

export async function getAllMusicPlayRecords(): Promise<
  Record<string, MusicPlayRecord>
> {
  if (shouldUseDesktopMusicProfileApiStorage()) {
    if (isProfileApiAuthPending()) {
      return {};
    }

    try {
      await ensureDesktopLocalMusicProfileStoreHydrated();
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
  track: PlayerQueueItem,
  params: {
    playedAt?: number;
    playTimeSec: number;
    durationSec: number;
    completed?: boolean;
  }
): Promise<MusicPlayRecord> {
  const key = buildMusicProfileKey(track.source, track.trackId);
  const nextRecord = sanitizePlayRecord({
    ...track,
    playedAt: params.playedAt,
    playTimeSec: params.playTimeSec,
    durationSec: params.durationSec,
    completed: params.completed,
  });

  if (!nextRecord) {
    throw new Error('无法保存无效的音乐播放记录');
  }

  if (shouldUseDesktopMusicProfileApiStorage()) {
    await ensureDesktopLocalMusicProfileStoreHydrated();

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
