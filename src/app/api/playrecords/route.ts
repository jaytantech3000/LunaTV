/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError } from '@/lib/auth';
import { ProfileServiceError } from '@/lib/core/profile/service';
import {
  deleteAllPlayRecords,
  deletePlayRecord,
  getAllPlayRecords,
  savePlayRecord,
} from '@/lib/core/profile/user-data-service';
import { requireProfileContextFromRequest } from '@/lib/server/profile-context';
import { PlayRecord } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const records = await getAllPlayRecords(profileContext);
    return NextResponse.json(records, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('获取播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const body = await request.json();
    const { key, record }: { key: string; record: PlayRecord } = body;

    if (!key || !record) {
      return NextResponse.json(
        { error: 'Missing key or record' },
        { status: 400 }
      );
    }

    await savePlayRecord(profileContext, {
      key,
      record,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('保存播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      await deletePlayRecord(profileContext, key);
    } else {
      await deleteAllPlayRecords(profileContext);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('删除播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
