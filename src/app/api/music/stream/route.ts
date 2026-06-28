import { NextRequest } from 'next/server';

import {
  createMusicErrorResponse,
  getMusicProviderContext,
} from '@/features/music/services/music-route-support';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { repository } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );

    return await repository.streamRepository.createStreamResponse(request);
  } catch (error) {
    return createMusicErrorResponse(error, '加载音乐音频流失败');
  }
}
