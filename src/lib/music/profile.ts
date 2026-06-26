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

const LOCAL_MUSIC_FAVORITES_STORAGE_KEY = 'moontv_music_favorites';
const LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY = 'moontv_music_recent_tracks';
const LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY = 'moontv_music_play_records';
const MAX_RECENT_TRACKS = 16;

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
  const raw = readLocalJsonValue<Record<string, unknown>>(
    LOCAL_MUSIC_FAVORITES_STORAGE_KEY,
    {}
  );
  const entries = Object.entries(raw).flatMap(([key, value]) => {
    const record = sanitizeFavoriteRecord(value);
    return record ? [[key, record] as const] : [];
  });

  return Object.fromEntries(entries);
}

export async function getMusicFavoritesList(): Promise<MusicFavoriteRecord[]> {
  return Object.values(await getAllMusicFavorites()).sort(sortBySavedAt);
}

export async function saveMusicFavorite(
  track: PlayerQueueItem,
  savedAt = Date.now()
): Promise<MusicFavoriteRecord> {
  const key = buildMusicProfileKey(track.source, track.trackId);
  const nextFavorites = await getAllMusicFavorites();
  const nextRecord: MusicFavoriteRecord = {
    ...track,
    savedAt,
  };

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
  const raw = readLocalJsonValue<unknown[]>(
    LOCAL_MUSIC_RECENT_TRACKS_STORAGE_KEY,
    []
  );

  return raw
    .map((value) => sanitizeRecentTrackRecord(value))
    .filter((value): value is MusicRecentTrackRecord => Boolean(value))
    .sort(sortByPlayedAt)
    .slice(0, MAX_RECENT_TRACKS);
}

export async function saveMusicRecentTrack(
  track: PlayerQueueItem,
  playedAt = Date.now()
): Promise<MusicRecentTrackRecord[]> {
  const key = buildMusicProfileKey(track.source, track.trackId);
  const currentTracks = await getMusicRecentTracks();
  const nextTracks = [
    {
      ...track,
      playedAt,
    },
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
  const raw = readLocalJsonValue<Record<string, unknown>>(
    LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY,
    {}
  );
  const entries = Object.entries(raw).flatMap(([key, value]) => {
    const record = sanitizePlayRecord(value);
    return record ? [[key, record] as const] : [];
  });

  return Object.fromEntries(entries);
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
  const nextRecords = await getAllMusicPlayRecords();
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

  nextRecords[key] = nextRecord;
  writeLocalJsonValue(LOCAL_MUSIC_PLAY_RECORDS_STORAGE_KEY, nextRecords);
  dispatchMusicProfileUpdate('musicPlayRecordsUpdated', nextRecords);

  return nextRecord;
}
