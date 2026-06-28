import { NextRequest } from 'next/server';

import { readMusicAccountSessionCookie } from '@/features/music/services/music-account-session';
import {
  createMusicErrorResponse,
  createMusicJsonResponse,
  getMusicProviderContext,
} from '@/features/music/services/music-route-support';
import { NeteaseApiError } from '@/features/music/services/providers/netease/client';

export const runtime = 'nodejs';

function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

async function readPlaylistIdFromRequest(request: NextRequest): Promise<string> {
  let requestBody: unknown;

  try {
    requestBody = await request.json();
  } catch {
    throw new NeteaseApiError('请求体必须是 JSON', 400);
  }

  if (!requestBody || typeof requestBody !== 'object') {
    throw new NeteaseApiError('请求体必须包含 playlistId', 400);
  }

  const playlistId =
    'playlistId' in requestBody && typeof requestBody.playlistId === 'string'
      ? normalizeOptionalText(requestBody.playlistId)
      : undefined;

  if (!playlistId) {
    throw new NeteaseApiError('请求体必须包含 playlistId', 400);
  }

  return playlistId;
}

function readSessionCookie(request: NextRequest, fallbackMessage: string) {
  const sessionCookie = readMusicAccountSessionCookie(request);

  if (!sessionCookie?.trim()) {
    throw new NeteaseApiError(fallbackMessage, 401);
  }

  return sessionCookie;
}

export async function POST(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const sessionCookie = readSessionCookie(
      request,
      '未连接网易云账号，无法收藏歌单'
    );
    const playlistId = await readPlaylistIdFromRequest(request);
    const payload = await repository.accountRepository.setPlaylistSubscribed(
      source,
      playlistId,
      true,
      {
        sessionCookie,
      }
    );

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '收藏歌单失败');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const sessionCookie = readSessionCookie(
      request,
      '未连接网易云账号，无法取消收藏歌单'
    );
    const playlistId = await readPlaylistIdFromRequest(request);
    const payload = await repository.accountRepository.setPlaylistSubscribed(
      source,
      playlistId,
      false,
      {
        sessionCookie,
      }
    );

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '取消收藏歌单失败');
  }
}
