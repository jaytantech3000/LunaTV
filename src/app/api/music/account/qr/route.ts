import { NextRequest, NextResponse } from 'next/server';

import { writeMusicAccountSessionCookie } from '@/features/music/services/music-account-session';
import {
  createMusicErrorResponse,
  getMusicProviderContext,
} from '@/features/music/services/music-route-support';

export const runtime = 'nodejs';

function createNoStoreAccountQrResponse(body: unknown): NextResponse {
  const response = NextResponse.json(body);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const payload = await repository.accountRepository.createQrSession(source);

    return createNoStoreAccountQrResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '创建网易云二维码失败');
  }
}

export async function GET(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const key = request.nextUrl.searchParams.get('key') || '';
    const result = await repository.accountRepository.pollQrSession(
      source,
      key
    );
    const { sessionCookieHeader, ...payload } = result;
    const response = createNoStoreAccountQrResponse(payload);

    if (payload.status === 'confirmed' && sessionCookieHeader) {
      writeMusicAccountSessionCookie(response, sessionCookieHeader);
    }

    return response;
  } catch (error) {
    return createMusicErrorResponse(error, '获取网易云二维码状态失败');
  }
}
