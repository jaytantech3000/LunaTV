/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { LiveServiceError, precheckLiveStream } from '@/lib/core/live/service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('moontv-source');

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  try {
    const result = await precheckLiveStream({
      url,
      sourceKey: source || '',
    });

    return NextResponse.json(
      { success: true, type: result.type },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof LiveServiceError) {
      return NextResponse.json(
        { error: error.message, ...error.payload },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch', message: error },
      { status: 500 }
    );
  }
}
