import {
  clearAuthInfoInBrowser,
  getAuthInfoFromBrowserCookie,
  setAuthInfoInBrowser,
} from '@/lib/auth';
import {
  applyDesktopProfileSyncStatus,
  describeDesktopProfileSyncStatusReadError,
  getDesktopProfileSyncStatus,
  readDesktopProfileSyncStatusState,
} from '@/lib/desktop/profile-sync';
import { PROFILE_SYNC_USER_DATA_DOMAINS } from '@/lib/profile/contracts';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { apiFetch } from '@/lib/transport/api-client';

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(),
}));

jest.mock('@/lib/transport/api-client', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  clearAuthInfoInBrowser: jest.fn(),
  getAuthInfoFromBrowserCookie: jest.fn(),
  setAuthInfoInBrowser: jest.fn(),
}));

describe('desktop profile sync helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getRuntimeConfig as jest.Mock).mockReturnValue({
      APP_TARGET: 'desktop',
      PROFILE_SYNC_ENABLED: false,
    });
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue(null);
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
      PROFILE_SYNC_ENABLED: false,
    };
  });

  it('skips status fetch outside desktop mode', async () => {
    (getRuntimeConfig as jest.Mock).mockReturnValue({
      APP_TARGET: 'web',
    });

    await expect(getDesktopProfileSyncStatus()).resolves.toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('loads the desktop profile sync payload with diagnostics metadata', async () => {
    const payload = {
      enabled: true,
      reachable: false,
      authenticated: false,
      username: null,
      role: null,
      storageType: null,
      profileMode: null,
      error: '远端账号同步后端不可达',
      errorKind: 'unreachable',
      syncDomains: [...PROFILE_SYNC_USER_DATA_DOMAINS],
    };

    (apiFetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(payload),
    });

    await expect(getDesktopProfileSyncStatus()).resolves.toEqual(payload);
    expect(apiFetch).toHaveBeenCalledWith('/profile-sync/status', {
      cache: 'no-store',
    });
  });

  it('normalizes profile sync read errors into a stable status payload', async () => {
    (apiFetch as jest.Mock).mockRejectedValue(
      new Error('local service unavailable')
    );

    await expect(readDesktopProfileSyncStatusState()).resolves.toEqual({
      status: undefined,
      error: 'local service unavailable',
    });
  });

  it('provides a fallback message when reading profile sync status fails silently', () => {
    expect(describeDesktopProfileSyncStatusReadError({})).toBe(
      '未能从本地服务读取 profile sync 状态。'
    );
  });

  it('projects authenticated sync state into runtime config and browser auth', () => {
    const status = {
      enabled: true,
      reachable: true,
      authenticated: true,
      username: 'kid',
      role: 'admin',
      storageType: 'redis',
      profileMode: 'shared-multi-user',
      error: null,
      errorKind: null,
      syncDomains: [...PROFILE_SYNC_USER_DATA_DOMAINS],
    } as const;

    const result = applyDesktopProfileSyncStatus(status);

    expect(result).toEqual({
      APP_TARGET: 'desktop',
      PROFILE_SYNC_ENABLED: true,
      PROFILE_SYNC_STORAGE_TYPE: 'redis',
      PROFILE_SYNC_PROFILE_MODE: 'shared-multi-user',
    });
    expect(setAuthInfoInBrowser).toHaveBeenCalledWith({
      username: 'kid',
      role: 'admin',
      sessionMode: 'desktop-profile-sync',
    });
    expect(clearAuthInfoInBrowser).not.toHaveBeenCalled();
  });

  it('clears browser auth when sync stays enabled but the remote session is absent', () => {
    applyDesktopProfileSyncStatus({
      enabled: true,
      reachable: true,
      authenticated: false,
      username: null,
      role: null,
      storageType: 'redis',
      profileMode: 'shared-multi-user',
      error: null,
      errorKind: null,
      syncDomains: [...PROFILE_SYNC_USER_DATA_DOMAINS],
    });

    expect(clearAuthInfoInBrowser).toHaveBeenCalled();
    expect(setAuthInfoInBrowser).not.toHaveBeenCalled();
  });

  it('clears stale desktop profile sync auth when remote sync is disabled', () => {
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      username: 'kid',
      role: 'user',
      sessionMode: 'desktop-profile-sync',
    });

    applyDesktopProfileSyncStatus({
      enabled: false,
      reachable: false,
      authenticated: false,
      username: null,
      role: null,
      storageType: null,
      profileMode: null,
      error: null,
      errorKind: 'not-configured',
      syncDomains: [...PROFILE_SYNC_USER_DATA_DOMAINS],
    });

    expect(clearAuthInfoInBrowser).toHaveBeenCalled();
    expect(setAuthInfoInBrowser).not.toHaveBeenCalled();
  });
});
