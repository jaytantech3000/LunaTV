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

async function readTrackIdFromRequest(request: NextRequest): Promise<string> {
  let requestBody: unknown;

  try {
    requestBody = await request.json();
  } catch {
    throw new NeteaseApiError('请求体必须是 JSON', 400);
  }

  if (!requestBody || typeof requestBody !== 'object') {
    throw new NeteaseApiError('请求体必须包含 trackId', 400);
  }

  const trackId =
    'trackId' in requestBody && typeof requestBody.trackId === 'string'
      ? normalizeOptionalText(requestBody.trackId)
      : undefined;

  if (!trackId) {
    throw new NeteaseApiError('请求体必须包含 trackId', 400);
  }

  return trackId;
}

function readSessionCookie(request: NextRequest, fallbackMessage: string) {
  const sessionCookie = readMusicAccountSessionCookie(request);

  if (!sessionCookie?.trim()) {
    throw new NeteaseApiError(fallbackMessage, 401);
  }

  return sessionCookie;
}

export async function GET(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const sessionCookie = readSessionCookie(
      request,
      '未连接网易云账号，无法获取喜欢歌曲'
    );
    const payload = await repository.accountRepository.getLikedTracks(source, {
      sessionCookie,
    });

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '获取喜欢歌曲失败');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const sessionCookie = readSessionCookie(
      request,
      '未连接网易云账号，无法收藏歌曲'
    );
    const trackId = await readTrackIdFromRequest(request);
    const payload = await repository.accountRepository.setTrackLiked(
      source,
      trackId,
      true,
      {
        sessionCookie,
      }
    );

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '收藏歌曲失败');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const sessionCookie = readSessionCookie(
      request,
      '未连接网易云账号，无法取消收藏歌曲'
    );
    const trackId = await readTrackIdFromRequest(request);
    const payload = await repository.accountRepository.setTrackLiked(
      source,
      trackId,
      false,
      {
        sessionCookie,
      }
    );

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '取消收藏歌曲失败');
  }
}
