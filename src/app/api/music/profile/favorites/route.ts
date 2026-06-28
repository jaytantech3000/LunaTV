/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError } from '@/lib/auth';
import {
  deleteAllMusicFavoriteRecords,
  deleteMusicFavoriteRecord,
  getAllMusicFavorites,
  saveMusicFavoriteRecord,
} from '@/lib/core/profile/music-user-data-service';
import { ProfileServiceError } from '@/lib/core/profile/service';
import { requireProfileContextFromRequest } from '@/lib/server/profile-context';

import type { MusicFavoriteRecord } from '@/features/music/services/music-profile-records';

export const runtime = 'nodejs';

function normalizeMusicProfileKey(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.replaceAll(' ', '+');
}

export async function GET(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const favorites = await getAllMusicFavorites(profileContext);
    return NextResponse.json(favorites, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('获取音乐收藏失败', err);
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
    const { key, favorite }: { key?: string; favorite?: MusicFavoriteRecord } =
      body;

    if (!key || !favorite) {
      return NextResponse.json(
        { error: 'Missing key or favorite' },
        { status: 400 }
      );
    }

    await saveMusicFavoriteRecord(profileContext, {
      key,
      favorite,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('保存音乐收藏失败', err);
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
    const key = normalizeMusicProfileKey(searchParams.get('key'));

    if (key) {
      await deleteMusicFavoriteRecord(profileContext, key);
    } else {
      await deleteAllMusicFavoriteRecords(profileContext);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('删除音乐收藏失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
