import { NextRequest } from 'next/server';

import {
  createMusicErrorResponse,
  createMusicJsonResponse,
  getMusicProviderContext,
} from '@/features/music/services/music-route-support';
import { resolvePlaybackQuality } from '@/features/music/services/providers/netease/client';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const payload = await repository.trackRepository.getTrackPlayback(
      source,
      request.nextUrl.searchParams.get('id') || '',
      resolvePlaybackQuality(request.nextUrl.searchParams.get('quality'))
    );

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '获取曲目信息失败');
  }
}
