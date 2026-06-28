/* eslint-disable no-console */

import { NeteaseApiError } from './providers/netease/client';
import { createNeteaseRepository } from './providers/netease/repository';
import type { LiveMusicSourceKey } from '../domain/entities';
import type { MusicProviderRepositorySet } from '../domain/repositories';

const DEFAULT_LIVE_SOURCE: LiveMusicSourceKey = 'netease';

function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function createNoStoreHeaders(headersInit?: HeadersInit): Headers {
  const headers = new Headers(headersInit);
  headers.set('Cache-Control', 'no-store');
  return headers;
}

export function createMusicJsonResponse(
  body: unknown,
  init?: ResponseInit
): Response {
  const headers = createNoStoreHeaders(init?.headers);

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function createMusicErrorResponse(
  error: unknown,
  fallbackMessage: string
): Response {
  if (error instanceof NeteaseApiError) {
    if (error.status >= 500) {
      console.error(fallbackMessage, error);
    }

    return createMusicJsonResponse(
      {
        error: error.message,
      },
      {
        status: error.status,
      }
    );
  }

  console.error(fallbackMessage, error);

  return createMusicJsonResponse(
    {
      error: fallbackMessage,
    },
    {
      status: 500,
    }
  );
}

export function resolveLiveMusicSource(
  source: string | null | undefined
): LiveMusicSourceKey {
  const normalized = normalizeOptionalText(source) || DEFAULT_LIVE_SOURCE;

  if (normalized !== DEFAULT_LIVE_SOURCE) {
    throw new NeteaseApiError('Unsupported music source', 400);
  }

  return DEFAULT_LIVE_SOURCE;
}

export function getMusicProviderContext(source: string | null | undefined): {
  source: LiveMusicSourceKey;
  repository: MusicProviderRepositorySet;
} {
  const resolvedSource = resolveLiveMusicSource(source);

  return {
    source: resolvedSource,
    repository: createNeteaseRepository(),
  };
}
