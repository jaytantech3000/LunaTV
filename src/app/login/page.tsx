/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { AlertCircle, CheckCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { setAuthInfoInBrowser } from '@/lib/auth';
import {
  ensureDesktopAuthSession,
  loginDesktopSession,
} from '@/lib/desktop/auth-session';
import {
  applyDesktopProfileSyncStatus,
  getDesktopProfileSyncStatus,
} from '@/lib/desktop/profile-sync';
import { apiFetch } from '@/lib/transport/api-client';
import { CURRENT_VERSION } from '@/lib/version';
import { checkForUpdates, UpdateStatus } from '@/lib/version_check';

import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

function shouldAskUsernameForProfileSync(
  profileMode?: 'single-user-local' | 'shared-multi-user' | string | null,
  storageType?: string | null
): boolean {
  if (profileMode) {
    return profileMode === 'shared-multi-user';
  }

  return Boolean(storageType && storageType !== 'localstorage');
}

// 版本显示组件
function VersionDisplay() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        setUpdateStatus(status);
      } catch (_) {
        // do nothing
      } finally {
        setIsChecking(false);
      }
    };

    checkUpdate();
  }, []);

  return (
    <button
      onClick={() =>
        window.open('https://github.com/MoonTechLab/LunaTV', '_blank')
      }
      className='absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 transition-colors cursor-pointer'
    >
      <span className='font-mono'>v{CURRENT_VERSION}</span>
      {!isChecking && updateStatus !== UpdateStatus.FETCH_FAILED && (
        <div
          className={`flex items-center gap-1.5 ${
            updateStatus === UpdateStatus.HAS_UPDATE
              ? 'text-yellow-600 dark:text-yellow-400'
              : updateStatus === UpdateStatus.NO_UPDATE
              ? 'text-green-600 dark:text-green-400'
              : ''
          }`}
        >
          {updateStatus === UpdateStatus.HAS_UPDATE && (
            <>
              <AlertCircle className='w-3.5 h-3.5' />
              <span className='font-semibold text-xs'>有新版本</span>
            </>
          )}
          {updateStatus === UpdateStatus.NO_UPDATE && (
            <>
              <CheckCircle className='w-3.5 h-3.5' />
              <span className='font-semibold text-xs'>已是最新</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);
  const [desktopAuthUsername, setDesktopAuthUsername] = useState('');
  const [desktopAuthLoading, setDesktopAuthLoading] = useState(false);
  const [desktopProfileSyncEnabled, setDesktopProfileSyncEnabled] =
    useState(false);
  const [desktopLocalMultiUser, setDesktopLocalMultiUser] = useState(false);
  const [desktopOwnerPasswordConfigured, setDesktopOwnerPasswordConfigured] =
    useState(false);
  const [desktopLoginMessage, setDesktopLoginMessage] = useState('');

  const { siteName } = useSite();

  // 在客户端挂载后设置配置
  useEffect(() => {
    let active = true;

    if (typeof window !== 'undefined') {
      const runtimeConfig = (window as any).RUNTIME_CONFIG;
      const storageType = runtimeConfig?.STORAGE_TYPE;
      setShouldAskUsername(storageType && storageType !== 'localstorage');

      if (runtimeConfig?.APP_TARGET === 'desktop') {
        setDesktopAuthLoading(true);

        void (async () => {
          try {
            const profileSyncStatus = await getDesktopProfileSyncStatus().catch(
              () => null
            );

            if (profileSyncStatus?.enabled) {
              if (!active) {
                return;
              }

              setDesktopProfileSyncEnabled(true);
              setShouldAskUsername(
                shouldAskUsernameForProfileSync(
                  profileSyncStatus.profileMode,
                  profileSyncStatus.storageType
                )
              );
              setDesktopLoginMessage(
                profileSyncStatus.reachable
                  ? '桌面版当前使用云端账号与用户数据同步。'
                  : '云端账号同步服务当前不可用，请检查远端服务地址。'
              );

              applyDesktopProfileSyncStatus(profileSyncStatus);

              if (profileSyncStatus.authenticated) {
                const redirect = searchParams.get('redirect') || '/';
                router.replace(redirect);
              }
              return;
            }

            const authStatus = await ensureDesktopAuthSession();
            if (!active || !authStatus) {
              return;
            }

            setDesktopAuthUsername(authStatus.username);
            setDesktopLocalMultiUser(authStatus.multiUser);
            setDesktopOwnerPasswordConfigured(
              authStatus.ownerPasswordConfigured
            );
            setShouldAskUsername(authStatus.multiUser);
            setDesktopLoginMessage(
              authStatus.multiUser
                ? authStatus.ownerPasswordConfigured
                  ? '桌面版当前使用本地多用户认证。'
                  : '桌面版当前使用本地多用户认证。站长未设置密码时，可直接使用站长用户名登录。'
                : '桌面版当前使用本地单用户认证。'
            );

            if (!authStatus.passwordRequired) {
              const redirect = searchParams.get('redirect') || '/';
              router.replace(redirect);
            }
          } catch (_) {
            if (active) {
              setError('桌面登录服务不可用，请通过桌面壳启动应用');
            }
          } finally {
            if (active) {
              setDesktopAuthLoading(false);
            }
          }
        })();
      }
    }
    return () => {
      active = false;
    };
  }, [router, searchParams]);

  const allowBlankDesktopOwnerPassword =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.APP_TARGET === 'desktop' &&
    !desktopProfileSyncEnabled &&
    desktopLocalMultiUser &&
    !desktopOwnerPasswordConfigured &&
    shouldAskUsername &&
    username.trim() === desktopAuthUsername;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if ((!password && !allowBlankDesktopOwnerPassword) || (shouldAskUsername && !username))
      return;

    try {
      setLoading(true);
      if ((window as any).RUNTIME_CONFIG?.APP_TARGET === 'desktop') {
        if (desktopProfileSyncEnabled) {
          const res = await apiFetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              password,
              ...(shouldAskUsername ? { username } : {}),
            }),
          });

          if (res.ok) {
            const profileSyncStatus = await getDesktopProfileSyncStatus();
            if (profileSyncStatus) {
              applyDesktopProfileSyncStatus(profileSyncStatus);
            } else {
              const data = await res.json().catch(() => ({}));
              if (data.username) {
                setAuthInfoInBrowser({
                  username: data.username,
                  role: data.role || 'user',
                  sessionMode: 'desktop-profile-sync',
                });
              }
            }

            const redirect = searchParams.get('redirect') || '/';
            router.replace(redirect);
            return;
          }

          if (res.status === 401) {
            setError(shouldAskUsername ? '用户名或密码错误' : '密码错误');
            return;
          }

          const data = await res.json().catch(() => ({}));
          setError(data.error ?? '服务器错误');
          return;
        }

        await loginDesktopSession(
          shouldAskUsername ? username.trim() : undefined,
          password
        );
        const redirect = searchParams.get('redirect') || '/';
        router.replace(redirect);
        return;
      }

      const res = await apiFetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
        }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/';
        router.replace(redirect);
      } else if (res.status === 401) {
        setError('密码错误');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='relative min-h-screen flex items-center justify-center px-4 overflow-hidden'>
      <div className='absolute top-4 right-4'>
        <ThemeToggle />
      </div>
      <div className='relative z-10 w-full max-w-md rounded-3xl bg-gradient-to-b from-white/90 via-white/70 to-white/40 dark:from-zinc-900/90 dark:via-zinc-900/70 dark:to-zinc-900/40 backdrop-blur-xl shadow-2xl p-10 dark:border dark:border-zinc-800'>
        <h1 className='text-green-600 tracking-tight text-center text-3xl font-extrabold mb-8 bg-clip-text drop-shadow-sm'>
          {siteName}
        </h1>
        <form onSubmit={handleSubmit} className='space-y-8'>
          {desktopLoginMessage ? (
            <div className='rounded-lg border border-gray-200/80 bg-white/50 px-4 py-3 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-gray-300'>
              {desktopLoginMessage}
              {desktopAuthUsername ? (
                <>
                  当前本地账号为
                  <span className='ml-1 font-semibold text-gray-900 dark:text-gray-100'>
                    {desktopAuthUsername}
                  </span>
                  。
                </>
              ) : null}
            </div>
          ) : null}

          {shouldAskUsername && (
            <div>
              <label htmlFor='username' className='sr-only'>
                用户名
              </label>
              <input
                id='username'
                type='text'
                autoComplete='username'
                className='block w-full rounded-lg border-0 py-3 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur'
                placeholder='输入用户名'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          )}

          <div>
            <label htmlFor='password' className='sr-only'>
              密码
            </label>
            <input
              id='password'
              type='password'
              autoComplete='current-password'
              className='block w-full rounded-lg border-0 py-3 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur'
              placeholder='输入访问密码'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
          )}

          {/* 登录按钮 */}
          <button
            type='submit'
            disabled={
              (!password && !allowBlankDesktopOwnerPassword) ||
              loading ||
              desktopAuthLoading ||
              (shouldAskUsername && !username)
            }
            className='inline-flex w-full justify-center rounded-lg bg-green-600 py-3 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:from-green-600 hover:to-blue-600 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {loading || desktopAuthLoading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>

      {/* 版本信息显示 */}
      <VersionDisplay />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageClient />
    </Suspense>
  );
}
