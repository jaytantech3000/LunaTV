import { NextRequest, NextResponse } from 'next/server';

import { getMockMusicTrack } from '@/lib/music/mock-catalog';
import {
  type MusicPlaybackQuality,
  type MusicPlatformKey,
} from '@/lib/music/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const source =
    (request.nextUrl.searchParams.get('source') as MusicPlatformKey | null) ||
    'netease';
  const id = request.nextUrl.searchParams.get('id') || '';
  const quality =
    (request.nextUrl.searchParams.get('quality') as MusicPlaybackQuality | null) ||
    'standard';

  if (!id) {
    return NextResponse.json({ error: '缺少曲目 id' }, { status: 400 });
  }

  const track = getMockMusicTrack(source, id);

  if (!track) {
    return NextResponse.json({ error: '曲目不存在' }, { status: 404 });
  }

  const streamUrl = `/media/audio/stream?source=${encodeURIComponent(
    source
  )}&id=${encodeURIComponent(id)}&quality=${encodeURIComponent(quality)}`;

  return NextResponse.json(
    {
      track,
      streamUrl,
      quality,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
