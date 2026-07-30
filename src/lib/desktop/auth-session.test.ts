import {
  clearAuthInfoInBrowser,
  getAuthInfoFromBrowserCookie,
  setAuthInfoInBrowser,
} from '@/lib/auth';
import {
  clearDesktopAdminCapability,
  getDesktopAdminCapability,
} from '@/lib/desktop/admin-capability';
import {
  DESKTOP_AUTH_LOGOUT_MARKER_KEY,
  ensureDesktopAuthSession,
  hasExplicitDesktopLogout,
  loginDesktopSession,
  logoutDesktopSession,
  restoreVerifiedDesktopAuthSession,
} from '@/lib/desktop/auth-session';
import {
  desktopLogin,
  getDesktopAuthSession,
  getDesktopAuthStatus,
} from '@/lib/desktop/tauri-client';
import { getRuntimeConfig } from '@/lib/runtime-config';

jest.mock('@/lib/auth', () => ({
  clearAuthInfoInBrowser: jest.fn(),
  getAuthInfoFromBrowserCookie: jest.fn(),
  setAuthInfoInBrowser: jest.fn(),
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(),
}));

jest.mock('@/lib/desktop/tauri-client', () => ({
  desktopLogin: jest.fn(),
  getDesktopAuthSession: jest.fn(),
  getDesktopAuthStatus: jest.fn(),
  isDesktopTauriRuntimeAvailable: jest.fn(() => true),
}));

