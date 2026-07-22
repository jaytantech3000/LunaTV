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

export const runtime = 'nodejs';

const MAX_PROFILE_MERGE_ATTEMPTS = 5;

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

function isAdminSettingsAtomicCapabilityError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('管理设置') &&
    error.message.includes('原子')
  );
}

function isCrossSlotAtomicCommitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE')
  );
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

  let adminSettingsRequested = false;

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

    let body: DesktopProfileSyncMergeRequestBody;
    try {
      body = (await request.json()) as DesktopProfileSyncMergeRequestBody;
    } catch {
      return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
    }
    const targetUsername = body.targetUsername?.trim();
    const strategy = body.strategy;
    const domains = normalizeDomains(body.domains);
    const localSnapshot = domains
      ? normalizeSnapshot(body.snapshot, domains)
      : null;
    const adminConfigSnapshot = normalizeAdminSettingsSyncSnapshot(
      body.adminConfig
    );
    adminSettingsRequested = Boolean(adminConfigSnapshot);

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

    for (let attempt = 0; attempt < MAX_PROFILE_MERGE_ATTEMPTS; attempt += 1) {
      const [revisionBeforeRead, adminRevisionBeforeRead] = await Promise.all([
        db.getProfileSyncRevision(targetUsername),
        adminSettingsRequested ? db.getAdminSettingsRevision() : null,
      ]);
      const [remoteSnapshot, currentAdminConfig] = await Promise.all([
        loadRemoteSnapshot(targetUsername, domains),
        adminSettingsRequested ? db.getAdminConfig() : null,
      ]);
      const [revisionAfterRead, adminRevisionAfterRead] = await Promise.all([
        db.getProfileSyncRevision(targetUsername),
        adminSettingsRequested ? db.getAdminSettingsRevision() : null,
      ]);

      if (
        revisionBeforeRead !== revisionAfterRead ||
        adminRevisionBeforeRead !== adminRevisionAfterRead
      ) {
        continue;
      }

      let mergedAdminConfig: AdminConfig | null = null;
      if (adminConfigSnapshot) {
        if (!currentAdminConfig) {
          throw new Error('未找到当前管理设置');
        }

        mergedAdminConfig = mergeAdminPanelSnapshot(
          currentAdminConfig,
          adminConfigSnapshot
        );
      }

      const mergedSnapshot = mergeDesktopProfileSnapshot(
        remoteSnapshot,
        localSnapshot,
        strategy,
        domains
      );
      const commitResult = await db.commitProfileSyncMerge({
        username: targetUsername,
        expectedRevision: revisionAfterRead,
        domains,
        mergedSnapshot,
        ...(mergedAdminConfig && adminRevisionAfterRead
          ? {
              adminSettings: {
                expectedRevision: adminRevisionAfterRead,
                config: mergedAdminConfig,
              },
            }
          : {}),
      });

      if (!commitResult) {
        continue;
      }

      if (mergedAdminConfig) {
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
        revision: commitResult.revision,
        mergedSnapshot,
        summary: summarizeDesktopProfileSnapshot(mergedSnapshot),
      });
    }

    return NextResponse.json(
      { error: '资料合并冲突，请稍后重试' },
      { status: 409 }
    );
  } catch (error) {
    console.error('管理员资料合并失败:', error);
    if (isCrossSlotAtomicCommitError(error)) {
      return NextResponse.json(
        { error: '资料合并原子提交不可用' },
        { status: 409 }
      );
    }
    if (adminSettingsRequested && isAdminSettingsAtomicCapabilityError(error)) {
      return NextResponse.json(
        { error: '当前存储不支持管理设置的原子资料合并' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error: '资料合并服务暂不可用',
      },
      { status: 503 }
    );
  }
}
