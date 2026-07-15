import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError, requireAuthContextFromRequest } from '@/lib/auth';
import { getCacheTime } from '@/lib/config';
import {
  ContentServiceError,
  searchContentInResource,
} from '@/lib/core/content/service';
import { buildQueryCacheHeaders } from '@/lib/server/http-cache';

export const runtime = 'nodejs';

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  try {
    const authContext = requireAuthContextFromRequest(request);
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

    const { results, cacheTime } = await searchContentInResource({
      authContext,
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
    if (error instanceof AuthContextError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

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
