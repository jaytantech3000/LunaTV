import { PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS } from '@/lib/profile/contracts';

import {
  type DesktopProfileSyncStatus,
  resolveDesktopProfileSyncState,
} from './profile-sync';

export interface DesktopProfileSyncDiagnosticItem {
  label: string;
  value: string;
}

const PROFILE_SYNC_DOMAIN_LABELS: Record<string, string> = {
  playrecords: '播放记录',
  favorites: '收藏',
  follows: '追更',
  searchhistory: '搜索历史',
  skipconfigs: '跳过片头片尾',
  adminsettings: '管理员设置',
};

function normalizeErrorMessage(errorMessage?: string | null): string {
  const normalized = errorMessage?.trim();
  return normalized || '';
}

function resolveDesktopProfileSyncReachabilityText(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage?: string | null
): string {
  if (normalizeErrorMessage(readErrorMessage)) {
    return '读取失败';
  }

  switch (resolveDesktopProfileSyncState(profileSyncStatus)) {
    case 'disabled':
      return '未启用';
    case 'offline':
      return '不可达';
    case 'auth-expired':
      return '可达，但登录失效';
    case 'degraded':
      return '可达，但状态异常';
    default:
      return '可达';
  }
}

function resolveDesktopProfileSyncAccountText(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage?: string | null
): string {
  if (normalizeErrorMessage(readErrorMessage)) {
    return '无法读取';
  }

  if (!profileSyncStatus?.enabled) {
    return '未启用';
  }

  const username = profileSyncStatus.username?.trim();
  return username || '未登录';
}

function resolveDesktopProfileSyncLastErrorText(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage?: string | null
): string {
  const normalizedReadErrorMessage = normalizeErrorMessage(readErrorMessage);
  if (normalizedReadErrorMessage) {
    return normalizedReadErrorMessage;
  }

  const normalizedStatusError = normalizeErrorMessage(profileSyncStatus?.error);
  return normalizedStatusError || '无';
}

export function resolveDesktopProfileSyncDomainsText(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined
): string {
  const domains =
    profileSyncStatus?.syncDomains && profileSyncStatus.syncDomains.length > 0
      ? profileSyncStatus.syncDomains
      : [...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS];

  return domains
    .map((domain) => PROFILE_SYNC_DOMAIN_LABELS[domain] || domain)
    .join('、');
}

export function buildDesktopProfileSyncErrorHint(
  errorKind?: DesktopProfileSyncStatus['errorKind']
): string {
  switch (errorKind) {
    case 'invalid-base-url':
      return '检查 profile_sync.api_base_url 是否是完整的 http/https 地址。';
    case 'unreachable':
      return '确认当前网络和远端 Web 站点可达。';
    case 'unauthorized':
      return '重新登录远端账号，确认远端会话仍然有效。';
    case 'protocol-incompatible':
      return '升级桌面端或 Web 端，确保 profile sync 协议版本一致。';
    case 'upstream-failure':
      return '检查远端 Web 后端日志，确认 /api/server-config 与账号接口正常返回。';
    default:
      return '';
  }
}

export function buildDesktopProfileSyncStatusValue(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage?: string | null
): string {
  if (normalizeErrorMessage(readErrorMessage)) {
    return '状态未知';
  }

  switch (resolveDesktopProfileSyncState(profileSyncStatus)) {
    case 'disabled':
      return '未启用';
    case 'offline':
      return '已启用但不可达';
    case 'auth-expired':
      return '已连接但登录失效';
    case 'degraded':
      return '已连接但状态异常';
    case 'ready':
      return '已连接并已登录';
    case 'connected':
      return '已连接';
  }
}

export function buildDesktopProfileSyncLoginStatusMessage(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined
): string {
  switch (resolveDesktopProfileSyncState(profileSyncStatus)) {
    case 'disabled':
      return '当前保持桌面本地登录。';
    case 'offline':
      return '云端账号同步服务当前不可用，请检查远端服务地址。';
    case 'auth-expired':
      return '云端账号登录已失效，请重新登录。';
    case 'degraded':
      switch (profileSyncStatus?.errorKind) {
        case 'invalid-base-url':
          return '云端账号同步配置无效，请检查远端服务地址。';
        case 'protocol-incompatible':
          return '云端账号同步协议不兼容，请升级桌面端或 Web 端。';
        case 'upstream-failure':
          return '云端账号同步服务异常，请检查远端 Web 后端。';
        default:
          return '云端账号同步状态异常，请检查远端服务。';
      }
    case 'connected':
    case 'ready':
      return '桌面版当前使用云端账号与用户数据同步。';
  }
}

export function buildDesktopProfileSyncStatusDetail(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage?: string | null
): string {
  const normalizedErrorMessage = normalizeErrorMessage(readErrorMessage);
  if (normalizedErrorMessage) {
    return `未能从本地服务读取 profile sync 状态。请前往配置页检查本地服务。最近错误：${normalizedErrorMessage}`;
  }

  if (!profileSyncStatus) {
    return '尚未读取 profile sync 状态。';
  }

  const domainsText = resolveDesktopProfileSyncDomainsText(profileSyncStatus);

  if (!profileSyncStatus.enabled) {
    return `当前保持纯本地桌面模式。若需要启用帐号同步，请前往帐号同步页开启帐号同步；启用后将同步：${domainsText}。`;
  }

  const modeText =
    profileSyncStatus.profileMode === 'shared-multi-user'
      ? '远端多用户'
      : profileSyncStatus.profileMode
      ? '远端单用户'
      : '远端模式待定';
  const storageText = profileSyncStatus.storageType
    ? `，远端存储：${profileSyncStatus.storageType}`
    : '';
  const accountText = profileSyncStatus.username?.trim()
    ? `，当前远端账号：${profileSyncStatus.username.trim()}`
    : '';
  const errorHint = buildDesktopProfileSyncErrorHint(
    profileSyncStatus.errorKind
  );

  const details = [
    `仅同步 ${domainsText}；内容搜索、播放和代理继续本地处理。`,
    `当前模式：${modeText}${storageText}${accountText}。`,
  ];

  if (profileSyncStatus.error) {
    details.push(`最近错误：${profileSyncStatus.error}`);
  }

  if (errorHint) {
    details.push(`建议：${errorHint}`);
  }

  return details.join(' ');
}

export function buildDesktopProfileSyncDiagnostics(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage?: string | null
): DesktopProfileSyncDiagnosticItem[] {
  return [
    {
      label: '远端可达性',
      value: resolveDesktopProfileSyncReachabilityText(
        profileSyncStatus,
        readErrorMessage
      ),
    },
    {
      label: '当前帐号',
      value: resolveDesktopProfileSyncAccountText(
        profileSyncStatus,
        readErrorMessage
      ),
    },
    {
      label: '最近错误',
      value: resolveDesktopProfileSyncLastErrorText(
        profileSyncStatus,
        readErrorMessage
      ),
    },
    {
      label: '同步范围',
      value: resolveDesktopProfileSyncDomainsText(profileSyncStatus),
    },
  ];
}
