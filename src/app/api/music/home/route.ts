import { NextRequest, NextResponse } from 'next/server';

import { getMockMusicHome } from '@/lib/music/mock-catalog';
import { type MusicPlatformKey } from '@/lib/music/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const source =
    (request.nextUrl.searchParams.get('source') as MusicPlatformKey | null) ||
    'netease';

  return NextResponse.json(getMockMusicHome(source), {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
