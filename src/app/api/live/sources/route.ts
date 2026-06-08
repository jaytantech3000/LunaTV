/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getLiveSources } from '@/lib/core/live/service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  console.log(request.url);
  try {
    const liveSources = await getLiveSources();

    return NextResponse.json({
      success: true,
      data: liveSources,
    });
  } catch (error) {
    console.error('获取直播源失败:', error);
    return NextResponse.json({ error: '获取直播源失败' }, { status: 500 });
  }
}
