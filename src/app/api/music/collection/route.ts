import { NextRequest } from 'next/server';

import {
  createMusicErrorResponse,
  createMusicJsonResponse,
} from '@/lib/music/netease';
import { getMusicCollectionPayload } from '@/lib/music/service';

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
