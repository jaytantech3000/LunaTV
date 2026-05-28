import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getDoubanRatingsByIds } from '@/lib/douban-rating';

export const runtime = 'nodejs';

const MAX_IDS_PER_REQUEST = 20;

function parseDoubanIds(searchParams: URLSearchParams): number[] {
  const idsParam = searchParams.get('ids') || '';

  return Array.from(
    new Set(
      idsParam
        .split(',')
        .map((id) => Number.parseInt(id.trim(), 10))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  ).slice(0, MAX_IDS_PER_REQUEST);
}

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const ids = parseDoubanIds(searchParams);

  if (ids.length === 0) {
    return NextResponse.json(
      { ratings: {} },
      {
        headers: {
          'Cache-Control': 'private, max-age=300',
        },
      }
    );
  }

  try {
    const ratings = await getDoubanRatingsByIds(ids);

    return NextResponse.json(
      { ratings },
      {
        headers: {
          'Cache-Control': 'private, max-age=300',
        },
      }
    );
  } catch {
    return NextResponse.json(
      { error: '获取豆瓣评分失败' },
      { status: 500 }
    );
  }
}
