import {
  clearAuthInfoInBrowser,
  getAuthInfoFromBrowserCookie,
  setAuthInfoInBrowser,
} from '@/lib/auth';
import { getRuntimeConfig } from '@/lib/runtime-config';

import {
  DesktopAuthSession,
  DesktopAuthStatus,
  desktopLogin,
  getDesktopAuthStatus,
  isDesktopTauriRuntimeAvailable,
} from './tauri-client';

function isDesktopTarget(): boolean {
  return getRuntimeConfig().APP_TARGET === 'desktop';
}

function buildDesktopAuthPayload(
  username: string,
  role: 'owner' | 'admin' | 'user'
) {
  return {
    username,
    role,
    sessionMode: 'desktop-local' as const,
  };
}

export function buildLoginPath(redirectPath?: string): string {
  const searchParams = new URLSearchParams();
  if (redirectPath?.trim()) {
    searchParams.set('redirect', redirectPath);
  }

  const queryString = searchParams.toString();
  return queryString ? `/login?${queryString}` : '/login';
}

export async function getDesktopAuthRequirement(): Promise<DesktopAuthStatus | null> {
  if (!isDesktopTarget() || !isDesktopTauriRuntimeAvailable()) {
    return null;
  }

  return getDesktopAuthStatus();
}

export async function ensureDesktopAuthSession(): Promise<DesktopAuthStatus | null> {
  const authStatus = await getDesktopAuthRequirement();
  const currentAuthInfo = getAuthInfoFromBrowserCookie();

  if (!authStatus) {
    return authStatus;
  }

  if (authStatus.passwordRequired) {
    if (currentAuthInfo?.sessionMode !== 'desktop-local') {
      clearAuthInfoInBrowser();
    }

    return authStatus;
  }

  if (
    currentAuthInfo?.username !== authStatus.username ||
    currentAuthInfo?.role !== 'owner' ||
    currentAuthInfo?.sessionMode !== 'desktop-local'
  ) {
    setAuthInfoInBrowser(buildDesktopAuthPayload(authStatus.username, 'owner'));
  }

  return authStatus;
}

export async function loginDesktopSession(
  username: string | undefined,
  password: string
): Promise<DesktopAuthSession> {
  const session = await desktopLogin(username, password);
  setAuthInfoInBrowser(buildDesktopAuthPayload(session.username, session.role));
  return session;
}

export function logoutDesktopSession() {
  clearAuthInfoInBrowser();
}
