import { Suspense } from 'react';

import DownloadsClient from '@/components/DownloadsClient';
import PageLayout from '@/components/PageLayout';

export default function DownloadsPage() {
  return (
    <Suspense fallback={<div className='min-h-screen' />}>
      <PageLayout activePath='/downloads'>
        <DownloadsClient />
      </PageLayout>
    </Suspense>
  );
}
