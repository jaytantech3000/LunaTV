import { Suspense } from 'react';

import { LoginPageClient } from './LoginPageClient';

function LoginPageFallback() {
  return (
    <div className='relative flex min-h-screen items-center justify-center overflow-hidden px-4'>
      <div className='relative z-10 w-full max-w-md rounded-3xl bg-gradient-to-b from-white/90 via-white/70 to-white/40 p-10 shadow-2xl dark:border dark:border-zinc-800 dark:from-zinc-900/90 dark:via-zinc-900/70 dark:to-zinc-900/40'>
        <div className='mb-8 flex justify-center'>
          <div className='h-10 w-40 animate-pulse rounded-xl bg-green-100 dark:bg-zinc-800' />
        </div>
        <div className='space-y-8'>
          <div className='h-12 animate-pulse rounded-lg bg-white/70 dark:bg-zinc-800/70' />
          <div className='h-12 animate-pulse rounded-lg bg-white/70 dark:bg-zinc-800/70' />
          <div className='h-12 animate-pulse rounded-lg bg-green-200/80 dark:bg-green-900/40' />
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageClient />
    </Suspense>
  );
}
