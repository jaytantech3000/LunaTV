/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getContentSuggestions } from '@/lib/core/content/service';
import { buildQueryCacheHeaders } from '@/lib/server/http-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const { suggestions, cacheTime } = await getContentSuggestions({
      username: authInfo.username,
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
    console.error('获取搜索建议失败', error);
    return NextResponse.json({ error: '获取搜索建议失败' }, { status: 500 });
  }
}
