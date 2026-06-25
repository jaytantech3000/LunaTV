import { NextRequest, NextResponse } from 'next/server';

import { getMockMusicCollection } from '@/lib/music/mock-catalog';
import { type MusicPlatformKey } from '@/lib/music/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const source =
    (request.nextUrl.searchParams.get('source') as MusicPlatformKey | null) ||
    'netease';
  const id = request.nextUrl.searchParams.get('id') || '';

  if (!id) {
    return NextResponse.json({ error: '缺少合集 id' }, { status: 400 });
  }

  const collection = getMockMusicCollection(source, id);

  if (!collection) {
    return NextResponse.json({ error: '合集不存在' }, { status: 404 });
  }

  return NextResponse.json(collection, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
