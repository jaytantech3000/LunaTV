import { PROFILE_SYNC_USER_DATA_DOMAINS } from '@/lib/profile/contracts';

import type { DesktopProfileSyncStatus } from './profile-sync';

const PROFILE_SYNC_DOMAIN_LABELS: Record<string, string> = {
  playrecords: '播放记录',
  favorites: '收藏',
  follows: '追更',
  searchhistory: '搜索历史',
  skipconfigs: '跳过片头片尾',
};

function normalizeErrorMessage(errorMessage?: string | null): string {
  const normalized = errorMessage?.trim();
  return normalized || '';
}

export function resolveDesktopProfileSyncDomainsText(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined
): string {
  const domains =
    profileSyncStatus?.syncDomains && profileSyncStatus.syncDomains.length > 0
      ? profileSyncStatus.syncDomains
      : [...PROFILE_SYNC_USER_DATA_DOMAINS];

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

  if (!profileSyncStatus?.enabled) {
    return '未启用';
  }

  if (!profileSyncStatus.reachable) {
    return '已启用但不可达';
  }

  if (profileSyncStatus.errorKind === 'unauthorized') {
    return '已连接但登录失效';
  }

  return profileSyncStatus.authenticated ? '已连接并已登录' : '已连接';
}

export function buildDesktopProfileSyncStatusDetail(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage?: string | null
): string {
  const normalizedErrorMessage = normalizeErrorMessage(readErrorMessage);
  if (normalizedErrorMessage) {
    return `未能从本地服务读取 profile sync 状态。最近错误：${normalizedErrorMessage}`;
  }

  if (!profileSyncStatus) {
    return '尚未读取 profile sync 状态。';
  }

  const domainsText = resolveDesktopProfileSyncDomainsText(profileSyncStatus);

  if (!profileSyncStatus.enabled) {
    return `未配置 profile_sync.api_base_url，当前保持纯本地桌面模式。若后续启用远端同步，将同步：${domainsText}。`;
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
