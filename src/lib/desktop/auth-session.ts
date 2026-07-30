import {
  clearAuthInfoInBrowser,
  getAuthInfoFromBrowserCookie,
  setAuthInfoInBrowser,
} from '@/lib/auth';
import { getRuntimeConfig } from '@/lib/runtime-config';

import {
  clearDesktopAdminCapability,
  setDesktopAdminCapability,
} from './admin-capability';
import {
  DesktopAuthSession,
  DesktopAuthStatus,
  desktopLogin,
  getDesktopAuthSession,
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
    const isCurrentOwner =
      currentAuthInfo.username === authStatus.username &&
      (currentAuthInfo.role === 'owner' || currentAuthInfo.role === 'admin');
    if (!isCurrentOwner || authStatus.ownerPasswordConfigured) {
      return authStatus;
    }
  }

  if (hasExplicitDesktopLogout()) {
    if (currentAuthInfo?.sessionMode === 'desktop-local') {
      clearAuthInfoInBrowser();
    }

    return authStatus;
  }

  const session = await desktopLogin(authStatus.username, '');
  applyDesktopAuthSession(session);
  return authStatus;
}

export async function loginDesktopSession(
  username: string | undefined,
  password: string
): Promise<DesktopAuthSession> {
  const session = await desktopLogin(username, password);
  applyDesktopAuthSession(session);
  return session;
}

function applyDesktopAuthSession(session: DesktopAuthSession) {
  if (
    (session.role === 'owner' || session.role === 'admin') &&
    session.adminCapability
  ) {
    setDesktopAdminCapability(session.adminCapability);
  } else {
    clearDesktopAdminCapability();
  }
  clearExplicitDesktopLogout();
  setAuthInfoInBrowser(buildDesktopAuthPayload(session.username, session.role));
}

export async function restoreVerifiedDesktopAuthSession(): Promise<DesktopAuthSession | null> {
  if (
    !isDesktopTarget() ||
    !isDesktopTauriRuntimeAvailable() ||
    hasExplicitDesktopLogout()
  ) {
    return null;
  }

  const session = await getDesktopAuthSession();
  if (!session) {
    return null;
  }

  if (
    (session.role !== 'owner' && session.role !== 'admin') ||
    !session.adminCapability
  ) {
    clearDesktopAdminCapability();
    return session;
  }

  applyDesktopAuthSession(session);
  return session;
}

export function logoutDesktopSession(options?: {
  rememberLoggedOut?: boolean;
}) {
  clearDesktopAdminCapability();
  persistDesktopLogoutMarker(options?.rememberLoggedOut === true);
  clearAuthInfoInBrowser();
}
