'use client';

import {
  Cloud,
  LockKeyhole,
  Server,
  ShieldCheck,
  UserCircle2,
} from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';

import {
  BROWSER_AUTH_UPDATED_EVENT,
  getAuthInfoFromBrowserCookie,
} from '@/lib/auth';
import {
  type DesktopProfileSyncStatus,
  readDesktopProfileSyncStatusState,
} from '@/lib/desktop/profile-sync';
import {
  buildDesktopProfileSyncStatusDetail,
  buildDesktopProfileSyncStatusValue,
} from '@/lib/desktop/profile-sync-status-copy';
import {
  type DesktopAuthStatus,
  type DesktopLocalServiceStatus,
  getDesktopAuthStatus,
  getLocalServiceStatus,
  isDesktopTauriRuntimeAvailable,
} from '@/lib/desktop/tauri-client';
import { getRuntimeConfig } from '@/lib/runtime-config';

import DesktopSettingsSection from '@/components/DesktopSettingsSection';
import PageLayout from '@/components/PageLayout';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

function StatusCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <section className='rounded-lg border border-gray-200 bg-white px-4 py-4 dark:border-gray-800 dark:bg-gray-950'>
      <div className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200'>
        <Icon className='h-4 w-4 text-gray-500 dark:text-gray-400' />
        {label}
      </div>
      <div className='mt-3 text-lg font-semibold text-gray-900 dark:text-gray-100'>
        {value}
      </div>
      <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
        {detail}
      </div>
    </section>
  );
}

export default function DesktopAdminPage() {
  const [isReady, setIsReady] = useState(false);
  const [isDesktopTarget, setIsDesktopTarget] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [authStatus, setAuthStatus] = useState<DesktopAuthStatus | null>(null);
  const [profileSyncStatus, setProfileSyncStatus] =
    useState<DesktopProfileSyncStatus | null>();
  const [profileSyncStatusError, setProfileSyncStatusError] = useState('');
  const [serviceStatus, setServiceStatus] =
    useState<DesktopLocalServiceStatus | null>(null);

  useEffect(() => {
    let active = true;

    const syncDesktopAdminState = async () => {
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
        setServiceStatus(null);
        setIsReady(true);
        return;
      }

      try {
        const ipcAvailable = isDesktopTauriRuntimeAvailable();
        const [nextAuthStatus, nextProfileSyncResult, nextServiceStatus] =
          await Promise.all([
            ipcAvailable ? getDesktopAuthStatus().catch(() => null) : null,
            readDesktopProfileSyncStatusState(),
            ipcAvailable ? getLocalServiceStatus().catch(() => null) : null,
          ]);

        if (!active) {
          return;
        }

        setAuthInfo(getAuthInfoFromBrowserCookie());
        setAuthStatus(nextAuthStatus);
        setProfileSyncStatus(nextProfileSyncResult.status);
        setProfileSyncStatusError(nextProfileSyncResult.error);
        setServiceStatus(nextServiceStatus);
      } finally {
        if (active) {
          setIsReady(true);
        }
      }
    };

    void syncDesktopAdminState();
    window.addEventListener(BROWSER_AUTH_UPDATED_EVENT, syncDesktopAdminState);

    return () => {
      active = false;
      window.removeEventListener(
        BROWSER_AUTH_UPDATED_EVENT,
        syncDesktopAdminState
      );
    };
  }, []);

  const accessControlValue = authStatus?.passwordRequired
    ? '已启用访问密码'
    : '未启用访问密码';
  const accessControlDetail = profileSyncStatus?.enabled
    ? authStatus?.passwordRequired
      ? '本地访问密码仅作为未启用云端同步时的回退认证；当前应用登录由云端同步代理负责。'
      : '当前已启用云端同步，本地访问密码配置处于可选回退状态。'
    : authStatus?.passwordRequired
    ? '下载和本地管理入口需要先登录。密码由本地 JSON 配置里的 auth.password 控制。'
    : '当前桌面实例未设置访问密码，会自动进入本地单用户会话。';

  const sessionDetail = profileSyncStatus?.enabled
    ? authInfo?.username
      ? '当前桌面使用云端同步账号，本地服务代持远端会话。登录入口在右上角用户菜单。'
      : '当前未登录云端账号。登录入口在右上角用户菜单。'
    : authInfo?.username
    ? '当前使用本地桌面会话。'
    : authStatus?.passwordRequired
    ? `当前需要使用 ${authStatus.username} 的本地访问密码登录。`
    : '未检测到需要登录的本地访问控制。';

  const pageContent = (
    <PageLayout activePath='/desktop-admin'>
      <div className='mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-10 pt-6 sm:px-6 lg:px-8'>
        <section className='space-y-2'>
          <div className='text-xs font-medium uppercase tracking-[0.24em] text-emerald-600/80 dark:text-emerald-400/80'>
            管理面板
          </div>
          <h1 className='text-3xl font-semibold text-gray-900 dark:text-gray-100'>
            桌面本地服务与配置
          </h1>
          <p className='max-w-3xl text-sm text-gray-600 dark:text-gray-400'>
            搜索、播放和媒体代理走本地 Rust HTTP 数据面；桌面配置和服务管理走
            Tauri IPC；若启用账号同步，则通过本地服务代理远端 Web
            后端，仅同步帐号和用户数据。
          </p>
        </section>

        {!isReady ? (
          <section className='rounded-lg border border-gray-200 bg-white px-4 py-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300'>
            正在读取桌面运行时状态...
          </section>
        ) : !isDesktopTarget ? (
          <section className='rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200'>
            当前不是桌面运行时。桌面管理面板只在 Tauri 桌面壳内可用。
          </section>
        ) : (
          <>
            <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
              <StatusCard
                icon={UserCircle2}
                label='当前会话'
                value={authInfo?.username || '未登录'}
                detail={sessionDetail}
              />
              <StatusCard
                icon={Cloud}
                label='账号同步'
                value={buildDesktopProfileSyncStatusValue(
                  profileSyncStatus,
                  profileSyncStatusError
                )}
                detail={buildDesktopProfileSyncStatusDetail(
                  profileSyncStatus,
                  profileSyncStatusError
                )}
              />
              <StatusCard
                icon={LockKeyhole}
                label='本地访问控制'
                value={accessControlValue}
                detail={accessControlDetail}
              />
              <StatusCard
                icon={Server}
                label='本地服务'
                value={serviceStatus?.running ? '运行中' : '未运行'}
                detail={
                  serviceStatus?.baseUrl
                    ? `数据面地址：${serviceStatus.baseUrl}`
                    : '本地服务状态由 Tauri IPC 读取。'
                }
              />
            </section>

            <DesktopSettingsSection isOpen={true} />
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
