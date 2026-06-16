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

export const DESKTOP_AUTH_LOGOUT_MARKER_KEY =
  'lunatv:desktop-auth-explicit-logout';

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

function persistDesktopLogoutMarker(loggedOut: boolean) {
  if (typeof window === 'undefined' || !isDesktopTarget()) {
    return;
  }

  try {
    if (loggedOut) {
      localStorage.setItem(DESKTOP_AUTH_LOGOUT_MARKER_KEY, '1');
    } else {
      localStorage.removeItem(DESKTOP_AUTH_LOGOUT_MARKER_KEY);
    }
  } catch (_) {
    // Ignore storage write failures in restricted contexts.
  }
}

export function hasExplicitDesktopLogout(): boolean {
  if (typeof window === 'undefined' || !isDesktopTarget()) {
    return false;
  }

  try {
    return localStorage.getItem(DESKTOP_AUTH_LOGOUT_MARKER_KEY) === '1';
  } catch (_) {
    return false;
  }
}

export function clearExplicitDesktopLogout() {
  persistDesktopLogoutMarker(false);
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

  const canAutoRestoreOwnerSession = !authStatus.ownerPasswordConfigured;

  if (!canAutoRestoreOwnerSession) {
    if (
      authStatus.passwordRequired &&
      currentAuthInfo?.sessionMode !== 'desktop-local'
    ) {
      clearAuthInfoInBrowser();
    }

    return authStatus;
  }

  if (
    currentAuthInfo?.sessionMode === 'desktop-local' &&
    currentAuthInfo.username?.trim()
  ) {
    return authStatus;
  }

  if (hasExplicitDesktopLogout()) {
    if (currentAuthInfo?.sessionMode === 'desktop-local') {
      clearAuthInfoInBrowser();
    }

    return authStatus;
  }

  setAuthInfoInBrowser(buildDesktopAuthPayload(authStatus.username, 'owner'));
  return authStatus;
}

export async function loginDesktopSession(
  username: string | undefined,
  password: string
): Promise<DesktopAuthSession> {
  const session = await desktopLogin(username, password);
  clearExplicitDesktopLogout();
  setAuthInfoInBrowser(buildDesktopAuthPayload(session.username, session.role));
  return session;
}

export function logoutDesktopSession(options?: {
  rememberLoggedOut?: boolean;
}) {
  persistDesktopLogoutMarker(options?.rememberLoggedOut === true);
  clearAuthInfoInBrowser();
}
