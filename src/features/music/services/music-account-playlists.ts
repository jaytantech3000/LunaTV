import type {
  MusicCollectionKind,
  MusicCollectionSummaryEntity,
  MusicSourceKey,
} from '../domain/entities';

interface MusicApiErrorPayload {
  error?: string;
}

class MusicAccountPlaylistsApiClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MusicAccountPlaylistsApiClientError';
    this.status = status;
  }
}

function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMusicApiErrorPayload(value: unknown): value is MusicApiErrorPayload {
  return isRecord(value) && 'error' in value;
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

function resolveMusicSourceKey(value: unknown): MusicSourceKey | null {
  return value === 'netease' ? value : null;
}

function resolveMusicCollectionKind(
  value: unknown
): MusicCollectionKind | null {
  return value === 'playlist' ||
    value === 'album' ||
    value === 'rank' ||
    value === 'artist-toplist'
    ? value
    : null;
}

function resolveOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function resolveAccountPlaylistRole(
  value: unknown
): MusicCollectionSummaryEntity['accountPlaylistRole'] {
  return value === 'owned' || value === 'subscribed' ? value : undefined;
}

function normalizePlaylistId(playlistId: string): string {
  const normalizedPlaylistId = normalizeOptionalText(playlistId);

  if (!normalizedPlaylistId) {
    throw new MusicAccountPlaylistsApiClientError('playlistId 不能为空', 400);
  }

  return normalizedPlaylistId;
}

function sanitizeMusicCollectionSummary(
  value: unknown
): MusicCollectionSummaryEntity | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeOptionalText(
    typeof value.id === 'string' ? value.id : undefined
  );
  const source = resolveMusicSourceKey(value.source);
  const kind = resolveMusicCollectionKind(value.kind);
  const title = normalizeOptionalText(
    typeof value.title === 'string' ? value.title : undefined
  );

  if (!id || !source || !kind || !title) {
    return null;
  }

  return {
    id,
    source,
    kind,
    title,
    coverUrl: normalizeOptionalText(
      typeof value.coverUrl === 'string' ? value.coverUrl : undefined
    ),
    description: normalizeOptionalText(
      typeof value.description === 'string' ? value.description : undefined
    ),
    trackCount: resolveOptionalNumber(value.trackCount),
    accentColor: normalizeOptionalText(
      typeof value.accentColor === 'string' ? value.accentColor : undefined
    ),
    accountPlaylistRole: resolveAccountPlaylistRole(value.accountPlaylistRole),
  };
}

function normalizeMusicAccountPlaylists(
  payload: unknown
): MusicCollectionSummaryEntity[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((entry) => {
    const summary = sanitizeMusicCollectionSummary(entry);
    return summary ? [summary] : [];
  });
}

function buildMusicAccountPlaylistsPath(): string {
  return '/api/music/account/playlists/subscriptions?source=netease';
}

async function fetchMusicAccountPlaylistsJson<T>(
  init: RequestInit,
  fallbackMessage: string
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(buildMusicAccountPlaylistsPath(), {
      cache: 'no-store',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    throw new MusicAccountPlaylistsApiClientError(
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
    throw new MusicAccountPlaylistsApiClientError(
      error instanceof Error
        ? `${fallbackMessage}: ${error.message}`
        : fallbackMessage,
      502
    );
  }

  if (!response.ok) {
    throw new MusicAccountPlaylistsApiClientError(
      resolveMusicApiErrorMessage(payload, fallbackMessage),
      response.status
    );
  }

  return payload as T;
}

export async function subscribeMusicAccountPlaylist(
  playlistId: string
): Promise<MusicCollectionSummaryEntity[]> {
  const payload = await fetchMusicAccountPlaylistsJson<unknown[]>(
    {
      method: 'POST',
      body: JSON.stringify({
        playlistId: normalizePlaylistId(playlistId),
      }),
    },
    '收藏歌单失败'
  );

  return normalizeMusicAccountPlaylists(payload);
}

export async function unsubscribeMusicAccountPlaylist(
  playlistId: string
): Promise<MusicCollectionSummaryEntity[]> {
  const payload = await fetchMusicAccountPlaylistsJson<unknown[]>(
    {
      method: 'DELETE',
      body: JSON.stringify({
        playlistId: normalizePlaylistId(playlistId),
      }),
    },
    '取消收藏歌单失败'
  );

  return normalizeMusicAccountPlaylists(payload);
}
