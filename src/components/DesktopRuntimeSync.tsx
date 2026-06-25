'use client';

import { useEffect } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import {
  buildLoginPath,
  ensureDesktopAuthSession,
} from '@/lib/desktop/auth-session';
import {
  applyDesktopProfileBootstrap,
  getDesktopProfileBootstrap,
} from '@/lib/desktop/profile-bootstrap';
import {
  DESKTOP_RUNTIME_REFRESH_EVENT,
  DESKTOP_RUNTIME_UPDATED_EVENT,
} from '@/lib/desktop/runtime-config';
import { getRuntimeConfig } from '@/lib/runtime-config';

const INITIAL_REFRESH_MAX_ATTEMPTS = 10;
const INITIAL_REFRESH_RETRY_DELAY_MS = 1500;

function redirectDesktopLoginIfNeeded() {
  if (typeof window === 'undefined') {
    return;
  }

  const authInfo = getAuthInfoFromBrowserCookie();
  if (authInfo?.username) {
    return;
  }

  const currentPath = `${window.location.pathname}${window.location.search}`;
  if (
    window.location.pathname === '/login' ||
    window.location.pathname === '/warning'
  ) {
    return;
  }

  window.location.replace(buildLoginPath(currentPath));
}

async function refreshDesktopRuntimeConfig() {
  const bootstrap = await getDesktopProfileBootstrap();
  if (!bootstrap) {
    return;
  }

  applyDesktopProfileBootstrap(bootstrap);
  if (!bootstrap.profileSync.enabled) {
    await ensureDesktopAuthSession();
  } else {
    // Profile sync status is already applied from the unified bootstrap payload.
  }

  redirectDesktopLoginIfNeeded();
  window.dispatchEvent(new Event(DESKTOP_RUNTIME_UPDATED_EVENT));
}

export default function DesktopRuntimeSync() {
  useEffect(() => {
    if (getRuntimeConfig().APP_TARGET !== 'desktop') {
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const refreshWithRetry = (attempt = 0) => {
      clearRetryTimer();

      void refreshDesktopRuntimeConfig().catch(() => {
        if (cancelled || attempt + 1 >= INITIAL_REFRESH_MAX_ATTEMPTS) {
          return;
        }

        retryTimer = window.setTimeout(() => {
          refreshWithRetry(attempt + 1);
        }, INITIAL_REFRESH_RETRY_DELAY_MS);
      });
    };

    const handleRefresh = () => {
      refreshWithRetry();
    };

    window.addEventListener(DESKTOP_RUNTIME_REFRESH_EVENT, handleRefresh);

    refreshWithRetry();

    return () => {
      cancelled = true;
      clearRetryTimer();
      window.removeEventListener(DESKTOP_RUNTIME_REFRESH_EVENT, handleRefresh);
    };
  }, []);

  return null;
}
