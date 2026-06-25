import { NextResponse } from 'next/server';

import { getMockMusicSources } from '@/lib/music/mock-catalog';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(
    {
      sources: getMockMusicSources(),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
