import { NextRequest, NextResponse } from 'next/server';

import { getLiveEpg, LiveServiceError } from '@/lib/core/live/service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceKey = searchParams.get('source');
    const tvgId = searchParams.get('tvgId');

    if (!sourceKey) {
      return NextResponse.json({ error: '缺少直播源参数' }, { status: 400 });
    }

    if (!tvgId) {
      return NextResponse.json(
        { error: '缺少频道tvg-id参数' },
        { status: 400 }
      );
    }

    const data = await getLiveEpg(sourceKey, tvgId);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    if (error instanceof LiveServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json({ error: '获取节目单信息失败' }, { status: 500 });
  }
}
