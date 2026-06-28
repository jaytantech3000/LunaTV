import { NextRequest } from 'next/server';

import {
  createMusicErrorResponse,
  createMusicJsonResponse,
  getMusicProviderContext,
} from '@/features/music/services/music-route-support';

export const runtime = 'nodejs';

function parsePage(page: string | null): number | undefined {
  if (!page?.trim()) {
    return undefined;
  }

  return Number.parseInt(page, 10);
}

export async function GET(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const payload = await repository.discoveryRepository.search(
      source,
      request.nextUrl.searchParams.get('q') || '',
      parsePage(request.nextUrl.searchParams.get('page'))
    );

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '搜索音乐失败');
  }
}
