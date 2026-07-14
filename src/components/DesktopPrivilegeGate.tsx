'use client';

import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  BROWSER_AUTH_UPDATED_EVENT,
  getAuthInfoFromBrowserCookie,
} from '@/lib/auth';
import {
  getDesktopAuthRequirement,
  loginDesktopSession,
} from '@/lib/desktop/auth-session';
import { getRuntimeConfig } from '@/lib/runtime-config';

interface DesktopPrivilegeGateProps {
  children: React.ReactNode;
}

export default function DesktopPrivilegeGate({
  children,
}: DesktopPrivilegeGateProps) {
  const [ready, setReady] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [usernameRequired, setUsernameRequired] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const refresh = async () => {
      if (getRuntimeConfig().APP_TARGET !== 'desktop') {
        setAuthorized(true);
        setReady(true);
        return;
      }

      const auth = getAuthInfoFromBrowserCookie();
      if (auth?.username && (auth.role === 'owner' || auth.role === 'admin')) {
        setAuthorized(true);
        setReady(true);
        return;
      }

      try {
        const requirement = await getDesktopAuthRequirement();
        setUsernameRequired(Boolean(requirement?.multiUser));
      } finally {
        setAuthorized(false);
        setReady(true);
      }
    };

    void refresh();
    window.addEventListener(BROWSER_AUTH_UPDATED_EVENT, refresh);
    return () =>
      window.removeEventListener(BROWSER_AUTH_UPDATED_EVENT, refresh);
  }, []);

  if (!ready) {
    return (
      <div className='rounded-2xl border border-white/10 bg-black/20 p-6 text-sm text-gray-300'>
        正在检查管理员身份...
      </div>
    );
  }

  if (authorized) {
    return <>{children}</>;
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const session = await loginDesktopSession(
        usernameRequired ? username.trim() : undefined,
        password
      );
      if (session.role !== 'owner' && session.role !== 'admin') {
        setError('当前账号没有管理员权限');
        return;
      }
      setAuthorized(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : '身份验证失败'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='mx-auto flex min-h-[60vh] w-full max-w-md items-center px-4'>
      <form
        onSubmit={submit}
        className='w-full rounded-3xl border border-white/10 bg-black/30 p-7 shadow-2xl backdrop-blur-xl'
      >
        <div className='mb-5 flex items-center gap-3'>
          <div className='flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400'>
            <ShieldCheck className='h-5 w-5' />
          </div>
          <div>
            <h1 className='text-lg font-semibold text-gray-100'>
              验证管理员身份
            </h1>
            <p className='text-sm text-gray-400'>管理设置前需要证明身份。</p>
          </div>
        </div>

        <div className='space-y-4'>
          {usernameRequired ? (
            <div>
              <label htmlFor='privilege-username' className='sr-only'>
                用户名
              </label>
              <input
                id='privilege-username'
                autoComplete='username'
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder='管理员用户名'
                className='w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-gray-100 outline-none focus:border-emerald-500'
              />
            </div>
          ) : null}
          <div>
            <label htmlFor='privilege-password' className='sr-only'>
              密码
            </label>
            <input
              id='privilege-password'
              type='password'
              autoComplete='current-password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder='管理员密码'
              className='w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-gray-100 outline-none focus:border-emerald-500'
            />
          </div>
        </div>

        {error ? <p className='mt-4 text-sm text-red-400'>{error}</p> : null}

        <button
          type='submit'
          disabled={
            loading || !password || (usernameRequired && !username.trim())
          }
          className='mt-6 w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50'
        >
          {loading ? '验证中...' : '验证并进入'}
        </button>
      </form>
    </div>
  );
}
