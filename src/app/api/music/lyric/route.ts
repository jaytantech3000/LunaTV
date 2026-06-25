import { NextRequest, NextResponse } from 'next/server';

import { getMockMusicLyric } from '@/lib/music/mock-catalog';
import { type MusicPlatformKey } from '@/lib/music/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const source =
    (request.nextUrl.searchParams.get('source') as MusicPlatformKey | null) ||
    'netease';
  const id = request.nextUrl.searchParams.get('id') || '';

  if (!id) {
    return NextResponse.json({ error: '缺少曲目 id' }, { status: 400 });
  }

  const lyric = getMockMusicLyric(source, id);

  if (!lyric) {
    return NextResponse.json({ error: '歌词不存在' }, { status: 404 });
  }

  return NextResponse.json(lyric, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
