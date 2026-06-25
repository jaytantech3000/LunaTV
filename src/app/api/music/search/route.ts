import { NextRequest, NextResponse } from 'next/server';

import { getMockMusicSearch } from '@/lib/music/mock-catalog';
import { type MusicPlatformKey } from '@/lib/music/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const source =
    (request.nextUrl.searchParams.get('source') as MusicPlatformKey | null) ||
    'netease';
  const query = request.nextUrl.searchParams.get('q') || '';

  return NextResponse.json(getMockMusicSearch(source, query), {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
