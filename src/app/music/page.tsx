'use client';

import { Suspense } from 'react';

import MusicPageShell from '@/features/music/app/MusicPageShell';

export default function MusicPage() {
  return (
    <Suspense fallback={<div className='min-h-[60vh]' />}>
      <MusicPageShell />
    </Suspense>
  );
}
