import { NextRequest } from 'next/server';

import { readMusicAccountSessionCookie } from '@/features/music/services/music-account-session';
import {
  createMusicErrorResponse,
  createMusicJsonResponse,
  getMusicProviderContext,
} from '@/features/music/services/music-route-support';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const payload = await repository.discoveryRepository.getHomeView(source, {
      sessionCookie: readMusicAccountSessionCookie(request),
    });

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '获取音乐首页失败');
  }
}
