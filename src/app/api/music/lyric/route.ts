import { NextRequest } from 'next/server';

import {
  createMusicErrorResponse,
  createMusicJsonResponse,
} from '@/lib/music/netease';
import { getMusicLyricPayload } from '@/lib/music/service';

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
