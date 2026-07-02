/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { configSelfCheck, getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  type DesktopProfileMergeStrategy,
  type DesktopProfileSnapshot,
  mergeDesktopProfileSnapshot,
  summarizeDesktopProfileSnapshot,
} from '@/lib/profile-sync/desktop-merge';
import type { SkipConfig } from '@/lib/types';

export const runtime = 'nodejs';

interface DesktopProfileSyncMergeRequestBody {
  targetUsername?: string;
  strategy?: DesktopProfileMergeStrategy;
  snapshot?: DesktopProfileSnapshot;
  adminConfig?: AdminConfig;
}

function isSupportedStorageType(): boolean {
  return (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') !== 'localstorage'
  );
}

function resolveOperatorRole(
  config: AdminConfig,
  username: string
): 'owner' | 'admin' | null {
  if (username === process.env.USERNAME) {
    return 'owner';
  }

  const userEntry = config.UserConfig.Users.find(
    (user) => user.username === username
  );
  if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
    return null;
  }

  return 'admin';
}

function findTargetUser(config: AdminConfig, username: string) {
  if (username === process.env.USERNAME) {
    return {
      username,
      role: 'owner' as const,
      banned: false,
    };
  }

  return (
    config.UserConfig.Users.find((user) => user.username === username) || null
  );
}

function splitCompositeKey(key: string): {
  source: string;
  id: string;
} {
  const [source, id] = key.split('+');
  const normalizedSource = source?.trim();
  const normalizedId = id?.trim();

  if (!normalizedSource || !normalizedId) {
    throw new Error(`Invalid composite key: ${key}`);
  }

  return {
    source: normalizedSource,
    id: normalizedId,
  };
}

async function loadRemoteSnapshot(
  username: string
): Promise<DesktopProfileSnapshot> {
  return {
    playRecords: await db.getAllPlayRecords(username),
    favorites: await db.getAllFavorites(username),
    follows: await db.getAllFollowRecords(username),
    searchHistory: await db.getSearchHistory(username),
    skipConfigs: await db.getAllSkipConfigs(username),
  };
}

async function replacePlayRecords(
  username: string,
  records: DesktopProfileSnapshot['playRecords']
): Promise<void> {
  await db.deleteAllPlayRecords(username);

  await Promise.all(
    Object.entries(records).map(async ([key, record]) => {
      const { source, id } = splitCompositeKey(key);
      await db.savePlayRecord(username, source, id, record);
    })
  );
}

async function replaceFavorites(
  username: string,
  favorites: DesktopProfileSnapshot['favorites']
): Promise<void> {
  await db.deleteAllFavorites(username);

  await Promise.all(
    Object.entries(favorites).map(async ([key, favorite]) => {
      const { source, id } = splitCompositeKey(key);
      await db.saveFavorite(username, source, id, favorite);
    })
  );
}

async function replaceFollows(
  username: string,
  follows: DesktopProfileSnapshot['follows']
): Promise<void> {
  await db.deleteAllFollowRecords(username);

  await Promise.all(
    Object.entries(follows).map(async ([key, follow]) => {
      const { source, id } = splitCompositeKey(key);
      await db.saveFollowRecord(username, source, id, follow);
    })
  );
}

async function replaceSearchHistory(
  username: string,
  searchHistory: DesktopProfileSnapshot['searchHistory']
): Promise<void> {
  await db.deleteSearchHistory(username);

  for (const keyword of [...searchHistory].reverse()) {
    await db.addSearchHistory(username, keyword);
  }
}

async function replaceSkipConfigs(
  username: string,
  remoteSkipConfigs: Record<string, SkipConfig>,
  mergedSkipConfigs: Record<string, SkipConfig>
): Promise<void> {
  await Promise.all(
    Object.keys(remoteSkipConfigs).map(async (key) => {
      const { source, id } = splitCompositeKey(key);
      await db.deleteSkipConfig(username, source, id);
    })
  );

  await Promise.all(
    Object.entries(mergedSkipConfigs).map(async ([key, config]) => {
      const { source, id } = splitCompositeKey(key);
      await db.setSkipConfig(username, source, id, config);
    })
  );
}

