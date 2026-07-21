import type { ResolvedProfileRuntime } from '@/lib/profile/contracts';

export type UserMenuStorageTagTone = 'green' | 'gray';

export interface UserMenuStorageTag {
  key: 'local' | 'remote';
  label: string;
  tone: UserMenuStorageTagTone;
  detail: string;
}

const REMOTE_PROVIDER_LABELS: Record<string, string> = {
  redis: 'Redis',
  upstash: 'Upstash',
};

function resolveRemoteTag(
  storageType: string
): Pick<UserMenuStorageTag, 'label' | 'detail'> {
  const normalizedStorageType = storageType.trim().toLowerCase();

  if (!normalizedStorageType || normalizedStorageType === 'localstorage') {
    return {
      label: '远端未配置',
      detail: '尚未配置远端同步目标。',
    };
  }

  const providerLabel = REMOTE_PROVIDER_LABELS[normalizedStorageType];
  if (providerLabel) {
    return {
      label: `远端 ${providerLabel}`,
      detail: `远端 ${providerLabel} 仅作后台同步目标。`,
    };
  }

  return {
    label: '远端存储',
    detail: '远端存储仅作后台同步目标。',
  };
}

export function buildUserMenuStorageTags(
  runtime: ResolvedProfileRuntime
): UserMenuStorageTag[] {
  if (runtime.appTarget !== 'desktop') {
    return [];
  }

  const localTag: UserMenuStorageTag = {
    key: 'local',
    label: '本地 SQLite',
    tone: 'green',
    detail: '本地 SQLite 是日常读写主数据源。',
  };

  if (!runtime.syncEnabled) {
    return [localTag];
  }

  const remoteTag = resolveRemoteTag(
    runtime.syncStorageType || runtime.storageType
  );

  return [
    localTag,
    {
      key: 'remote',
      label: remoteTag.label,
      tone: 'gray',
      detail: remoteTag.detail,
    },
  ];
}
