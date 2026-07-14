/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import {
  type AdminSettingsSyncSnapshot,
  applyAdminSettingsSyncSnapshot,
} from '@/lib/admin-settings-sync';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { configSelfCheck, getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  type DesktopProfileDomain,
  type DesktopProfileMergeStrategy,
  type DesktopProfileSnapshot,
  DESKTOP_PROFILE_DOMAINS,
  mergeDesktopProfileSnapshot,
  summarizeDesktopProfileSnapshot,
} from '@/lib/profile-sync/desktop-merge';
import type { SkipConfig } from '@/lib/types';

export const runtime = 'nodejs';

interface DesktopProfileSyncMergeRequestBody {
  targetUsername?: string;
  strategy?: DesktopProfileMergeStrategy;
  domains?: unknown;
  snapshot?: Partial<DesktopProfileSnapshot>;
  adminConfig?: AdminSettingsSyncSnapshot;
  protocolVersion?: unknown;
  requestId?: unknown;
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
  username: string,
  domains: readonly DesktopProfileDomain[]
): Promise<DesktopProfileSnapshot> {
  return {
    playRecords: domains.includes('playRecords')
      ? await db.getAllPlayRecords(username)
      : {},
    favorites: domains.includes('favorites')
      ? await db.getAllFavorites(username)
      : {},
    follows: domains.includes('follows')
      ? await db.getAllFollowRecords(username)
      : {},
    searchHistory: domains.includes('searchHistory')
      ? await db.getSearchHistory(username)
      : [],
    skipConfigs: domains.includes('skipConfigs')
      ? await db.getAllSkipConfigs(username)
      : {},
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

function normalizeDomains(
  domains: DesktopProfileSyncMergeRequestBody['domains']
): DesktopProfileDomain[] | null {
  if (domains === undefined) {
    return [...DESKTOP_PROFILE_DOMAINS];
  }

  if (!Array.isArray(domains)) {
    return null;
  }

  const selectedDomains: DesktopProfileDomain[] = [];
  for (const domain of domains) {
    if (
      typeof domain !== 'string' ||
      !DESKTOP_PROFILE_DOMAINS.includes(domain as DesktopProfileDomain) ||
      selectedDomains.includes(domain as DesktopProfileDomain)
    ) {
      return null;
    }

    selectedDomains.push(domain as DesktopProfileDomain);
  }

  return selectedDomains;
}

function normalizeSnapshot(
  snapshot: DesktopProfileSyncMergeRequestBody['snapshot'],
  domains: readonly DesktopProfileDomain[]
): DesktopProfileSnapshot | null {
  if (!snapshot || !isObjectRecord(snapshot)) {
    return null;
  }

  const normalizedSnapshot: DesktopProfileSnapshot = {
    playRecords: {},
    favorites: {},
    follows: {},
    searchHistory: [],
    skipConfigs: {},
  };

  for (const domain of domains) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, domain)) {
      return null;
    }

    const domainSnapshot = snapshot[domain];
    if (domain === 'searchHistory') {
      if (!Array.isArray(domainSnapshot)) {
        return null;
      }
      normalizedSnapshot.searchHistory = domainSnapshot;
      continue;
    }

    if (!isObjectRecord(domainSnapshot)) {
      return null;
    }

    switch (domain) {
      case 'playRecords':
        normalizedSnapshot.playRecords =
          domainSnapshot as DesktopProfileSnapshot['playRecords'];
        break;
      case 'favorites':
        normalizedSnapshot.favorites =
          domainSnapshot as DesktopProfileSnapshot['favorites'];
        break;
      case 'follows':
        normalizedSnapshot.follows =
          domainSnapshot as DesktopProfileSnapshot['follows'];
        break;
      case 'skipConfigs':
        normalizedSnapshot.skipConfigs =
          domainSnapshot as DesktopProfileSnapshot['skipConfigs'];
        break;
    }
  }

  return normalizedSnapshot;
}