function isValidStrategy(
  value: DesktopProfileSyncMergeRequestBody['strategy']
): value is DesktopProfileMergeStrategy {
  return value === 'web-first' || value === 'local-first';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSnapshot(
  snapshot: DesktopProfileSyncMergeRequestBody['snapshot']
): DesktopProfileSnapshot | null {
  if (!snapshot) {
    return null;
  }

  if (
    !isObjectRecord(snapshot.playRecords) ||
    !isObjectRecord(snapshot.favorites) ||
    !isObjectRecord(snapshot.follows) ||
    !Array.isArray(snapshot.searchHistory) ||
    !isObjectRecord(snapshot.skipConfigs)
  ) {
    return null;
  }

  return snapshot;
}

function normalizeAdminConfigSnapshot(
  adminConfig: DesktopProfileSyncMergeRequestBody['adminConfig']
): AdminConfig | null {
  if (!adminConfig || !isObjectRecord(adminConfig)) {
    return null;
  }

  return adminConfig;
}

function mergeAdminPanelSnapshot(
  currentConfig: AdminConfig,
  snapshot: AdminConfig,
  operatorRole: 'owner' | 'admin'
): AdminConfig {
  return configSelfCheck({
    ...currentConfig,
    ConfigSubscribtion:
      operatorRole === 'owner'
        ? snapshot.ConfigSubscribtion || currentConfig.ConfigSubscribtion
        : currentConfig.ConfigSubscribtion,
    ConfigFile:
      operatorRole === 'owner'
        ? snapshot.ConfigFile || currentConfig.ConfigFile
        : currentConfig.ConfigFile,
    SiteConfig: snapshot.SiteConfig || currentConfig.SiteConfig,
    SourceConfig: Array.isArray(snapshot.SourceConfig)
      ? snapshot.SourceConfig
      : currentConfig.SourceConfig,
    CustomCategories: Array.isArray(snapshot.CustomCategories)
      ? snapshot.CustomCategories
      : currentConfig.CustomCategories,
    LiveConfig: Array.isArray(snapshot.LiveConfig)
      ? snapshot.LiveConfig
      : currentConfig.LiveConfig,
    AdFilterConfig: snapshot.AdFilterConfig || currentConfig.AdFilterConfig,
    PlayerEnhancementConfig:
      snapshot.PlayerEnhancementConfig || currentConfig.PlayerEnhancementConfig,
    UserConfig: snapshot.UserConfig || currentConfig.UserConfig,
  });
}

export async function POST(request: NextRequest) {
  if (!isSupportedStorageType()) {
    return NextResponse.json(
      {
        error: '不支持本地存储进行资料合并',
      },
      { status: 400 }
    );
  }

  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    const operatorRole = resolveOperatorRole(config, authInfo.username);
    if (!operatorRole) {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    const body = (await request.json()) as DesktopProfileSyncMergeRequestBody;
    const targetUsername = body.targetUsername?.trim();
    const strategy = body.strategy;
    const localSnapshot = normalizeSnapshot(body.snapshot);
    const adminConfigSnapshot = normalizeAdminConfigSnapshot(body.adminConfig);

    if (!targetUsername) {
      return NextResponse.json({ error: '缺少目标用户名' }, { status: 400 });
    }

    if (!isValidStrategy(strategy)) {
      return NextResponse.json({ error: '缺少冲突策略' }, { status: 400 });
    }

    if (!localSnapshot) {
      return NextResponse.json({ error: '资料快照格式错误' }, { status: 400 });
    }

    const targetUser = findTargetUser(config, targetUsername);
    if (!targetUser) {
      return NextResponse.json({ error: '目标用户不存在' }, { status: 404 });
    }

    if (targetUser.banned) {
      return NextResponse.json({ error: '目标用户已被封禁' }, { status: 400 });
    }

    const remoteSnapshot = await loadRemoteSnapshot(targetUsername);
    const mergedSnapshot = mergeDesktopProfileSnapshot(
      remoteSnapshot,
      localSnapshot,
      strategy
    );

    await replacePlayRecords(targetUsername, mergedSnapshot.playRecords);
    await replaceFavorites(targetUsername, mergedSnapshot.favorites);
    await replaceFollows(targetUsername, mergedSnapshot.follows);
    await replaceSearchHistory(targetUsername, mergedSnapshot.searchHistory);
    await replaceSkipConfigs(
      targetUsername,
      remoteSnapshot.skipConfigs,
      mergedSnapshot.skipConfigs
    );

    if (adminConfigSnapshot) {
      const mergedAdminConfig = mergeAdminPanelSnapshot(
        config,
        adminConfigSnapshot,
        operatorRole
      );
      await db.saveAdminConfig(mergedAdminConfig);
      await setCachedConfig(mergedAdminConfig);
    }

    return NextResponse.json(
      {
        ok: true,
        targetUsername,
        strategy,
        summary: summarizeDesktopProfileSnapshot(mergedSnapshot),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('管理员资料合并失败:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '管理员资料合并失败',
      },
      { status: 500 }
    );
  }
}
