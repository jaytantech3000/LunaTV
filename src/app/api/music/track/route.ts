import { NextRequest } from 'next/server';

import {
  createMusicErrorResponse,
  createMusicJsonResponse,
  getMusicTrackPayload,
} from '@/lib/music/netease';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    return createMusicJsonResponse(
      await getMusicTrackPayload({
        id: request.nextUrl.searchParams.get('id'),
        quality: request.nextUrl.searchParams.get('quality'),
        source: request.nextUrl.searchParams.get('source'),
      })
    );
  } catch (error) {
    return createMusicErrorResponse(error, '获取曲目信息失败');
  }
}
