'use client';

import { useEffect } from 'react';

import { syncDownloadOwner } from '@/lib/download/session';

export default function DownloadSessionSync() {
  useEffect(() => {
    void syncDownloadOwner();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncDownloadOwner();
      }
    };

    const handleFocus = () => {
      void syncDownloadOwner();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  return null;
}
