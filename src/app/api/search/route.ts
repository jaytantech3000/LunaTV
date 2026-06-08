/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { searchContent } from '@/lib/core/content/service';
import { buildQueryCacheHeaders } from '@/lib/server/http-cache';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  try {
    const { results, cacheTime } = await searchContent({
      username: authInfo.username,
      query,
    });

    if (!query?.trim()) {
      return NextResponse.json(
        { results: [] },
        {
          headers: buildQueryCacheHeaders(cacheTime),
        }
      );
    }

    if (results.length === 0) {
      // no cache if empty
      return NextResponse.json({ results: [] }, { status: 200 });
    }

    return NextResponse.json(
      { results },
      {
        headers: buildQueryCacheHeaders(cacheTime),
      }
    );
  } catch (error) {
    console.error('搜索失败:', error);
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
