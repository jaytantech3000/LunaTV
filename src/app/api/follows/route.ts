/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError } from '@/lib/auth';
import { ProfileServiceError } from '@/lib/core/profile/service';
import {
  deleteAllFollowRecords,
  deleteFollowRecord,
  getAllFollowRecords,
  getFollowRecord,
  saveFollowRecord,
} from '@/lib/core/profile/user-data-service';
import { requireProfileContextFromRequest } from '@/lib/server/profile-context';
import { FollowRecord } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      const follow = await getFollowRecord(profileContext, key);
      return NextResponse.json(follow, { status: 200 });
    }

    const follows = await getAllFollowRecords(profileContext);
    return NextResponse.json(follows, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('获取追更记录失败', err);
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
    const { key, follow }: { key: string; follow: FollowRecord } = body;

    if (!key || !follow) {
      return NextResponse.json(
        { error: 'Missing key or follow' },
        { status: 400 }
      );
    }

    await saveFollowRecord(profileContext, {
      key,
      follow,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('保存追更记录失败', err);
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
      await deleteFollowRecord(profileContext, key);
    } else {
      await deleteAllFollowRecords(profileContext);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('删除追更记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
