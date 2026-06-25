'use client';

import { Disc3 } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';

import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';
import { getRuntimeConfig } from '@/lib/runtime-config';

import MusicPageClient from '@/components/music/MusicPageClient';
import PageLayout from '@/components/PageLayout';

function MusicPageGuard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const syncEnabledState = () => {
      setEnabled(Boolean(getRuntimeConfig().ENABLE_WEB_MUSIC));
    };

    syncEnabledState();
    window.addEventListener(DESKTOP_RUNTIME_UPDATED_EVENT, syncEnabledState);

    return () => {
      window.removeEventListener(
        DESKTOP_RUNTIME_UPDATED_EVENT,
        syncEnabledState
      );
    };
  }, []);

  if (enabled === null) {
    return (
      <PageLayout activePath='/music'>
        <div className='min-h-[60vh]' />
      </PageLayout>
    );
  }

  if (!enabled) {
    return (
      <PageLayout activePath='/music'>
        <div className='flex min-h-[60vh] flex-col items-center justify-center px-4 text-center'>
          <Disc3 className='mb-4 h-16 w-16 text-slate-300 dark:text-slate-600' />
          <h2 className='text-xl font-semibold text-slate-800 dark:text-slate-100'>
            音乐模块暂未对当前运行环境开放
          </h2>
          <p className='mt-3 max-w-xl text-sm leading-7 text-slate-500 dark:text-slate-400'>
            当前首批版本默认只在 Web 侧启用。桌面端等桌面 Rust
            化路线里的本地服务数据面接好后，再继续补真实平台接入与离线能力。
          </p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/music'>
      <MusicPageClient />
    </PageLayout>
  );
}

export default function MusicPage() {
  return (
    <Suspense
      fallback={
        <PageLayout activePath='/music'>
          <div className='min-h-[60vh]' />
        </PageLayout>
      }
    >
      <MusicPageGuard />
    </Suspense>
  );
}
