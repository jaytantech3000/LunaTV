'use client';

import { useEffect } from 'react';

import { BROWSER_AUTH_UPDATED_EVENT } from '@/lib/auth';
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

    const handleAuthUpdated = () => {
      void syncDownloadOwner();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener(BROWSER_AUTH_UPDATED_EVENT, handleAuthUpdated);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener(BROWSER_AUTH_UPDATED_EVENT, handleAuthUpdated);
    };
  }, []);

  return null;
}
