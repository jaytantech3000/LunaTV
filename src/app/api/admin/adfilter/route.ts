/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface AdFilterPayload {
  enabled?: boolean;
}

export async function POST(request: NextRequest): Promise<Response> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  try {
    const body = (await request.json()) as AdFilterPayload;
    const enabled = body.enabled !== false;

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authInfo.username;
    const adminConfig = await getConfig();

    if (username !== process.env.USERNAME) {
      const user = adminConfig.UserConfig.Users.find(
        (item) => item.username === username
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    adminConfig.AdFilterConfig = { enabled };
    await db.saveAdminConfig(adminConfig);

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('更新广告过滤配置失败:', error);
    return NextResponse.json(
      {
        error: '更新广告过滤配置失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