describe('desktop auth session helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearDesktopAdminCapability();
    localStorage.clear();
    (getRuntimeConfig as jest.Mock).mockReturnValue({
      APP_TARGET: 'desktop',
    });
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue(null);
  });

  it('restores a passwordless owner session when desktop auth does not require a password', async () => {
    const authStatus = {
      username: 'owner',
      passwordRequired: false,
      multiUser: false,
      ownerPasswordConfigured: false,
    };
    (getDesktopAuthStatus as jest.Mock).mockResolvedValue(authStatus);
    (desktopLogin as jest.Mock).mockResolvedValue({
      username: 'owner',
      role: 'owner',
      adminCapability: 'owner-capability',
    });

    await expect(ensureDesktopAuthSession()).resolves.toEqual(authStatus);

    expect(desktopLogin).toHaveBeenCalledWith('owner', '');
    expect(getDesktopAdminCapability()).toBe('owner-capability');
    expect(setAuthInfoInBrowser).toHaveBeenCalledWith({
      username: 'owner',
      role: 'owner',
      sessionMode: 'desktop-local',
    });
  });

  it('does not restore the passwordless session after an explicit logout', async () => {
    const authStatus = {
      username: 'owner',
      passwordRequired: false,
      multiUser: false,
      ownerPasswordConfigured: false,
    };
    localStorage.setItem(DESKTOP_AUTH_LOGOUT_MARKER_KEY, '1');
    (getDesktopAuthStatus as jest.Mock).mockResolvedValue(authStatus);

    await expect(ensureDesktopAuthSession()).resolves.toEqual(authStatus);

    expect(setAuthInfoInBrowser).not.toHaveBeenCalled();
    expect(clearAuthInfoInBrowser).not.toHaveBeenCalled();
  });

  it('persists explicit desktop logout state when requested', () => {
    logoutDesktopSession({
      rememberLoggedOut: true,
    });

    expect(clearAuthInfoInBrowser).toHaveBeenCalledTimes(1);
    expect(hasExplicitDesktopLogout()).toBe(true);
  });

  it('clears explicit desktop logout state after a successful desktop login', async () => {
    localStorage.setItem(DESKTOP_AUTH_LOGOUT_MARKER_KEY, '1');
    (desktopLogin as jest.Mock).mockResolvedValue({
      username: 'owner',
      role: 'owner',
    });

    await expect(loginDesktopSession(undefined, '')).resolves.toEqual({
      username: 'owner',
      role: 'owner',
    });

    expect(hasExplicitDesktopLogout()).toBe(false);
    expect(setAuthInfoInBrowser).toHaveBeenCalledWith({
      username: 'owner',
      role: 'owner',
      sessionMode: 'desktop-local',
    });
  });

  it('keeps the native admin capability only after owner or admin login', async () => {
    (desktopLogin as jest.Mock).mockResolvedValue({
      username: 'owner',
      role: 'owner',
      adminCapability: 'owner-capability',
    });

    await loginDesktopSession(undefined, 'secret');

    expect(getDesktopAdminCapability()).toBe('owner-capability');
  });

  it('restores a verified native admin session after a page reload', async () => {
    (getDesktopAuthSession as jest.Mock).mockResolvedValue({
      username: 'desktop-admin',
      role: 'admin',
      adminCapability: 'restored-capability',
    });

    await expect(restoreVerifiedDesktopAuthSession()).resolves.toEqual({
      username: 'desktop-admin',
      role: 'admin',
      adminCapability: 'restored-capability',
    });

    expect(getDesktopAdminCapability()).toBe('restored-capability');
    expect(setAuthInfoInBrowser).toHaveBeenCalledWith({
      username: 'desktop-admin',
      role: 'admin',
      sessionMode: 'desktop-local',
    });
  });

  it('does not restore the native session after an explicit logout', async () => {
    localStorage.setItem(DESKTOP_AUTH_LOGOUT_MARKER_KEY, '1');

    await expect(restoreVerifiedDesktopAuthSession()).resolves.toBeNull();

    expect(getDesktopAuthSession).not.toHaveBeenCalled();
  });

  it('does not promote a verified regular user while checking admin access', async () => {
    (getDesktopAuthSession as jest.Mock).mockResolvedValue({
      username: 'kid',
      role: 'user',
    });

    await expect(restoreVerifiedDesktopAuthSession()).resolves.toEqual({
      username: 'kid',
      role: 'user',
    });

    expect(getDesktopAdminCapability()).toBeNull();
    expect(setAuthInfoInBrowser).not.toHaveBeenCalled();
  });

  it('does not retain a native admin capability for a regular user login', async () => {
    (desktopLogin as jest.Mock).mockResolvedValue({
      username: 'kid',
      role: 'user',
      adminCapability: 'unexpected-capability',
    });

    await loginDesktopSession('kid', 'secret');

    expect(getDesktopAdminCapability()).toBeNull();
  });

  it('clears the native admin capability on desktop logout', async () => {
    (desktopLogin as jest.Mock).mockResolvedValue({
      username: 'owner',
      role: 'owner',
      adminCapability: 'owner-capability',
    });
    await loginDesktopSession(undefined, 'secret');

    logoutDesktopSession();

    expect(getDesktopAdminCapability()).toBeNull();
  });

  it('restores the owner session when owner password is empty even in multi-user mode', async () => {
    const authStatus = {
      username: 'owner',
      passwordRequired: true,
      multiUser: true,
      ownerPasswordConfigured: false,
    };
    (getDesktopAuthStatus as jest.Mock).mockResolvedValue(authStatus);
    (desktopLogin as jest.Mock).mockResolvedValue({
      username: 'owner',
      role: 'owner',
      adminCapability: 'owner-capability',
    });

    await expect(ensureDesktopAuthSession()).resolves.toEqual(authStatus);

    expect(desktopLogin).toHaveBeenCalledWith('owner', '');
    expect(getDesktopAdminCapability()).toBe('owner-capability');
    expect(setAuthInfoInBrowser).toHaveBeenCalledWith({
      username: 'owner',
      role: 'owner',
      sessionMode: 'desktop-local',
    });
  });

  it('reacquires the native capability for a persisted passwordless owner', async () => {
    const authStatus = {
      username: 'owner',
      passwordRequired: false,
      multiUser: false,
      ownerPasswordConfigured: false,
    };
    (getDesktopAuthStatus as jest.Mock).mockResolvedValue(authStatus);
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      username: 'owner',
      role: 'owner',
      sessionMode: 'desktop-local',
    });
    (desktopLogin as jest.Mock).mockResolvedValue({
      username: 'owner',
      role: 'owner',
      adminCapability: 'owner-capability',
    });

    await ensureDesktopAuthSession();

    expect(desktopLogin).toHaveBeenCalledWith('owner', '');
    expect(getDesktopAdminCapability()).toBe('owner-capability');
  });

  it('preserves an existing local user session when owner password is empty', async () => {
    const authStatus = {
      username: 'owner',
      passwordRequired: true,
      multiUser: true,
      ownerPasswordConfigured: false,
    };
    (getDesktopAuthStatus as jest.Mock).mockResolvedValue(authStatus);
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      username: 'kid',
      role: 'user',
      sessionMode: 'desktop-local',
    });

    await expect(ensureDesktopAuthSession()).resolves.toEqual(authStatus);

    expect(setAuthInfoInBrowser).not.toHaveBeenCalled();
    expect(clearAuthInfoInBrowser).not.toHaveBeenCalled();
  });
});
