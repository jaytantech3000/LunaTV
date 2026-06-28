/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError } from '@/lib/auth';
import {
  getMusicPreferences,
  saveMusicPreferences,
} from '@/lib/core/profile/music-user-data-service';
import { ProfileServiceError } from '@/lib/core/profile/service';
import { requireProfileContextFromRequest } from '@/lib/server/profile-context';

import type { MusicPreferences } from '@/features/music/services/music-preferences-records';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const preferences = await getMusicPreferences(profileContext);
    return NextResponse.json(preferences, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('获取音乐偏好失败', err);
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
    const { preferences }: { preferences?: MusicPreferences } = body;

    if (!preferences) {
      return NextResponse.json(
        { error: 'Missing preferences' },
        { status: 400 }
      );
    }

    await saveMusicPreferences(profileContext, preferences);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('保存音乐偏好失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
