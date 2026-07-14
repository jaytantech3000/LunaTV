'use client';

import { useEffect } from 'react';

import { loadDesktopProfileBootstrapState } from '@/lib/desktop/profile-bootstrap';
import {
  DESKTOP_RUNTIME_REFRESH_EVENT,
  DESKTOP_RUNTIME_UPDATED_EVENT,
} from '@/lib/desktop/runtime-config';
import { getRuntimeConfig } from '@/lib/runtime-config';

const INITIAL_REFRESH_MAX_ATTEMPTS = 10;
const INITIAL_REFRESH_RETRY_DELAY_MS = 1500;

async function refreshDesktopRuntimeConfig(options?: {
  preferCachedPayload?: boolean;
}) {
  const bootstrapState = options
    ? await loadDesktopProfileBootstrapState({
        preferCachedPayload: options.preferCachedPayload,
      })
    : await loadDesktopProfileBootstrapState();
  if (!bootstrapState) {
    return;
  }

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

    const refreshWithRetry = (
      attempt = 0,
      options?: {
        preferCachedPayload?: boolean;
      }
    ) => {
      clearRetryTimer();

      void refreshDesktopRuntimeConfig(options).catch(() => {
        if (cancelled || attempt + 1 >= INITIAL_REFRESH_MAX_ATTEMPTS) {
          return;
        }

        retryTimer = window.setTimeout(() => {
          refreshWithRetry(attempt + 1, options);
        }, INITIAL_REFRESH_RETRY_DELAY_MS);
      });
    };

    const handleRefresh = () => {
      refreshWithRetry();
    };

    window.addEventListener(DESKTOP_RUNTIME_REFRESH_EVENT, handleRefresh);

    refreshWithRetry(0, {
      preferCachedPayload: true,
    });

    return () => {
      cancelled = true;
      clearRetryTimer();
      window.removeEventListener(DESKTOP_RUNTIME_REFRESH_EVENT, handleRefresh);
    };
  }, []);

  return null;
}
