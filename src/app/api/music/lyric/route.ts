import { NextRequest } from 'next/server';

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
    const payload = await repository.lyricRepository.getLyrics(
      source,
      request.nextUrl.searchParams.get('id') || ''
    );

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '获取歌词失败');
  }
}
