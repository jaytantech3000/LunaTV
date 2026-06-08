import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  ContentServiceError,
  getContentDetail,
} from '@/lib/core/content/service';
import { buildQueryCacheHeaders } from '@/lib/server/http-cache';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = searchParams.get('source');

  try {
    if (!id || !sourceCode) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!/^[\w-]+$/.test(id)) {
      return NextResponse.json({ error: '无效的视频ID格式' }, { status: 400 });
    }

    const { result, cacheTime } = await getContentDetail({
      username: authInfo.username,
      id,
      sourceCode,
    });

    return NextResponse.json(result, {
      headers: buildQueryCacheHeaders(cacheTime),
    });
  } catch (error) {
    if (error instanceof ContentServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
