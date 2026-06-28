/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError } from '@/lib/auth';
import {
  deleteAllMusicRecentTrackRecords,
  getMusicRecentTrackRecords,
  saveMusicRecentTrackRecords,
} from '@/lib/core/profile/music-user-data-service';
import { ProfileServiceError } from '@/lib/core/profile/service';
import { requireProfileContextFromRequest } from '@/lib/server/profile-context';

import type { MusicRecentTrackRecord } from '@/features/music/services/music-profile-records';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const tracks = await getMusicRecentTrackRecords(profileContext);
    return NextResponse.json(tracks, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('获取音乐最近播放失败', err);
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
    const { track }: { track?: MusicRecentTrackRecord } = body;

    if (!track) {
      return NextResponse.json(
        { error: 'Missing track record' },
        { status: 400 }
      );
    }

    await saveMusicRecentTrackRecords(profileContext, {
      track,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('保存音乐最近播放失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    await deleteAllMusicRecentTrackRecords(profileContext);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('清空音乐最近播放失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
