import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  ContentServiceError,
  searchContentInResource,
} from '@/lib/core/content/service';
import { getCacheTime } from '@/lib/config';
import { buildQueryCacheHeaders } from '@/lib/server/http-cache';

export const runtime = 'nodejs';

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const resourceId = searchParams.get('resourceId');

  if (!query?.trim() || !resourceId?.trim()) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { result: null, error: '缺少必要参数: q 或 resourceId' },
      {
        headers: buildQueryCacheHeaders(cacheTime),
      }
    );
  }

  try {
    const { results, cacheTime } = await searchContentInResource({
      username: authInfo.username,
      query,
      resourceId,
    });

    return NextResponse.json(
      { results },
      {
        headers: buildQueryCacheHeaders(cacheTime),
      }
    );
  } catch (error) {
    if (error instanceof ContentServiceError) {
      return NextResponse.json(
        {
          error: error.message,
          result: null,
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        error: '搜索失败',
        result: null,
      },
      { status: 500 }
    );
  }
}
