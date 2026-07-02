'use client';

import { Cloud } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';

import {
  BROWSER_AUTH_UPDATED_EVENT,
  getAuthInfoFromBrowserCookie,
} from '@/lib/auth';
import {
  type DesktopProfileSyncManualSyncResponse,
  type DesktopProfileSyncStatus,
  readDesktopProfileSyncStatusState,
  resolveDesktopProfileSyncState,
} from '@/lib/desktop/profile-sync';
import { DESKTOP_RUNTIME_REFRESH_EVENT } from '@/lib/desktop/runtime-config';
import {
  type DesktopAuthStatus,
  getDesktopAuthStatus,
  isDesktopTauriRuntimeAvailable,
} from '@/lib/desktop/tauri-client';
import {
  type ProfileSyncUserDataDomain,
  PROFILE_SYNC_ADMIN_SETTINGS_DOMAIN,
  PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS,
} from '@/lib/profile/contracts';
import { getRuntimeConfig } from '@/lib/runtime-config';

import DesktopProfileSyncOnboardingCard from '@/components/DesktopProfileSyncOnboardingCard';
import DesktopProfileSyncScopeCard from '@/components/DesktopProfileSyncScopeCard';
import PageLayout from '@/components/PageLayout';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

const DEFAULT_SELECTED_SYNC_DOMAINS = [
  ...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS,
];

