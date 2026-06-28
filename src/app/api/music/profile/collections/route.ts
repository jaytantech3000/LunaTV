/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError } from '@/lib/auth';
import {
  deleteAllMusicCollectionRecords,
  deleteMusicCollectionRecord,
  getMusicSavedCollections,
  saveMusicCollectionRecord,
} from '@/lib/core/profile/music-user-data-service';
import { ProfileServiceError } from '@/lib/core/profile/service';
import { requireProfileContextFromRequest } from '@/lib/server/profile-context';

import type { SavedMusicCollectionRecord } from '@/features/music/services/music-collection-profile-records';

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
    const collections = await getMusicSavedCollections(profileContext);
    return NextResponse.json(collections, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('获取音乐已保存合集失败', err);
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
    const {
      key,
      collection,
    }: { key?: string; collection?: SavedMusicCollectionRecord } = body;

    if (!key || !collection) {
      return NextResponse.json(
        { error: 'Missing key or collection' },
        { status: 400 }
      );
    }

    await saveMusicCollectionRecord(profileContext, {
      key,
      collection,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('保存音乐已保存合集失败', err);
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
      await deleteMusicCollectionRecord(profileContext, key);
    } else {
      await deleteAllMusicCollectionRecords(profileContext);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthContextError || err instanceof ProfileServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('删除音乐已保存合集失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
