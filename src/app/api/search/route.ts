/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError, requireAuthContextFromRequest } from '@/lib/auth';
import { searchContent } from '@/lib/core/content/service';
import { buildQueryCacheHeaders } from '@/lib/server/http-cache';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authContext = requireAuthContextFromRequest(request);
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const { results, cacheTime } = await searchContent({
      authContext,
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
    if (error instanceof AuthContextError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error('搜索失败:', error);
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
