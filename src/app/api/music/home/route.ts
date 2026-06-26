import { NextRequest } from 'next/server';

import {
  createMusicErrorResponse,
  createMusicJsonResponse,
  getMusicHomePayload,
} from '@/lib/music/netease';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    return createMusicJsonResponse(
      await getMusicHomePayload({
        source: request.nextUrl.searchParams.get('source'),
      })
    );
  } catch (error) {
    return createMusicErrorResponse(error, '获取音乐首页失败');
  }
}
