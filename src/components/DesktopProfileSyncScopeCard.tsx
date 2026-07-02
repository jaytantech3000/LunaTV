'use client';

import {
  type ProfileSyncUserDataDomain,
  PROFILE_SYNC_ADMIN_SETTINGS_DOMAIN,
  PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS,
} from '@/lib/profile/contracts';

import { AppSurfaceCard } from '@/components/AppChrome';

const PROFILE_SYNC_DOMAIN_LABELS: Record<ProfileSyncUserDataDomain, string> = {
  playrecords: '播放记录',
  favorites: '收藏',
  follows: '追更',
  searchhistory: '搜索历史',
  skipconfigs: '跳过片头片尾',
  adminsettings: '管理员设置',
};

export interface DesktopProfileSyncScopeCardProps {
  selectedDomains: readonly ProfileSyncUserDataDomain[];
  isAdminRole: boolean;
  disabled?: boolean;
  onChange: (nextDomains: ProfileSyncUserDataDomain[]) => void;
}

export default function DesktopProfileSyncScopeCard({
  selectedDomains,
  isAdminRole,
  disabled = false,
  onChange,
}: DesktopProfileSyncScopeCardProps) {
  const availableDomains: readonly ProfileSyncUserDataDomain[] = isAdminRole
    ? [
        ...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS,
        PROFILE_SYNC_ADMIN_SETTINGS_DOMAIN,
      ]
    : PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS;
  const selectedDomainSet = new Set(selectedDomains);

  const handleToggle = (domain: ProfileSyncUserDataDomain) => {
    if (disabled) {
      return;
    }

    const nextDomains = selectedDomainSet.has(domain)
      ? selectedDomains.filter((item) => item !== domain)
      : [...selectedDomains, domain];

    onChange([...nextDomains]);
  };

  return (
    <AppSurfaceCard className='space-y-4 px-5 py-5 dark:bg-gray-950 sm:px-6'>
      <div className='space-y-1'>
        <h2 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
          管理同步范围
        </h2>
        <p className='text-sm text-gray-500 dark:text-gray-400'>
          勾选项会在点击“开启同步”或“同步”时一起保存并立即生效。
        </p>
      </div>

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
        {availableDomains.map((domain) => (
          <label
            key={domain}
            className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
              disabled
                ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-500'
                : selectedDomainSet.has(domain)
                ? 'cursor-pointer border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-100'
                : 'cursor-pointer border-gray-200 bg-white text-gray-700 dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-200'
            }`}
          >
            <input
              type='checkbox'
              aria-label={PROFILE_SYNC_DOMAIN_LABELS[domain]}
              checked={selectedDomainSet.has(domain)}
              disabled={disabled}
              onChange={() => handleToggle(domain)}
              className='mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 dark:border-gray-700 dark:bg-gray-900'
            />
            <span className='font-medium'>
              {PROFILE_SYNC_DOMAIN_LABELS[domain]}
            </span>
          </label>
        ))}
      </div>
    </AppSurfaceCard>
  );
}
