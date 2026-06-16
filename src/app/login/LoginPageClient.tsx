/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { startTransition, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

import { CURRENT_VERSION } from '@/lib/version';
import { checkForUpdates, UpdateStatus } from '@/lib/version_check';

import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

function resolveRedirectPath(searchParams: ReturnType<typeof useSearchParams>) {
  const redirect = searchParams.get('redirect') || '/';
  if (!redirect.startsWith('/') || redirect.startsWith('//')) {
    return '/';
  }

  return redirect;
}

type LoginPhase = 'idle' | 'verifying' | 'redirecting';

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

export function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = resolveRedirectPath(searchParams);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('idle');
  const [shouldAskUsername, setShouldAskUsername] = useState(false);

  const { siteName } = useSite();
  const isVerifying = loginPhase === 'verifying';
  const isRedirecting = loginPhase === 'redirecting';
  const isBusy = loginPhase !== 'idle';

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(
        Boolean(storageType && storageType !== 'localstorage')
      );
    }
  }, []);

  useEffect(() => {
    router.prefetch(redirectPath);
  }, [redirectPath, router]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const normalizedUsername = username.trim();

    if (!password) {
      setError('密码不能为空');
      return;
    }

    if (shouldAskUsername && !normalizedUsername) {
      setError('用户名不能为空');
      return;
    }

    let shouldKeepBusyState = false;

    try {
      setLoginPhase('verifying');
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username: normalizedUsername } : {}),
        }),
      });

      if (res.ok) {
        shouldKeepBusyState = true;
        flushSync(() => {
          setLoginPhase('redirecting');
        });

        const navigate = () => {
          startTransition(() => {
            router.replace(redirectPath);
          });
        };

        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          window.requestAnimationFrame(() => {
            navigate();
          });
        } else {
          window.setTimeout(() => {
            navigate();
          }, 0);
        }

        return;
      }

      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(data?.error || (res.status >= 500 ? '服务器错误' : '登录失败'));
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      if (!shouldKeepBusyState) {
        setLoginPhase('idle');
      }
    }
  };

  return (
    <div className='relative min-h-screen flex items-center justify-center px-4 overflow-hidden'>
      {isBusy && (
        <div className='fixed inset-0 z-20 flex items-center justify-center bg-white/35 backdrop-blur-md dark:bg-black/45'>
          <div className='mx-4 flex max-w-[min(92vw,420px)] items-center gap-3 rounded-2xl border border-emerald-200/70 bg-white/88 px-5 py-4 text-sm font-medium text-emerald-800 shadow-2xl shadow-emerald-950/10 dark:border-emerald-900/40 dark:bg-zinc-900/88 dark:text-emerald-200'>
            <Loader2 className='h-5 w-5 shrink-0 animate-spin text-emerald-500 dark:text-emerald-300' />
            <div className='space-y-1'>
              <p>{isRedirecting ? '登录成功' : '正在验证身份'}</p>
              <p className='text-xs text-emerald-700/80 dark:text-emerald-200/80'>
                {isRedirecting
                  ? '正在进入内容页...'
                  : '请稍候，正在完成登录校验...'}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className='absolute top-4 right-4'>
        <ThemeToggle />
      </div>
      <div className='relative z-10 w-full max-w-md rounded-3xl bg-gradient-to-b from-white/90 via-white/70 to-white/40 dark:from-zinc-900/90 dark:via-zinc-900/70 dark:to-zinc-900/40 backdrop-blur-xl shadow-2xl p-10 dark:border dark:border-zinc-800'>
        <h1 className='text-green-600 tracking-tight text-center text-3xl font-extrabold mb-8 bg-clip-text drop-shadow-sm'>
          {siteName}
        </h1>
        <form onSubmit={handleSubmit} className='space-y-8'>
          {shouldAskUsername && (
            <div>
              <label htmlFor='username' className='sr-only'>
                用户名
              </label>
              <input
                id='username'
                type='text'
                autoComplete='username'
                disabled={isBusy}
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
              disabled={isBusy}
              className='block w-full rounded-lg border-0 py-3 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-green-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur'
              placeholder='输入访问密码'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
          )}

          <button
            type='submit'
            disabled={
              !password || isBusy || (shouldAskUsername && !username.trim())
            }
            className='inline-flex w-full justify-center rounded-lg bg-green-600 py-3 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:from-green-600 hover:to-blue-600 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {isRedirecting
              ? '正在进入...'
              : isVerifying
              ? '正在验证...'
              : '登录'}
          </button>
        </form>
      </div>

      <VersionDisplay />
    </div>
  );
}