function normalizeAdminSettingsSyncSnapshot(
  adminConfig: DesktopProfileSyncMergeRequestBody['adminConfig']
): AdminSettingsSyncSnapshot | null {
  if (!adminConfig || !isObjectRecord(adminConfig)) {
    return null;
  }

  if (
    !isObjectRecord(adminConfig.SiteConfig) ||
    !Array.isArray(adminConfig.SourceConfig) ||
    !Array.isArray(adminConfig.CustomCategories) ||
    !Array.isArray(adminConfig.LiveConfig)
  ) {
    return null;
  }

  if (
    (adminConfig.AdFilterConfig !== undefined &&
      !isObjectRecord(adminConfig.AdFilterConfig)) ||
    (adminConfig.PlayerEnhancementConfig !== undefined &&
      !isObjectRecord(adminConfig.PlayerEnhancementConfig))
  ) {
    return null;
  }

  return {
    SiteConfig: adminConfig.SiteConfig,
    SourceConfig: adminConfig.SourceConfig,
    CustomCategories: adminConfig.CustomCategories,
    LiveConfig: adminConfig.LiveConfig,
    AdFilterConfig: adminConfig.AdFilterConfig,
    PlayerEnhancementConfig: adminConfig.PlayerEnhancementConfig,
  };
}

function mergeAdminPanelSnapshot(
  currentConfig: AdminConfig,
  snapshot: AdminSettingsSyncSnapshot
): AdminConfig {
  return configSelfCheck(
    applyAdminSettingsSyncSnapshot(currentConfig, snapshot)
  );
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
    const domains = normalizeDomains(body.domains);
    const localSnapshot = domains
      ? normalizeSnapshot(body.snapshot, domains)
      : null;
    const adminConfigSnapshot = normalizeAdminSettingsSyncSnapshot(
      body.adminConfig
    );

    if (!targetUsername) {
      return NextResponse.json({ error: '缺少目标用户名' }, { status: 400 });
    }

    if (!isValidStrategy(strategy)) {
      return NextResponse.json({ error: '缺少冲突策略' }, { status: 400 });
    }

    if (!domains) {
      return NextResponse.json({ error: '资料域格式错误' }, { status: 400 });
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

    const remoteSnapshot = await loadRemoteSnapshot(targetUsername, domains);
    const mergedSnapshot = mergeDesktopProfileSnapshot(
      remoteSnapshot,
      localSnapshot,
      strategy,
      domains
    );

    if (domains.includes('playRecords')) {
      await replacePlayRecords(targetUsername, mergedSnapshot.playRecords);
    }
    if (domains.includes('favorites')) {
      await replaceFavorites(targetUsername, mergedSnapshot.favorites);
    }
    if (domains.includes('follows')) {
      await replaceFollows(targetUsername, mergedSnapshot.follows);
    }
    if (domains.includes('searchHistory')) {
      await replaceSearchHistory(targetUsername, mergedSnapshot.searchHistory);
    }
    if (domains.includes('skipConfigs')) {
      await replaceSkipConfigs(
        targetUsername,
        remoteSnapshot.skipConfigs,
        mergedSnapshot.skipConfigs
      );
    }

    if (adminConfigSnapshot) {
      const mergedAdminConfig = mergeAdminPanelSnapshot(
        config,
        adminConfigSnapshot
      );
      await db.saveAdminConfig(mergedAdminConfig);
      await setCachedConfig(mergedAdminConfig);
    }

    return NextResponse.json({
      ok: true,
      targetUsername,
      strategy,
      ...(typeof body.protocolVersion === 'string'
        ? { protocolVersion: body.protocolVersion }
        : {}),
      ...(typeof body.requestId === 'string'
        ? { requestId: body.requestId }
        : {}),
      summary: summarizeDesktopProfileSnapshot(mergedSnapshot),
    });
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
