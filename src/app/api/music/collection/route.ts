import { NextRequest } from 'next/server';

import {
  createMusicErrorResponse,
  createMusicJsonResponse,
  getMusicCollectionPayload,
} from '@/lib/music/netease';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    return createMusicJsonResponse(
      await getMusicCollectionPayload({
        id: request.nextUrl.searchParams.get('id'),
        source: request.nextUrl.searchParams.get('source'),
      })
    );
  } catch (error) {
    return createMusicErrorResponse(error, '获取音乐合集失败');
  }
}
