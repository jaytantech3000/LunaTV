import type { ResolvedProfileRuntime } from '@/lib/profile/contracts';

import type { DesktopProfileSyncStatus } from './profile-sync';
import {
  buildDesktopProfileSyncStatusDetail,
  buildDesktopProfileSyncStatusValue,
} from './profile-sync-status-copy';

export type UserMenuStorageStatusTone = 'green' | 'red' | 'gray';

export interface UserMenuStorageStatusTag {
  key: 'local-store' | 'local-mode' | 'remote-provider' | 'remote-status';
  label: string;
  tone: UserMenuStorageStatusTone;
  detail: string;
}

export interface UserMenuStorageStatusView {
  local: UserMenuStorageStatusTag[];
  remote: UserMenuStorageStatusTag[] | null;
}

function resolveProviderLabel(storageType?: string | null): string {
  const normalizedStorageType = storageType?.trim();
  if (!normalizedStorageType) {
    return '未配置';
  }

  switch (normalizedStorageType.toLowerCase()) {
    case 'redis':
      return 'Redis';
    case 'upstash':
      return 'Upstash';
    default:
      return normalizedStorageType;
  }
}

function buildLocalTags(
  runtime: ResolvedProfileRuntime
): UserMenuStorageStatusView['local'] {
  if (runtime.runtimeKind === 'desktop-profile-sync') {
    return [
      {
        key: 'local-store',
        label: '本地 SQLite',
        tone: 'green',
        detail: '本地 SQLite 是日常读写主数据源；远端仅作为后台同步目标。',
      },
      {
        key: 'local-mode',
        label: '在使用',
        tone: 'green',
        detail: '本机优先保存修改，远端同步不会阻塞本地使用。',
      },
    ];
  }

  if (runtime.runtimeKind === 'desktop-local') {
    return [
      {
        key: 'local-store',
        label: '本地 SQLite',
        tone: 'green',
        detail: '本地 SQLite 是当前桌面端的日常读写主数据源。',
      },
    ];
  }

  return [
    {
      key: 'local-store',
      label: '本地浏览器',
      tone: 'green',
      detail: '本地浏览器存储用于当前设备；未配置远端同步。',
    },
    {
      key: 'local-mode',
      label: '本地模式',
      tone: 'green',
      detail: '当前仅使用本机存储，数据不会自动同步到远端。',
    },
  ];
}

function buildRemoteStatusDetail(
  providerLabel: string,
  status: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage?: string | null
): string {
  if (readErrorMessage?.trim()) {
    return `远端 ${providerLabel} 状态未知：${readErrorMessage.trim()}`;
  }

  if (!status) {
    return `远端 ${providerLabel} 状态未知，尚未读取同步状态。`;
  }

  const detail = buildDesktopProfileSyncStatusDetail(status);
  return (
    detail ||
    `远端 ${providerLabel} 状态：${buildDesktopProfileSyncStatusValue(
      status
    )}。`
  );
}

function resolveRemoteStatusTone(
  status: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage?: string | null
): UserMenuStorageStatusTone {
  if (readErrorMessage?.trim() || !status) {
    return 'gray';
  }

  if (!status.enabled) {
    return 'gray';
  }

  if (
    status.reachable &&
    !status.authenticated &&
    !status.reauthRequired &&
    !status.errorKind
  ) {
    return 'gray';
  }

  return status.reachable &&
    status.authenticated &&
    !status.reauthRequired &&
    !status.errorKind
    ? 'green'
    : 'red';
}

function resolveRemoteStatusLabel(
  status: DesktopProfileSyncStatus | null | undefined,
  tone: UserMenuStorageStatusTone,
  statusValue: string
): string {
  if (tone === 'gray') {
    if (status && !status.enabled) {
      return '未配置';
    }

    if (
      status?.reachable &&
      !status.authenticated &&
      !status.reauthRequired &&
      !status.errorKind
    ) {
      return '等待登录';
    }

    return statusValue;
  }

  if (!status?.reachable) {
    return '未连接';
  }

  if (status.reauthRequired || status.errorKind === 'unauthorized') {
    return '登录失效';
  }

  if (status.errorKind) {
    return '状态异常';
  }

  return tone === 'green' ? '已连接' : '未连接';
}

export function buildUserMenuStorageStatusView(
  runtime: ResolvedProfileRuntime,
  status: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage?: string | null
): UserMenuStorageStatusView {
  const local = buildLocalTags(runtime);
  if (runtime.runtimeKind !== 'desktop-profile-sync') {
    return { local, remote: null };
  }

  const providerLabel = resolveProviderLabel(
    status?.storageType || runtime.storageType
  );
  const isRemoteConfigured = Boolean(
    status?.enabled ||
      status?.storageType?.trim() ||
      runtime.storageType !== 'localstorage'
  );
  const statusTone = resolveRemoteStatusTone(status, readErrorMessage);
  const statusValue = readErrorMessage?.trim()
    ? '状态未知'
    : status
    ? buildDesktopProfileSyncStatusValue(status)
    : '状态未知';

  if (status && !status.enabled) {
    return {
      local,
      remote: [
        {
          key: 'remote-provider',
          label: '远端 未配置',
          tone: 'gray',
          detail: '尚未配置远端同步目标。',
        },
        {
          key: 'remote-status',
          label: '未配置',
          tone: 'gray',
          detail: '远端同步尚未配置。',
        },
      ],
    };
  }

  if (!isRemoteConfigured) {
    return { local, remote: null };
  }

  return {
    local,
    remote: [
      {
        key: 'remote-provider',
        label: `远端 ${providerLabel}`,
        tone: 'gray',
        detail: `远端 ${providerLabel} 是后台同步目标，不是本地日常读写主库。`,
      },
      {
        key: 'remote-status',
        label: resolveRemoteStatusLabel(status, statusTone, statusValue),
        tone: statusTone,
        detail:
          statusTone === 'green'
            ? `远端 ${providerLabel} 已连接并已登录，本地修改会在后台同步。`
            : buildRemoteStatusDetail(providerLabel, status, readErrorMessage),
      },
    ],
  };
}
