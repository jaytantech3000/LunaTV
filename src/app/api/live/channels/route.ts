import { NextRequest, NextResponse } from 'next/server';

import { getLiveChannels, LiveServiceError } from '@/lib/core/live/service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceKey = searchParams.get('source');

    if (!sourceKey) {
      return NextResponse.json({ error: '缺少直播源参数' }, { status: 400 });
    }

    const channels = await getLiveChannels(sourceKey);

    return NextResponse.json({
      success: true,
      data: channels,
    });
  } catch (error) {
    if (error instanceof LiveServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json({ error: '获取频道信息失败' }, { status: 500 });
  }
}
