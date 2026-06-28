import { NextRequest } from 'next/server';

import type { MusicCollectionKind } from '@/features/music/domain/entities';
import {
  createMusicErrorResponse,
  createMusicJsonResponse,
  getMusicProviderContext,
} from '@/features/music/services/music-route-support';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { repository, source } = getMusicProviderContext(
      request.nextUrl.searchParams.get('source')
    );
    const collectionKind = request.nextUrl.searchParams.get('kind');
    const payload = await repository.collectionRepository.getCollection(
      source,
      request.nextUrl.searchParams.get('id') || '',
      collectionKind === 'playlist' ||
        collectionKind === 'album' ||
        collectionKind === 'rank' ||
        collectionKind === 'artist-toplist'
        ? (collectionKind as MusicCollectionKind)
        : undefined
    );

    return createMusicJsonResponse(payload);
  } catch (error) {
    return createMusicErrorResponse(error, '获取音乐合集失败');
  }
}
