/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError, requireAuthContextFromRequest } from '@/lib/auth';
import { getContentResources } from '@/lib/core/content/service';

export const runtime = 'nodejs';

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  try {
    const authContext = requireAuthContextFromRequest(request);
    const apiSites = await getContentResources({
      authContext,
    });

    return NextResponse.json(apiSites);
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json({ error: '获取资源失败' }, { status: 500 });
  }
}
