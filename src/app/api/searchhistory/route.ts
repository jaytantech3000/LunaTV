/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError } from '@/lib/auth';
import { ProfileServiceError } from '@/lib/core/profile/service';
import {
  addSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
} from '@/lib/core/profile/user-data-service';
import { requireProfileContextFromRequest } from '@/lib/server/profile-context';

export const runtime = 'nodejs';

// 最大保存条数（与客户端保持一致）
const HISTORY_LIMIT = 20;

/**
 * GET /api/searchhistory
 * 返回 string[]
 */
export async function GET(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const history = await getSearchHistory(profileContext);
    return NextResponse.json(history, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('获取搜索历史失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/searchhistory
 * body: { keyword: string }
 */
export async function POST(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const body = await request.json();
    const keyword: string = body.keyword?.trim();

    await addSearchHistory(profileContext, keyword);

    const history = await getSearchHistory(profileContext);
    return NextResponse.json(history.slice(0, HISTORY_LIMIT), { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('添加搜索历史失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/searchhistory?keyword=<kw>
 *
 * 1. 不带 keyword -> 清空全部搜索历史
 * 2. 带 keyword=<kw> -> 删除单条关键字
 */
export async function DELETE(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const { searchParams } = new URL(request.url);
    const kw = searchParams.get('keyword')?.trim();

    await deleteSearchHistory(profileContext, kw);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('删除搜索历史失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
