import {
  type MusicCollection,
  type MusicHomePayload,
  type MusicLyricPayload,
  type MusicPlatformKey,
  type MusicPlaybackQuality,
  type MusicSearchPayload,
  type MusicSource,
  type MusicTrackPayload,
} from '@/lib/music/types';

import { apiFetch } from './api-client';
import { getApiBaseUrl } from './endpoint';

async function parseJsonResponse<T>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  if (!response.ok) {
    let errorMessage = fallbackMessage;

    try {
      const payload = (await response.json()) as unknown;
      if (
        payload &&
        typeof payload === 'object' &&
        'error' in payload &&
        typeof payload.error === 'string'
      ) {
        errorMessage = payload.error;
      }
    } catch {
      // Ignore invalid error payloads and fall back to the caller-provided copy.
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function buildMusicStreamUrl(params: {
  source: MusicPlatformKey;
  id: string;
  quality?: MusicPlaybackQuality;
}): string {
  const baseUrl = normalizeBaseUrl(getApiBaseUrl());
  const query = new URLSearchParams({
    source: params.source,
    id: params.id,
    quality: params.quality || 'standard',
  });

  return `${baseUrl}/media/audio/stream?${query.toString()}`;
}

export async function fetchMusicSources(): Promise<MusicSource[]> {
  const result = await parseJsonResponse<{
    sources?: MusicSource[];
  }>(await apiFetch('/music/sources', { cache: 'no-store' }), '获取音乐源失败');

  return result.sources || [];
}

export async function fetchMusicHome(
  source: MusicPlatformKey
): Promise<MusicHomePayload> {
  return parseJsonResponse<MusicHomePayload>(
    await apiFetch('/music/home', {
      cache: 'no-store',
      searchParams: {
        source,
      },
    }),
    '获取音乐首页失败'
  );
}

export async function searchMusic(params: {
  source: MusicPlatformKey;
  query: string;
  page?: number;
}): Promise<MusicSearchPayload> {
  return parseJsonResponse<MusicSearchPayload>(
    await apiFetch('/music/search', {
      cache: 'no-store',
      searchParams: {
        source: params.source,
        q: params.query,
        page: params.page || 1,
      },
    }),
    '搜索音乐失败'
  );
}

export async function fetchMusicCollection(params: {
  source: MusicPlatformKey;
  id: string;
}): Promise<MusicCollection> {
  return parseJsonResponse<MusicCollection>(
    await apiFetch('/music/collection', {
      cache: 'no-store',
      searchParams: {
        source: params.source,
        id: params.id,
      },
    }),
    '获取音乐合集失败'
  );
}

export async function fetchMusicTrack(params: {
  source: MusicPlatformKey;
  id: string;
  quality?: MusicPlaybackQuality;
}): Promise<MusicTrackPayload> {
  return parseJsonResponse<MusicTrackPayload>(
    await apiFetch('/music/track', {
      cache: 'no-store',
      searchParams: {
        source: params.source,
        id: params.id,
        quality: params.quality || 'standard',
      },
    }),
    '获取曲目信息失败'
  );
}

export async function fetchMusicLyric(params: {
  source: MusicPlatformKey;
  id: string;
}): Promise<MusicLyricPayload> {
  return parseJsonResponse<MusicLyricPayload>(
    await apiFetch('/music/lyric', {
      cache: 'no-store',
      searchParams: {
        source: params.source,
        id: params.id,
      },
    }),
    '获取歌词失败'
  );
}
