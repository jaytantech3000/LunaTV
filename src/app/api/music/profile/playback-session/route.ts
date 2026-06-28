/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError } from '@/lib/auth';
import {
  getMusicPlaybackSession,
  saveMusicPlaybackSession,
} from '@/lib/core/profile/music-user-data-service';
import { ProfileServiceError } from '@/lib/core/profile/service';
import { requireProfileContextFromRequest } from '@/lib/server/profile-context';

import type { MusicPlaybackSession } from '@/features/music/services/music-playback-session-records';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const session = await getMusicPlaybackSession(profileContext);
    return NextResponse.json(session, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('获取播放现场快照失败', err);
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
    const { session }: { session?: MusicPlaybackSession } = body;

    if (!session) {
      return NextResponse.json({ error: 'Missing session' }, { status: 400 });
    }

    await saveMusicPlaybackSession(profileContext, session);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('保存播放现场快照失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
