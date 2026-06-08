/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError, requireAuthContextFromRequest } from '@/lib/auth';
import { getContentSuggestions } from '@/lib/core/content/service';
import { buildQueryCacheHeaders } from '@/lib/server/http-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authContext = requireAuthContextFromRequest(request);
    const { searchParams } = new URL(request.url);
    const { suggestions, cacheTime } = await getContentSuggestions({
      authContext,
      query: searchParams.get('q'),
    });

    if (!cacheTime) {
      return NextResponse.json({ suggestions: [] });
    }

    return NextResponse.json(
      { suggestions },
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

    console.error('获取搜索建议失败', error);
    return NextResponse.json({ error: '获取搜索建议失败' }, { status: 500 });
  }
}
