import { apiFetch } from '@/lib/transport/api-client';

import type { MusicRecentTrackRecord } from './music-profile';
import { sanitizeMusicRecentTrackRecord } from './music-profile-records';

interface MusicApiErrorPayload {
  error?: string;
}

class MusicRecentTracksApiClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MusicRecentTracksApiClientError';
    this.status = status;
  }
}

function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildMusicRecentTracksPath(): string {
  return '/api/music/account/recent-tracks?source=netease';
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
    throw new MusicRecentTracksApiClientError('trackId 不能为空', 400);
  }

  return normalizedTrackId;
}

function normalizeMusicRecentTrackRecords(
  payload: unknown
): MusicRecentTrackRecord[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const playedAtBase = Date.now();

  return payload.flatMap((track, index) => {
    const record = sanitizeMusicRecentTrackRecord({
      track,
      playedAt: playedAtBase - index,
    });

    return record ? [record] : [];
  });
}

async function fetchMusicRecentTracksJson<T>(
  init: RequestInit,
  fallbackMessage: string
): Promise<T> {
  let response: Response;

  try {
    response = await apiFetch(buildMusicRecentTracksPath(), {
      cache: 'no-store',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    throw new MusicRecentTracksApiClientError(
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
    throw new MusicRecentTracksApiClientError(
      error instanceof Error
        ? `${fallbackMessage}: ${error.message}`
        : fallbackMessage,
      502
    );
  }

  if (!response.ok) {
    throw new MusicRecentTracksApiClientError(
      resolveMusicApiErrorMessage(payload, fallbackMessage),
      response.status
    );
  }

  return payload as T;
}

export async function listMusicRecentTracks(): Promise<
  MusicRecentTrackRecord[]
> {
  const payload = await fetchMusicRecentTracksJson<unknown[]>(
    {
      method: 'GET',
    },
    '获取最近播放失败'
  );

  return normalizeMusicRecentTrackRecords(payload);
}

export async function reportMusicTrackPlayed(
  trackId: string
): Promise<MusicRecentTrackRecord[]> {
  const payload = await fetchMusicRecentTracksJson<unknown[]>(
    {
      method: 'POST',
      body: JSON.stringify({
        trackId: normalizeTrackId(trackId),
      }),
    },
    '上报最近播放失败'
  );

  return normalizeMusicRecentTrackRecords(payload);
}
