import { sanitizeMusicFavoriteRecord } from './music-profile-records';
import type { MusicFavoriteRecord } from './music-profile';

interface MusicApiErrorPayload {
  error?: string;
}

class MusicLikedTracksApiClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MusicLikedTracksApiClientError';
    this.status = status;
  }
}

function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildMusicLikedTracksPath(): string {
  return '/api/music/account/likes?source=netease';
}

function isMusicApiErrorPayload(value: unknown): value is MusicApiErrorPayload {
  return typeof value === 'object' && value !== null && 'error' in value;
}

function resolveMusicApiErrorMessage(
  payload: unknown,
  fallbackMessage: string
): string {
  if (!isMusicApiErrorPayload(payload)) {
    return fallbackMessage;
  }

  return normalizeOptionalText(payload.error) || fallbackMessage;
}

function normalizeTrackId(trackId: string): string {
  const normalizedTrackId = normalizeOptionalText(trackId);

  if (!normalizedTrackId) {
    throw new MusicLikedTracksApiClientError('trackId 不能为空', 400);
  }

  return normalizedTrackId;
}

function normalizeMusicLikedTrackRecords(
  payload: unknown
): MusicFavoriteRecord[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const savedAtBase = Date.now();

  return payload.flatMap((track, index) => {
    const record = sanitizeMusicFavoriteRecord({
      track,
      savedAt: savedAtBase - index,
    });

    return record ? [record] : [];
  });
}

async function fetchMusicLikedTracksJson<T>(
  init: RequestInit,
  fallbackMessage: string
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(buildMusicLikedTracksPath(), {
      cache: 'no-store',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    throw new MusicLikedTracksApiClientError(
      error instanceof Error
        ? `${fallbackMessage}: ${error.message}`
        : fallbackMessage,
      502
    );
  }

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch (error) {
    throw new MusicLikedTracksApiClientError(
      error instanceof Error
        ? `${fallbackMessage}: ${error.message}`
        : fallbackMessage,
      502
    );
  }

  if (!response.ok) {
    throw new MusicLikedTracksApiClientError(
      resolveMusicApiErrorMessage(payload, fallbackMessage),
      response.status
    );
  }

  return payload as T;
}

export async function listMusicLikedTracks(): Promise<MusicFavoriteRecord[]> {
  const payload = await fetchMusicLikedTracksJson<unknown[]>(
    {
      method: 'GET',
    },
    '获取喜欢歌曲失败'
  );

  return normalizeMusicLikedTrackRecords(payload);
}

export async function likeMusicTrack(
  trackId: string
): Promise<MusicFavoriteRecord[]> {
  const payload = await fetchMusicLikedTracksJson<unknown[]>(
    {
      method: 'POST',
      body: JSON.stringify({
        trackId: normalizeTrackId(trackId),
      }),
    },
    '收藏歌曲失败'
  );

  return normalizeMusicLikedTrackRecords(payload);
}

export async function unlikeMusicTrack(
  trackId: string
): Promise<MusicFavoriteRecord[]> {
  const payload = await fetchMusicLikedTracksJson<unknown[]>(
    {
      method: 'DELETE',
      body: JSON.stringify({
        trackId: normalizeTrackId(trackId),
      }),
    },
    '取消收藏歌曲失败'
  );

  return normalizeMusicLikedTrackRecords(payload);
}