function isAdminRole(
  role?: DesktopProfileSyncStatus['role'] | AuthInfo['role']
): role is 'owner' | 'admin' {
  return role === 'owner' || role === 'admin';
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizeSelectedSyncDomains(
  domains: readonly string[] | null | undefined,
  allowAdminSettings: boolean
): ProfileSyncUserDataDomain[] {
  const sourceDomains =
    domains && domains.length ? [...domains] : DEFAULT_SELECTED_SYNC_DOMAINS;
  const nextDomains: ProfileSyncUserDataDomain[] = [];

  sourceDomains.forEach((domain) => {
    if (
      domain !== 'playrecords' &&
      domain !== 'favorites' &&
      domain !== 'follows' &&
      domain !== 'searchhistory' &&
      domain !== 'skipconfigs' &&
      domain !== 'adminsettings'
    ) {
      return;
    }
    if (domain === PROFILE_SYNC_ADMIN_SETTINGS_DOMAIN && !allowAdminSettings) {
      return;
    }
    if (!nextDomains.includes(domain)) {
      nextDomains.push(domain);
    }
  });

  return nextDomains.length
    ? nextDomains
    : [...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS];
}

function buildAccountSyncSummaryValue(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage: string,
  syncFeedbackMessage: string
): string {
  if (readErrorMessage || syncFeedbackMessage.startsWith('同步失败：')) {
    return '需要处理';
  }

  const syncState = resolveDesktopProfileSyncState(profileSyncStatus);
  if (syncState === 'ready') {
    return '已连接并已登录';
  }

  if (syncState === 'disabled') {
    return '未启用';
  }

  return '需要处理';
}

function buildAccountSyncCurrentWebAccount(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage: string
): string {
  if (readErrorMessage) {
    return '无法读取';
  }

  if (!profileSyncStatus?.enabled) {
    return '未启用';
  }

  return profileSyncStatus.username?.trim() || '未登录';
}

function buildAccountSyncStatusLine(
  profileSyncStatus: DesktopProfileSyncStatus | null | undefined,
  readErrorMessage: string,
  syncFeedbackMessage: string
): string {
  if (readErrorMessage) {
    return '本地服务异常';
  }

  if (syncFeedbackMessage) {
    return syncFeedbackMessage;
  }

  switch (resolveDesktopProfileSyncState(profileSyncStatus)) {
    case 'disabled':
      return '当前仍在使用本地模式';
    case 'offline':
      return '远端不可达';
    case 'auth-expired':
      return '登录失效';
    case 'degraded':
      return '状态异常';
    case 'connected':
      return '已连接，等待登录';
    case 'ready':
      return '远端可达';
  }
}

export default function AccountSyncPage() {
  const [isReady, setIsReady] = useState(false);
  const [isDesktopTarget, setIsDesktopTarget] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [authStatus, setAuthStatus] = useState<DesktopAuthStatus | null>(null);
  const [profileSyncStatus, setProfileSyncStatus] =
    useState<DesktopProfileSyncStatus | null>();
  const [profileSyncStatusError, setProfileSyncStatusError] = useState('');
  const [selectedSyncDomains, setSelectedSyncDomains] = useState<
    ProfileSyncUserDataDomain[]
  >([...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS]);
  const [syncFeedbackMessage, setSyncFeedbackMessage] = useState('');

  useEffect(() => {
    let active = true;

    const syncAccountSyncState = async () => {
      const runtimeConfig = getRuntimeConfig();
      const desktopTarget = runtimeConfig.APP_TARGET === 'desktop';

      if (!active) {
        return;
      }

      setIsDesktopTarget(desktopTarget);
      setAuthInfo(getAuthInfoFromBrowserCookie());

      if (!desktopTarget) {
        setAuthStatus(null);
        setProfileSyncStatus(undefined);
        setProfileSyncStatusError('');
        setSelectedSyncDomains([...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS]);
        setIsReady(true);
        return;
      }

      try {
        const ipcAvailable = isDesktopTauriRuntimeAvailable();
        const [nextAuthStatus, nextProfileSyncResult] = await Promise.all([
          ipcAvailable ? getDesktopAuthStatus().catch(() => null) : null,
          readDesktopProfileSyncStatusState(),
        ]);

        if (!active) {
          return;
        }

        const nextStatus = nextProfileSyncResult.status;
        const allowAdminSettings = isAdminRole(nextStatus?.role);

        setAuthInfo(getAuthInfoFromBrowserCookie());
        setAuthStatus(nextAuthStatus);
        setProfileSyncStatus(nextStatus);
        setProfileSyncStatusError(nextProfileSyncResult.error);
        setSelectedSyncDomains(
          normalizeSelectedSyncDomains(
            nextStatus?.syncDomains,
            allowAdminSettings
          )
        );
        setSyncFeedbackMessage('');
      } finally {
        if (active) {
          setIsReady(true);
        }
      }
    };

    void syncAccountSyncState();
    window.addEventListener(BROWSER_AUTH_UPDATED_EVENT, syncAccountSyncState);
    window.addEventListener(
      DESKTOP_RUNTIME_REFRESH_EVENT,
      syncAccountSyncState
    );

    return () => {
      active = false;
      window.removeEventListener(
        BROWSER_AUTH_UPDATED_EVENT,
        syncAccountSyncState
      );
      window.removeEventListener(
        DESKTOP_RUNTIME_REFRESH_EVENT,
        syncAccountSyncState
      );
    };
  }, []);

  const allowAdminSettings = isAdminRole(profileSyncStatus?.role);

  useEffect(() => {
    setSelectedSyncDomains((current) => {
      const normalizedCurrent = normalizeSelectedSyncDomains(
        current,
        allowAdminSettings
      );

      return arraysEqual(current, normalizedCurrent)
        ? current
        : normalizedCurrent;
    });
  }, [allowAdminSettings]);

  const normalizedProfileSyncStatusError = profileSyncStatusError.trim();
  const summaryStatusValue = buildAccountSyncSummaryValue(
    profileSyncStatus,
    normalizedProfileSyncStatusError,
    syncFeedbackMessage
  );
  const summaryAccountValue = buildAccountSyncCurrentWebAccount(
    profileSyncStatus,
    normalizedProfileSyncStatusError
  );
  const summaryStatusLine = buildAccountSyncStatusLine(
    profileSyncStatus,
    normalizedProfileSyncStatusError,
    syncFeedbackMessage
  );

  const handleSyncSuccess = (
    nextStatus: DesktopProfileSyncManualSyncResponse
  ) => {
    const lastSyncError = nextStatus.lastSyncError?.trim();

    setProfileSyncStatus(nextStatus);
    setProfileSyncStatusError('');
    setSelectedSyncDomains(
      normalizeSelectedSyncDomains(
        nextStatus.syncDomains,
        isAdminRole(nextStatus.role)
      )
    );
    setSyncFeedbackMessage(
      lastSyncError ? `同步失败：${lastSyncError}` : '同步成功'
    );
  };

  const pageContent = (
    <PageLayout activePath='/account-sync'>
      <div className='mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-10 pt-6 sm:px-6 lg:px-8'>
        <section className='space-y-2'>
          <div className='text-xs font-medium uppercase tracking-[0.24em] text-emerald-600/80 dark:text-emerald-400/80'>
            桌面同步
          </div>
          <h1 className='text-3xl font-semibold text-gray-900 dark:text-gray-100'>
            帐号同步
          </h1>
        </section>

        {!isReady ? (
          <section className='rounded-lg border border-gray-200 bg-white px-4 py-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300'>
            正在读取桌面运行时状态...
          </section>
        ) : !isDesktopTarget ? (
          <section className='rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200'>
            当前不是桌面运行时。帐号同步页只在 Tauri 桌面壳内可用。
          </section>
        ) : (
          <>
            <section className='grid gap-4 lg:grid-cols-2'>
              <section className='rounded-lg border border-gray-200 bg-white px-5 py-5 dark:border-gray-800 dark:bg-gray-950 sm:px-6'>
                <div className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200'>
                  <Cloud className='h-4 w-4 text-gray-500 dark:text-gray-400' />
                  同步状态摘要
                </div>
                <div className='mt-4 text-2xl font-semibold text-gray-900 dark:text-gray-100'>
                  {summaryStatusValue}
                </div>
                <div className='mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-300'>
                  <div>
                    帐号：
                    <span className='ml-1 text-gray-900 dark:text-gray-100'>
                      {summaryAccountValue}
                    </span>
                  </div>
                  <div>
                    状态：
                    <span className='ml-1 text-gray-900 dark:text-gray-100'>
                      {summaryStatusLine}
                    </span>
                    {normalizedProfileSyncStatusError ? (
                      <Link
                        href='/config'
                        className='ml-2 font-medium text-emerald-700 underline underline-offset-2 dark:text-emerald-300'
                      >
                        去配置
                      </Link>
                    ) : null}
                  </div>
                </div>
              </section>

              <DesktopProfileSyncOnboardingCard
                currentLocalUsername={
                  authInfo?.username || authStatus?.username
                }
                profileSyncEnabled={Boolean(profileSyncStatus?.enabled)}
                selectedSyncDomains={selectedSyncDomains}
                isSyncUnavailable={Boolean(normalizedProfileSyncStatusError)}
                onSyncSuccess={handleSyncSuccess}
              />
            </section>

            <DesktopProfileSyncScopeCard
              selectedDomains={selectedSyncDomains}
              isAdminRole={allowAdminSettings}
              disabled={Boolean(normalizedProfileSyncStatusError)}
              onChange={(nextDomains) => {
                setSelectedSyncDomains(nextDomains);
                setSyncFeedbackMessage('');
              }}
            />
          </>
        )}
      </div>
    </PageLayout>
  );

  return (
    <Suspense
      fallback={
        <div className='min-h-screen bg-white px-4 pb-10 pt-6 text-sm text-gray-600 dark:bg-black dark:text-gray-300 sm:px-6 lg:px-8'>
          正在读取桌面运行时状态...
        </div>
      }
    >
      {pageContent}
    </Suspense>
  );
}
