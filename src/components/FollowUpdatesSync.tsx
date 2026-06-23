'use client';

import { useEffect } from 'react';

import { BROWSER_AUTH_UPDATED_EVENT } from '@/lib/auth';
import {
  isDesktopFollowUpdatesEnabled,
  refreshFollowRecords,
} from '@/lib/follow-updates';

export default function FollowUpdatesSync() {
  useEffect(() => {
    if (!isDesktopFollowUpdatesEnabled()) {
      return;
    }

    void refreshFollowRecords();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshFollowRecords();
      }
    };

    const handleFocus = () => {
      void refreshFollowRecords();
    };

    const handleAuthUpdated = () => {
      void refreshFollowRecords({
        force: true,
      });
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
