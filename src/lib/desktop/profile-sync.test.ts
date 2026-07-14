import {
  clearAuthInfoInBrowser,
  getAuthInfoFromBrowserCookie,
  setAuthInfoInBrowser,
} from '@/lib/auth';
import {
  type DesktopProfileSyncStatus,
  applyDesktopProfileSyncStatus,
  describeDesktopProfileSyncStatusReadError,
  executeDesktopProfileSyncOnboarding,
  getDesktopProfileSyncStatus,
  previewDesktopProfileSyncOnboarding,
  readDesktopProfileSyncStatusState,
  resolveDesktopProfileSyncState,
  restoreDesktopProfileSyncSession,
  syncDesktopProfileNow,
} from '@/lib/desktop/profile-sync';
import { PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS } from '@/lib/profile/contracts';
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
  it('accepts local-first outbox worker status fields from the local service contract', () => {
    const status: DesktopProfileSyncStatus = {
      enabled: true,
      reachable: true,
      authenticated: true,
      pendingOutboxCount: 2,
      reauthRequired: true,
      lastOutboxError: '远端账号同步后端返回 429',
      nextOutboxAttemptAt: 123456,
    };

    expect(status).toMatchObject({
      pendingOutboxCount: 2,
      reauthRequired: true,
      lastOutboxError: '远端账号同步后端返回 429',
      nextOutboxAttemptAt: 123456,
    });
  });

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
      syncDomains: [...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS],
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

  it('posts the onboarding preview request through the desktop local service', async () => {
    const payload = {
      remoteBaseUrl: 'https://luna.hkcu.qzz.io',
      currentRemoteUsername: 'remote-owner',
      currentRemoteRole: 'owner',
      plan: {
        currentLocalUsername: 'local-owner',
        currentRemoteUsername: 'remote-owner',
        items: [],
      },
      downloadPreview: {
        hasDownloads: false,
        currentOwnerUsername: null,
        targetUsername: null,
        taskCount: 0,
        libraryCount: 0,
      },
      warnings: [],
    };
    const requestPayload = {
      remoteBaseUrl: 'https://luna.hkcu.qzz.io',
      username: 'remote-owner',
      password: 'secret',
      currentLocalUsername: 'local-owner',
    };

    (apiFetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(payload),
    });

    await expect(
      previewDesktopProfileSyncOnboarding(requestPayload)
    ).resolves.toEqual(payload);
    expect(apiFetch).toHaveBeenCalledWith(
      '/admin/profile-sync/onboarding/preview',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        cache: 'no-store',
      }
    );
  });

  it('posts sync-now through the desktop local service', async () => {
    const responsePayload = {
      enabled: true,
      reachable: true,
      authenticated: true,
      username: 'admin',
      role: 'owner',
      storageType: 'redis',
      profileMode: 'shared-multi-user',
      error: null,
      errorKind: null,
      syncDomains: ['playrecords', 'adminsettings'],
      lastSyncError: null,
    };

    (apiFetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(responsePayload),
    });

    await expect(
      syncDesktopProfileNow({
        syncDomains: ['playrecords', 'adminsettings'],
        strategy: 'local-first',
      })
    ).resolves.toEqual(responsePayload);

    expect(apiFetch).toHaveBeenCalledWith('/profile-sync/sync-now', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        syncDomains: ['playrecords', 'adminsettings'],
        strategy: 'local-first',
      }),
      cache: 'no-store',
    });
  });

  it('surfaces onboarding execute errors returned by the local service', async () => {
    const requestPayload = {
      remoteBaseUrl: 'https://luna.hkcu.qzz.io',
      username: 'remote-owner',
      password: 'secret',
      currentLocalUsername: 'local-owner',
      strategy: 'web-first' as const,
    };

    (apiFetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      clone: jest.fn().mockReturnValue({
        json: jest.fn().mockResolvedValue({
          error: '只有 Web owner/admin 可以开启帐号同步',
        }),
      }),
      text: jest.fn().mockResolvedValue(''),
    });

    await expect(
      executeDesktopProfileSyncOnboarding(requestPayload)
    ).rejects.toThrow('只有 Web owner/admin 可以开启帐号同步');
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

  it('does not silently restore desktop profile sync sessions from stored credentials', async () => {
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      username: 'cloud-owner',
      role: 'owner',
      password: 'secret',
      sessionMode: 'desktop-profile-sync',
    });

    await expect(restoreDesktopProfileSyncSession()).resolves.toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(setAuthInfoInBrowser).not.toHaveBeenCalled();
  });

  it('does not clear browser auth through removed silent session restoration', async () => {
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      username: 'cloud-owner',
      role: 'owner',
      password: 'secret',
      sessionMode: 'desktop-profile-sync',
    });

    await expect(restoreDesktopProfileSyncSession()).resolves.toBe(false);
    expect(clearAuthInfoInBrowser).not.toHaveBeenCalled();
    expect(setAuthInfoInBrowser).not.toHaveBeenCalled();
  });

  it('classifies reachable sync failures separately from offline and auth-expired states', () => {
    expect(
      resolveDesktopProfileSyncState({
        enabled: true,
        reachable: true,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        error: 'unexpected profile sync response',
        errorKind: 'protocol-incompatible',
        syncDomains: [...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS],
      })
    ).toBe('degraded');

    expect(
      resolveDesktopProfileSyncState({
        enabled: true,
        reachable: true,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        error: '远端账号同步后端返回 401',
        errorKind: 'unauthorized',
        syncDomains: [...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS],
      })
    ).toBe('auth-expired');
  });

  it('projects authenticated sync state into runtime config and browser auth', () => {
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      username: 'kid',
      role: 'admin',
      password: 'secret',
      sessionMode: 'desktop-profile-sync',
    });
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
      syncDomains: [...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS],
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
      password: 'secret',
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
      syncDomains: [...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS],
    });

    expect(clearAuthInfoInBrowser).toHaveBeenCalled();
    expect(setAuthInfoInBrowser).not.toHaveBeenCalled();
  });

  it('clears unauthenticated sync auth when no credential recovery exists', () => {
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      username: 'cloud-owner',
      role: 'owner',
      password: 'secret',
      sessionMode: 'desktop-profile-sync',
    });

    const result = applyDesktopProfileSyncStatus(
      {
        enabled: true,
        reachable: true,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        error: null,
        errorKind: null,
        syncDomains: [...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS],
      },
      {
        preserveStoredCredentials: true,
      }
    );

    expect(result).toEqual({
      APP_TARGET: 'desktop',
      PROFILE_SYNC_ENABLED: true,
      PROFILE_SYNC_STORAGE_TYPE: 'redis',
      PROFILE_SYNC_PROFILE_MODE: 'shared-multi-user',
    });
    expect(clearAuthInfoInBrowser).toHaveBeenCalledTimes(1);
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
      syncDomains: [...PROFILE_SYNC_DEFAULT_USER_DATA_DOMAINS],
    });

    expect(clearAuthInfoInBrowser).toHaveBeenCalled();
    expect(setAuthInfoInBrowser).not.toHaveBeenCalled();
  });
});
