import { clearAuthInfoInBrowser, setAuthInfoInBrowser } from '@/lib/auth';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { apiFetch } from '@/lib/transport/api-client';

export type DesktopProfileSyncErrorKind =
  | 'not-configured'
  | 'invalid-base-url'
  | 'unreachable'
  | 'unauthorized'
  | 'protocol-incompatible'
  | 'upstream-failure';

export interface DesktopProfileSyncStatus {
  enabled: boolean;
  reachable: boolean;
  authenticated: boolean;
  username?: string | null;
  role?: 'owner' | 'admin' | 'user' | string | null;
  storageType?: string | null;
  profileMode?: 'single-user-local' | 'shared-multi-user' | string | null;
  error?: string | null;
  errorKind?: DesktopProfileSyncErrorKind | null;
  syncDomains?: readonly string[] | null;
}

function normalizeRole(
  role?: DesktopProfileSyncStatus['role']
): 'owner' | 'admin' | 'user' {
  if (role === 'owner' || role === 'admin') {
    return role;
  }

  return 'user';
}

export async function getDesktopProfileSyncStatus(): Promise<DesktopProfileSyncStatus | null> {
  if (getRuntimeConfig().APP_TARGET !== 'desktop') {
    return null;
  }

  const response = await apiFetch('/profile-sync/status', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to load profile sync status: ${response.status}`);
  }

  return (await response.json()) as DesktopProfileSyncStatus;
}

export function applyDesktopProfileSyncStatus(
  status: DesktopProfileSyncStatus
) {
  const currentConfig = getRuntimeConfig();
  const nextConfig = {
    ...currentConfig,
    PROFILE_SYNC_ENABLED: status.enabled,
    PROFILE_SYNC_STORAGE_TYPE: status.enabled
      ? status.storageType ?? currentConfig.PROFILE_SYNC_STORAGE_TYPE
      : undefined,
    PROFILE_SYNC_PROFILE_MODE: status.enabled
      ? (status.profileMode as
          | 'single-user-local'
          | 'shared-multi-user'
          | undefined) ?? currentConfig.PROFILE_SYNC_PROFILE_MODE
      : undefined,
  };

  if (typeof window === 'undefined') {
    return nextConfig;
  }

  window.RUNTIME_CONFIG = nextConfig;

  if (status.enabled) {
    if (status.authenticated && status.username?.trim()) {
      setAuthInfoInBrowser({
        username: status.username.trim(),
        role: normalizeRole(status.role),
        sessionMode: 'desktop-profile-sync',
      });
    } else {
      clearAuthInfoInBrowser();
    }
  }

  return window.RUNTIME_CONFIG;
}
