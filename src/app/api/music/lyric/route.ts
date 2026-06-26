import { NextRequest } from 'next/server';

import {
  createMusicErrorResponse,
  createMusicJsonResponse,
  getMusicLyricPayload,
} from '@/lib/music/netease';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    return createMusicJsonResponse(
      await getMusicLyricPayload({
        id: request.nextUrl.searchParams.get('id'),
        source: request.nextUrl.searchParams.get('source'),
      })
    );
  } catch (error) {
    return createMusicErrorResponse(error, '获取歌词失败');
  }
}
