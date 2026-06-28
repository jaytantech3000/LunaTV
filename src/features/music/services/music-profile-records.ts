import type { MusicSourceKey, MusicTrackEntity } from '../domain/entities';

export interface MusicFavoriteRecord {
  track: MusicTrackEntity;
  savedAt: number;
}

export interface MusicRecentTrackRecord {
  track: MusicTrackEntity;
  playedAt: number;
}

export interface MusicPlayRecord {
  track: MusicTrackEntity;
  playedAt: number;
  playTimeMs: number;
  durationMs: number;
  completed: boolean;
}

export const MAX_RECENT_TRACKS = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveMusicSourceKey(value: unknown): MusicSourceKey | null {
  return value === 'netease' ? value : null;
}

function resolveNonNegativeNumber(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return value;
}

function resolvePositiveTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return Date.now();
  }

  return value;
}

function sanitizeArtists(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((artist): artist is string => typeof artist === 'string')
    .map((artist) => artist.trim())
    .filter(Boolean);
}

function sanitizeMusicTrackEntity(value: unknown): MusicTrackEntity | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const source = resolveMusicSourceKey(value.source);
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const artists = sanitizeArtists(value.artists);

  if (!id || !source || !title || artists.length === 0) {
    return null;
  }

  const album = typeof value.album === 'string' ? value.album.trim() : '';
  const coverUrl =
    typeof value.coverUrl === 'string' ? value.coverUrl.trim() : '';

  return {
    id,
    source,
    title,
    artists,
    album,
    coverUrl,
    durationMs: resolveNonNegativeNumber(value.durationMs),
    stream: '',
    playable: typeof value.playable === 'boolean' ? value.playable : true,
  };
}

function sanitizeLegacyTrackEntity(value: unknown): MusicTrackEntity | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.trackId === 'string' ? value.trackId.trim() : '';
  const source = resolveMusicSourceKey(value.source);
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const artistsText =
    typeof value.artistsText === 'string' ? value.artistsText : '';
  const artists = artistsText
    .split('/')
    .map((artist) => artist.trim())
    .filter(Boolean);

  if (!id || !source || !title || artists.length === 0) {
    return null;
  }

  const album = typeof value.albumTitle === 'string' ? value.albumTitle : '';
  const coverUrl = typeof value.cover === 'string' ? value.cover : '';

  return {
    id,
    source,
    title,
    artists,
    album: album.trim(),
    coverUrl: coverUrl.trim(),
    durationMs: resolveNonNegativeNumber(value.durationMs),
    stream: '',
    playable: true,
  };
}

export function sanitizeTrackSnapshot(value: unknown): MusicTrackEntity | null {
  if (!isRecord(value)) {
    return null;
  }

  return (
    sanitizeMusicTrackEntity(value.track) ??
    sanitizeMusicTrackEntity(value) ??
    sanitizeLegacyTrackEntity(value.track) ??
    sanitizeLegacyTrackEntity(value)
  );
}

export function sanitizeMusicFavoriteRecord(
  value: unknown
): MusicFavoriteRecord | null {
  const track = sanitizeTrackSnapshot(value);

  if (!track || !isRecord(value)) {
    return null;
  }

  return {
    track,
    savedAt: resolvePositiveTimestamp(value.savedAt),
  };
}

export function sanitizeMusicRecentTrackRecord(
  value: unknown
): MusicRecentTrackRecord | null {
  const track = sanitizeTrackSnapshot(value);

  if (!track || !isRecord(value)) {
    return null;
  }

  return {
    track,
    playedAt: resolvePositiveTimestamp(value.playedAt),
  };
}

export function sanitizeMusicPlayRecord(
  value: unknown
): MusicPlayRecord | null {
  const track = sanitizeTrackSnapshot(value);

  if (!track || !isRecord(value)) {
    return null;
  }

  const durationMs = resolveNonNegativeNumber(
    value.durationMs,
    track.durationMs
  );
  const playTimeMs = resolveNonNegativeNumber(value.playTimeMs);
  const completed =
    typeof value.completed === 'boolean'
      ? value.completed
      : durationMs > 0 && Math.abs(durationMs - playTimeMs) <= 1000;

  return {
    track: {
      ...track,
      durationMs,
    },
    playedAt: resolvePositiveTimestamp(value.playedAt),
    playTimeMs,
    durationMs,
    completed,
  };
}

export function sanitizeMusicFavoriteRecordMap(
  value: Record<string, unknown>
): Record<string, MusicFavoriteRecord> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, record]) => {
      const nextRecord = sanitizeMusicFavoriteRecord(record);
      return nextRecord ? [[key, nextRecord] as const] : [];
    })
  );
}

export function sanitizeMusicRecentTrackRecordList(
  value: unknown[]
): MusicRecentTrackRecord[] {
  return value
    .map((entry) => sanitizeMusicRecentTrackRecord(entry))
    .filter((entry): entry is MusicRecentTrackRecord => Boolean(entry))
    .sort(sortMusicRecordsByPlayedAt)
    .slice(0, MAX_RECENT_TRACKS);
}

export function sanitizeMusicPlayRecordMap(
  value: Record<string, unknown>
): Record<string, MusicPlayRecord> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, record]) => {
      const nextRecord = sanitizeMusicPlayRecord(record);
      return nextRecord ? [[key, nextRecord] as const] : [];
    })
  );
}

export function buildMusicProfileKey(
  source: MusicSourceKey,
  trackId: string
): string {
  return `${source}+${trackId}`;
}

export function buildPersistedTrackSnapshot(
  track: MusicTrackEntity
): MusicTrackEntity {
  return {
    ...track,
    stream: '',
  };
}

export function sortMusicFavoritesBySavedAt(
  left: MusicFavoriteRecord,
  right: MusicFavoriteRecord
): number {
  return right.savedAt - left.savedAt;
}

export function sortMusicRecordsByPlayedAt(
  left: MusicRecentTrackRecord | MusicPlayRecord,
  right: MusicRecentTrackRecord | MusicPlayRecord
): number {
  return right.playedAt - left.playedAt;
}

export function upsertMusicRecentTrackRecord(
  records: MusicRecentTrackRecord[],
  nextRecord: MusicRecentTrackRecord
): MusicRecentTrackRecord[] {
  const key = buildMusicProfileKey(
    nextRecord.track.source,
    nextRecord.track.id
  );

  return [
    nextRecord,
    ...records.filter(
      (entry) =>
        buildMusicProfileKey(entry.track.source, entry.track.id) !== key
    ),
  ]
    .sort(sortMusicRecordsByPlayedAt)
    .slice(0, MAX_RECENT_TRACKS);
}
