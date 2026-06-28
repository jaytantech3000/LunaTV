'use client';

import PageLayout from '@/components/PageLayout';

import { MusicShell } from '../components/MusicShell';

export default function MusicPageShell() {
  return (
    <PageLayout activePath='/music'>
      <MusicShell />
    </PageLayout>
  );
}
