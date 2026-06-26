/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { AlertCircle, CheckCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { setAuthInfoInBrowser } from '@/lib/auth';
import {
  getDesktopAuthRequirement,
  hasExplicitDesktopLogout,
  loginDesktopSession,
} from '@/lib/desktop/auth-session';
import { loadDesktopProfileBootstrapState } from '@/lib/desktop/profile-bootstrap';
import type { DesktopAuthStatus } from '@/lib/desktop/tauri-client';
import { getProjectPageUrl } from '@/lib/release-urls';
import { getRuntimeConfig } from '@/lib/runtime-config';
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

function resolveLoginErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  if (error && typeof error === 'object') {
    const maybeMessage =
      'message' in error && typeof error.message === 'string'
        ? error.message.trim()
        : '';
    if (maybeMessage) {
      return maybeMessage;
    }
  }

  return fallbackMessage;
}

function VersionDisplay() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        setUpdateStatus(status);
      } catch (_) {
        // Ignore update check failures here.
      } finally {
        setIsChecking(false);
      }
    };

    void checkUpdate();
  }, []);

  return (
    <button
      onClick={() => window.open(getProjectPageUrl(), '_blank')}
      className='absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 text-xs text-gray-500 transition-colors dark:text-gray-400'
    >
      <span className='font-mono'>v{CURRENT_VERSION}</span>
      {!isChecking && updateStatus !== UpdateStatus.FETCH_FAILED ? (
        <div
          className={`flex items-center gap-1.5 ${
            updateStatus === UpdateStatus.HAS_UPDATE
              ? 'text-yellow-600 dark:text-yellow-400'
              : updateStatus === UpdateStatus.NO_UPDATE
              ? 'text-green-600 dark:text-green-400'
              : ''
          }`}
        >
          {updateStatus === UpdateStatus.HAS_UPDATE ? (
            <>
              <AlertCircle className='h-3.5 w-3.5' />
              <span className='text-xs font-semibold'>有新版本</span>
            </>
          ) : null}
          {updateStatus === UpdateStatus.NO_UPDATE ? (
            <>
              <CheckCircle className='h-3.5 w-3.5' />
              <span className='text-xs font-semibold'>已是最新</span>
            </>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

export function LoginPageClient() {
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
  const [desktopOwnerPasswordConfigured, setDesktopOwnerPasswordConfigured] =
    useState(false);
  const [desktopAuthCheckDone, setDesktopAuthCheckDone] = useState(false);
  const [redirectingDesktopSession, setRedirectingDesktopSession] =
    useState(false);
  const [clientReady, setClientReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const { siteName } = useSite();
  const isDesktopTarget = getRuntimeConfig().APP_TARGET === 'desktop';

  useEffect(() => {
    let active = true;
    setClientReady(true);

    if (typeof window === 'undefined') {
      return () => {
        active = false;
      };
    }

    const runtimeConfig = getRuntimeConfig();

    if (runtimeConfig?.APP_TARGET !== 'desktop') {
      const storageType = runtimeConfig?.STORAGE_TYPE;
      setShouldAskUsername(
        Boolean(storageType && storageType !== 'localstorage')
      );
      setDesktopAuthCheckDone(true);
      setRedirectingDesktopSession(false);
      return () => {
        active = false;
      };
    }

    setDesktopAuthLoading(true);
    setDesktopAuthCheckDone(false);
    setRedirectingDesktopSession(false);
    setError(null);
    setStatusMessage('');

    const applyLocalDesktopAuthState = (
      effectiveAuthStatus: DesktopAuthStatus,
      nextStatusMessage = ''
    ) => {
      setDesktopProfileSyncEnabled(false);
      setDesktopAuthUsername(effectiveAuthStatus.username);
      setDesktopOwnerPasswordConfigured(
        effectiveAuthStatus.ownerPasswordConfigured
      );
      const didExplicitDesktopLogout = hasExplicitDesktopLogout();
      const requiresManualUsername =
        effectiveAuthStatus.multiUser || didExplicitDesktopLogout;
      setShouldAskUsername(requiresManualUsername);
      setUsername('');
      setStatusMessage(nextStatusMessage);

      return {
        didExplicitDesktopLogout,
      };
    };

    void (async () => {
      try {
        const bootstrapState = await loadDesktopProfileBootstrapState({
          localAuthMode: 'best-effort',
          preferCachedPayload: true,
        });
        if (!bootstrapState) {
          setDesktopAuthCheckDone(true);
          return;
        }

        const { payload: bootstrap, localAuth: effectiveAuthStatus } =
          bootstrapState;
        const { profileSync: profileSyncStatus } = bootstrap;

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
          setStatusMessage(
            profileSyncStatus.reachable
              ? '桌面版当前使用云端账号与用户数据同步。'
              : '云端账号同步服务当前不可用，请检查远端服务地址。'
          );

          if (profileSyncStatus.authenticated) {
            setRedirectingDesktopSession(true);
            const redirect = searchParams.get('redirect') || '/';
            router.replace(redirect);
            return;
          }

          setDesktopAuthCheckDone(true);
          return;
        }

        if (!active) {
          return;
        }

        const { didExplicitDesktopLogout } =
          applyLocalDesktopAuthState(effectiveAuthStatus);

        if (
          !effectiveAuthStatus.ownerPasswordConfigured &&
          !didExplicitDesktopLogout
        ) {
          setRedirectingDesktopSession(true);
          const redirect = searchParams.get('redirect') || '/';
          router.replace(redirect);
          return;
        }

        setDesktopAuthCheckDone(true);
      } catch {
        if (active) {
          try {
            const fallbackAuthStatus = await getDesktopAuthRequirement();
            if (!active) {
              return;
            }

            if (fallbackAuthStatus) {
              const { didExplicitDesktopLogout } = applyLocalDesktopAuthState(
                fallbackAuthStatus,
                '本地服务当前不可用，已切换到桌面本地登录。'
              );

              if (
                !fallbackAuthStatus.ownerPasswordConfigured &&
                !didExplicitDesktopLogout
              ) {
                setRedirectingDesktopSession(true);
                const redirect = searchParams.get('redirect') || '/';
                router.replace(redirect);
                return;
              }

              setDesktopAuthCheckDone(true);
              return;
            }
          } catch {
            // Ignore the fallback failure and show the original desktop login error.
          }

          setError('桌面登录服务不可用，请通过桌面壳启动应用。');
          setDesktopAuthCheckDone(true);
        }
      } finally {
        if (active) {
          setDesktopAuthLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [router, searchParams]);

  const allowBlankDesktopOwnerPassword =
    typeof window !== 'undefined' &&
    isDesktopTarget &&
    !desktopProfileSyncEnabled &&
    !desktopOwnerPasswordConfigured &&
    (!shouldAskUsername || username.trim() === desktopAuthUsername);
  const shouldBlockLoginForm =
    !clientReady ||
    (isDesktopTarget && (!desktopAuthCheckDone || redirectingDesktopSession));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (
      (!password && !allowBlankDesktopOwnerPassword) ||
      (shouldAskUsername && !username.trim())
    ) {
      return;
    }

    try {
      setLoading(true);

      if ((window as any).RUNTIME_CONFIG?.APP_TARGET === 'desktop') {
        if (desktopProfileSyncEnabled) {
          const res = await apiFetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              password,
              ...(shouldAskUsername ? { username: username.trim() } : {}),
            }),
          });

          if (res.ok) {
            const bootstrapState = await loadDesktopProfileBootstrapState({
              localAuthMode: 'none',
            });
            if (bootstrapState) {
              // Runtime config and sync state are already applied by the shared bootstrap loader.
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
          ...(shouldAskUsername ? { username: username.trim() } : {}),
        }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/';
        router.replace(redirect);
      } else if (res.status === 401) {
        setError(shouldAskUsername ? '用户名或密码错误' : '密码错误');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch (error) {
      setError(resolveLoginErrorMessage(error, '网络错误，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='relative flex min-h-screen items-center justify-center overflow-hidden px-4'>
      <div className='absolute right-4 top-4'>
        <ThemeToggle />
      </div>
      <div className='relative z-10 w-full max-w-md rounded-3xl bg-gradient-to-b from-white/90 via-white/70 to-white/40 p-10 shadow-2xl backdrop-blur-xl dark:border dark:border-zinc-800 dark:from-zinc-900/90 dark:via-zinc-900/70 dark:to-zinc-900/40'>
        <h1 className='mb-8 text-center text-3xl font-extrabold tracking-tight text-green-600 drop-shadow-sm'>
          {siteName}
        </h1>
        {shouldBlockLoginForm ? (
          <div className='rounded-lg border border-gray-200/80 bg-white/50 px-4 py-3 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-gray-300'>
            {redirectingDesktopSession
              ? '正在进入应用...'
              : '正在检查登录状态...'}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className='space-y-8'>
            {statusMessage ? (
              <div className='rounded-lg border border-gray-200/80 bg-white/50 px-4 py-3 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-gray-300'>
                {statusMessage}
              </div>
            ) : null}

            {shouldAskUsername ? (
              <div>
                <label htmlFor='username' className='sr-only'>
                  用户名
                </label>
                <input
                  id='username'
                  type='text'
                  autoComplete='username'
                  className='block w-full rounded-lg border-0 bg-white/60 px-4 py-3 text-gray-900 shadow-sm ring-1 ring-white/60 backdrop-blur placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-zinc-800/60 dark:text-gray-100 dark:ring-white/20 dark:placeholder:text-gray-400 sm:text-base'
                  placeholder='输入用户名'
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            ) : null}

            <div>
              <label htmlFor='password' className='sr-only'>
                密码
              </label>
              <input
                id='password'
                type='password'
                autoComplete='current-password'
                className='block w-full rounded-lg border-0 bg-white/60 px-4 py-3 text-gray-900 shadow-sm ring-1 ring-white/60 backdrop-blur placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-zinc-800/60 dark:text-gray-100 dark:ring-white/20 dark:placeholder:text-gray-400 sm:text-base'
                placeholder='输入访问密码'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error ? (
              <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
            ) : null}

            <button
              type='submit'
              disabled={
                (!password && !allowBlankDesktopOwnerPassword) ||
                loading ||
                desktopAuthLoading ||
                (shouldAskUsername && !username.trim())
              }
              className='inline-flex w-full justify-center rounded-lg bg-green-600 py-3 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:from-green-600 hover:to-blue-600 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {loading || desktopAuthLoading ? '登录中...' : '登录'}
            </button>
          </form>
        )}
      </div>

      <VersionDisplay />
    </div>
  );
}
