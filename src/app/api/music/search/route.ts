import { NextRequest } from 'next/server';

import {
  createMusicErrorResponse,
  createMusicJsonResponse,
  getMusicSearchPayload,
} from '@/lib/music/netease';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    return createMusicJsonResponse(
      await getMusicSearchPayload({
        page: request.nextUrl.searchParams.get('page'),
        query: request.nextUrl.searchParams.get('q'),
        source: request.nextUrl.searchParams.get('source'),
      })
    );
  } catch (error) {
    return createMusicErrorResponse(error, '搜索音乐失败');
  }
}
