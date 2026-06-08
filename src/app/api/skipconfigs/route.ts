/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AuthContextError } from '@/lib/auth';
import { ProfileServiceError } from '@/lib/core/profile/service';
import {
  deleteSkipConfig,
  getAllSkipConfigs,
  getSkipConfig,
  setSkipConfig,
} from '@/lib/core/profile/user-data-service';
import { requireProfileContextFromRequest } from '@/lib/server/profile-context';
import { SkipConfig } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const id = searchParams.get('id');

    if (source && id) {
      const config = await getSkipConfig(profileContext, source, id);
      return NextResponse.json(config);
    } else {
      const configs = await getAllSkipConfigs(profileContext);
      return NextResponse.json(configs);
    }
  } catch (error) {
    if (
      error instanceof AuthContextError ||
      error instanceof ProfileServiceError
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error('获取跳过片头片尾配置失败:', error);
    return NextResponse.json(
      { error: '获取跳过片头片尾配置失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const body = await request.json();
    const { key, config } = body;

    if (!key || !config) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    await setSkipConfig(profileContext, {
      key,
      config: config as SkipConfig,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (
      error instanceof AuthContextError ||
      error instanceof ProfileServiceError
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error('保存跳过片头片尾配置失败:', error);
    return NextResponse.json(
      { error: '保存跳过片头片尾配置失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const profileContext = await requireProfileContextFromRequest(request);
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    await deleteSkipConfig(profileContext, key);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (
      error instanceof AuthContextError ||
      error instanceof ProfileServiceError
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error('删除跳过片头片尾配置失败:', error);
    return NextResponse.json(
      { error: '删除跳过片头片尾配置失败' },
      { status: 500 }
    );
  }
}
