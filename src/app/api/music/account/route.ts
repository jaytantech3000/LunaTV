import { NextRequest, NextResponse } from 'next/server';

import {
  clearMusicAccountSessionCookie,
  normalizeNeteaseSessionCookie,
  readMusicAccountSessionCookie,
  writeMusicAccountSessionCookie,
} from '@/features/music/services/music-account-session';
import {
  createMusicErrorResponse,
  getMusicProviderContext,
  resolveLiveMusicSource,
} from '@/features/music/services/music-route-support';
import { NeteaseApiError } from '@/features/music/services/providers/netease/client';

export const runtime = 'nodejs';

function createNoStoreAccountResponse(body: unknown): NextResponse {
  const response = NextResponse.json(body);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function createSignedOutAccountPayload(
  source: ReturnType<typeof resolveLiveMusicSource>
) {
  return {
    source,
    authenticated: false,
    profile: null,
    playlists: [],
  };
}

export async function GET(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const sessionCookie = readMusicAccountSessionCookie(request);
    const payload = await repository.accountRepository.getAccount(
      source,
      sessionCookie
    );
    const response = createNoStoreAccountResponse(payload);

    if (sessionCookie && !payload.authenticated) {
      clearMusicAccountSessionCookie(response);
    }

    return response;
  } catch (error) {
    return createMusicErrorResponse(error, '获取网易云账号失败');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const requestBody = (await request.json()) as {
      cookie?: string;
    };
    const normalizedSessionCookie = normalizeNeteaseSessionCookie(
      requestBody.cookie || ''
    );
    const payload = await repository.accountRepository.getAccount(
      source,
      normalizedSessionCookie
    );

    if (!payload.authenticated || !payload.profile) {
      throw new NeteaseApiError('网易云会话无效或已过期', 401);
    }

    const response = createNoStoreAccountResponse(payload);
    writeMusicAccountSessionCookie(response, normalizedSessionCookie);
    return response;
  } catch (error) {
    return createMusicErrorResponse(error, '连接网易云账号失败');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const source = resolveLiveMusicSource(
      request.nextUrl.searchParams.get('source')
    );
    const response = createNoStoreAccountResponse(
      createSignedOutAccountPayload(source)
    );
    clearMusicAccountSessionCookie(response);
    return response;
  } catch (error) {
    return createMusicErrorResponse(error, '退出网易云账号失败');
  }
}
