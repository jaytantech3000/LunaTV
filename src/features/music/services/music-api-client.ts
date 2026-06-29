import { apiFetch } from '@/lib/transport/api-client';

import type {
  LiveMusicSourceKey,
  LyricDocumentEntity,
  MusicCollectionEntity,
  MusicCollectionKind,
  MusicHomeView,
  MusicPlaybackQuality,
  MusicSearchResultEntity,
  MusicTrackEntity,
  MusicTrackPlaybackEntity,
} from '../domain/entities';

interface MusicApiErrorPayload {
  error?: string;
}

class MusicApiClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MusicApiClientError';
    this.status = status;
  }
}

function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
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

function buildMusicApiPath(
  pathname: string,
  searchParams: Record<string, string | undefined>
): string {
  const query = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
    const normalizedValue = normalizeOptionalText(value);

    if (normalizedValue) {
      query.set(key, normalizedValue);
    }
  });

  const queryString = query.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

async function fetchMusicJson<T>(
  pathname: string,
  searchParams: Record<string, string | undefined>,
  fallbackMessage: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: unknown;
  }
): Promise<T> {
  let response: Response;

  try {
    response = await apiFetch(buildMusicApiPath(pathname, searchParams), {
      cache: 'no-store',
      method: options?.method || 'GET',
      headers: options?.body
        ? {
            'Content-Type': 'application/json; charset=utf-8',
          }
        : undefined,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    throw new MusicApiClientError(
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
    throw new MusicApiClientError(
      error instanceof Error
        ? `${fallbackMessage}: ${error.message}`
        : fallbackMessage,
      502
    );
  }

  if (!response.ok) {
    throw new MusicApiClientError(
      resolveMusicApiErrorMessage(payload, fallbackMessage),
      response.status
    );
  }

  return payload as T;
}

export async function fetchMusicHomeView(
  source: LiveMusicSourceKey
): Promise<MusicHomeView> {
  return fetchMusicJson<MusicHomeView>(
    '/api/music/home',
    {
      source,
    },
    '获取音乐首页失败'
  );
}

export async function searchMusicCatalog(params: {
  source: LiveMusicSourceKey;
  query: string;
  page?: number;
}): Promise<MusicSearchResultEntity> {
  return fetchMusicJson<MusicSearchResultEntity>(
    '/api/music/search',
    {
      source: params.source,
      q: params.query,
      page:
        typeof params.page === 'number' && params.page > 0
          ? String(params.page)
          : undefined,
    },
    '搜索音乐失败'
  );
}

export async function fetchMusicCollectionDetail(params: {
  source: LiveMusicSourceKey;
  id: string;
  kind?: MusicCollectionKind;
}): Promise<MusicCollectionEntity> {
  return fetchMusicJson<MusicCollectionEntity>(
    '/api/music/collection',
    {
      source: params.source,
      id: params.id,
      kind: params.kind,
    },
    '获取音乐合集失败'
  );
}

export async function fetchMusicTrackPlayback(params: {
  source: LiveMusicSourceKey;
  id: string;
  quality?: MusicPlaybackQuality;
}): Promise<MusicTrackPlaybackEntity> {
  return fetchMusicJson<MusicTrackPlaybackEntity>(
    '/api/music/track',
    {
      source: params.source,
      id: params.id,
      quality: params.quality,
    },
    '获取曲目信息失败'
  );
}

export async function fetchMusicLyricDocument(params: {
  source: LiveMusicSourceKey;
  id: string;
}): Promise<LyricDocumentEntity> {
  return fetchMusicJson<LyricDocumentEntity>(
    '/api/music/lyric',
    {
      source: params.source,
      id: params.id,
    },
    '获取歌词失败'
  );
}

export async function fetchMusicPersonalFmTracks(params: {
  source: LiveMusicSourceKey;
}): Promise<MusicTrackEntity[]> {
  return fetchMusicJson<MusicTrackEntity[]>(
    '/api/music/fm',
    {
      source: params.source,
    },
    '获取私人 FM 失败'
  );
}

export async function trashMusicPersonalFmTrack(params: {
  source: LiveMusicSourceKey;
  trackId: string;
}): Promise<MusicTrackEntity[]> {
  return fetchMusicJson<MusicTrackEntity[]>(
    '/api/music/fm',
    {
      source: params.source,
    },
    '操作私人 FM 失败',
    {
      method: 'POST',
      body: {
        action: 'trash',
        trackId: params.trackId,
      },
    }
  );
}
