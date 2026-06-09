'use client';

import { useEffect } from 'react';

import { ensureDesktopAuthSession } from '@/lib/desktop/auth-session';
import {
  applyDesktopProfileSyncStatus,
  getDesktopProfileSyncStatus,
} from '@/lib/desktop/profile-sync';
import {
  applyDesktopRuntimePublicConfig,
  DESKTOP_RUNTIME_REFRESH_EVENT,
  DESKTOP_RUNTIME_UPDATED_EVENT,
  DesktopRuntimePublicConfigPayload,
} from '@/lib/desktop/runtime-config';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { apiFetch } from '@/lib/transport/api-client';

async function refreshDesktopRuntimeConfig() {
  const response = await apiFetch('/runtime/public-config', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(
      `Failed to refresh desktop runtime config: ${response.status}`
    );
  }

  const payload = (await response.json()) as DesktopRuntimePublicConfigPayload;
  applyDesktopRuntimePublicConfig(payload);
  const nextRuntimeConfig = getRuntimeConfig();

  if (nextRuntimeConfig.PROFILE_SYNC_ENABLED) {
    const profileSyncStatus = await getDesktopProfileSyncStatus();
    if (profileSyncStatus) {
      applyDesktopProfileSyncStatus(profileSyncStatus);
    }
  } else {
    await ensureDesktopAuthSession();
  }

  window.dispatchEvent(new Event(DESKTOP_RUNTIME_UPDATED_EVENT));
}

export default function DesktopRuntimeSync() {
  useEffect(() => {
    if (getRuntimeConfig().APP_TARGET !== 'desktop') {
      return;
    }

    const handleRefresh = () => {
      void refreshDesktopRuntimeConfig().catch(() => undefined);
    };

    window.addEventListener(DESKTOP_RUNTIME_REFRESH_EVENT, handleRefresh);

    void refreshDesktopRuntimeConfig().catch(() => undefined);

    return () => {
      window.removeEventListener(DESKTOP_RUNTIME_REFRESH_EVENT, handleRefresh);
    };
  }, []);

  return null;
}
