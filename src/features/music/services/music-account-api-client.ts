import { apiFetch } from '@/lib/transport/api-client';

import type {
  LiveMusicSourceKey,
  MusicAccountEntity,
  MusicAccountQrPollEntity,
  MusicAccountQrSessionEntity,
} from '../domain/entities';

interface MusicApiErrorPayload {
  error?: string;
}

class MusicAccountApiClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MusicAccountApiClientError';
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

function buildMusicAccountPath(source: LiveMusicSourceKey): string {
  return `/api/music/account?source=${source}`;
}

function buildMusicAccountQrPath(
  source: LiveMusicSourceKey,
  key?: string
): string {
  const url = new URL('/api/music/account/qr', 'http://localhost');
  url.searchParams.set('source', source);

  if (key?.trim()) {
    url.searchParams.set('key', key.trim());
  }

  return `${url.pathname}${url.search}`;
}

async function fetchMusicAccountJson<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string
): Promise<T> {
  let response: Response;

  try {
    response = await apiFetch(path, {
      cache: 'no-store',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    throw new MusicAccountApiClientError(
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
    throw new MusicAccountApiClientError(
      error instanceof Error
        ? `${fallbackMessage}: ${error.message}`
        : fallbackMessage,
      502
    );
  }

  if (!response.ok) {
    throw new MusicAccountApiClientError(
      resolveMusicApiErrorMessage(payload, fallbackMessage),
      response.status
    );
  }

  return payload as T;
}

export async function fetchMusicAccountState(
  source: LiveMusicSourceKey
): Promise<MusicAccountEntity> {
  return fetchMusicAccountJson<MusicAccountEntity>(
    buildMusicAccountPath(source),
    {
      method: 'GET',
    },
    '获取网易云账号失败'
  );
}

export async function connectMusicAccountSession(params: {
  source: LiveMusicSourceKey;
  cookie: string;
}): Promise<MusicAccountEntity> {
  return fetchMusicAccountJson<MusicAccountEntity>(
    buildMusicAccountPath(params.source),
    {
      method: 'POST',
      body: JSON.stringify({
        cookie: params.cookie,
      }),
    },
    '连接网易云账号失败'
  );
}

export async function disconnectMusicAccountSession(
  source: LiveMusicSourceKey
): Promise<MusicAccountEntity> {
  return fetchMusicAccountJson<MusicAccountEntity>(
    buildMusicAccountPath(source),
    {
      method: 'DELETE',
    },
    '退出网易云账号失败'
  );
}

export async function createMusicAccountQrSession(
  source: LiveMusicSourceKey
): Promise<MusicAccountQrSessionEntity> {
  return fetchMusicAccountJson<MusicAccountQrSessionEntity>(
    buildMusicAccountQrPath(source),
    {
      method: 'POST',
    },
    '创建网易云二维码失败'
  );
}

export async function pollMusicAccountQrSession(
  source: LiveMusicSourceKey,
  key: string
): Promise<MusicAccountQrPollEntity> {
  return fetchMusicAccountJson<MusicAccountQrPollEntity>(
    buildMusicAccountQrPath(source, key),
    {
      method: 'GET',
    },
    '获取网易云二维码状态失败'
  );
}
