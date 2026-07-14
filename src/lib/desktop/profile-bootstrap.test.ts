import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { ensureDesktopAuthSession } from '@/lib/desktop/auth-session';
import {
  applyDesktopProfileBootstrap,
  getDesktopProfileBootstrap,
  loadDesktopProfileBootstrapState,
} from '@/lib/desktop/profile-bootstrap';
import {
  applyDesktopProfileSyncStatus,
  restoreDesktopProfileSyncSession,
} from '@/lib/desktop/profile-sync';
import { applyDesktopRuntimePublicConfig } from '@/lib/desktop/runtime-config';
import { startLocalService } from '@/lib/desktop/tauri-client';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { apiFetch } from '@/lib/transport/api-client';

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(),
}));

jest.mock('@/lib/transport/api-client', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('@/lib/desktop/auth-session', () => ({
  ensureDesktopAuthSession: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(),
}));

jest.mock('@/lib/desktop/profile-sync', () => ({
  applyDesktopProfileSyncStatus: jest.fn(),
  restoreDesktopProfileSyncSession: jest.fn(),
}));

jest.mock('@/lib/desktop/runtime-config', () => ({
  applyDesktopRuntimePublicConfig: jest.fn(),
}));

jest.mock('@/lib/desktop/tauri-client', () => ({
  isDesktopTauriRuntimeAvailable: jest.fn(() => true),
  startLocalService: jest.fn(),
}));

describe('desktop profile bootstrap helpers', () => {
  const mutableWindow = window as Window & {
    __DESKTOP_PROFILE_BOOTSTRAP__?: unknown;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiFetch as jest.Mock).mockReset();
    (restoreDesktopProfileSyncSession as jest.Mock).mockReset();
    delete mutableWindow.__DESKTOP_PROFILE_BOOTSTRAP__;
    (getRuntimeConfig as jest.Mock).mockReturnValue({
      APP_TARGET: 'desktop',
    });
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue(null);
  });

  it('restores a saved desktop profile sync session before applying bootstrap state', async () => {
    const initialPayload = {
      appTarget: 'desktop',
      runtime: {
        siteName: 'Bootstrap LunaTV',
        profileSyncEnabled: true,
      },
      profileSync: {
        enabled: true,
        reachable: true,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        error: null,
        errorKind: null,
        syncDomains: ['playrecords'],
      },
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: true,
        ownerPasswordConfigured: true,
      },
    };
    const restoredPayload = {
      ...initialPayload,
      profileSync: {
        ...initialPayload.profileSync,
        authenticated: true,
        username: 'cloud-owner',
        role: 'owner',
      },
    };

    (apiFetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(initialPayload),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(restoredPayload),
      });
    (restoreDesktopProfileSyncSession as jest.Mock).mockResolvedValue(true);

    await expect(loadDesktopProfileBootstrapState()).resolves.toEqual({
      payload: restoredPayload,
      localAuth: restoredPayload.localAuth,
    });

    expect(restoreDesktopProfileSyncSession).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(applyDesktopProfileSyncStatus).toHaveBeenCalledWith(
      restoredPayload.profileSync
    );
  });

  it('applies the cached unauthenticated payload when password recovery is unavailable', async () => {
    const initialPayload = {
      appTarget: 'desktop',
      runtime: {
        siteName: 'Bootstrap LunaTV',
        profileSyncEnabled: true,
      },
      profileSync: {
        enabled: true,
        reachable: true,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        error: null,
        errorKind: null,
        syncDomains: ['playrecords'],
      },
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: true,
        ownerPasswordConfigured: true,
      },
    };

    (apiFetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(initialPayload),
      })
      .mockRejectedValueOnce(new Error('refresh failed'));
    (restoreDesktopProfileSyncSession as jest.Mock).mockResolvedValue(true);
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      username: 'cloud-owner',
      role: 'owner',
      password: 'secret',
      sessionMode: 'desktop-profile-sync',
    });

    await expect(loadDesktopProfileBootstrapState()).resolves.toEqual({
      payload: initialPayload,
      localAuth: initialPayload.localAuth,
    });

    expect(applyDesktopProfileSyncStatus).toHaveBeenCalledWith(
      initialPayload.profileSync
    );
  });

  it('preserves stored credentials when silent restore fails without clearing them', async () => {
    const initialPayload = {
      appTarget: 'desktop',
      runtime: {
        siteName: 'Bootstrap LunaTV',
        profileSyncEnabled: true,
      },
      profileSync: {
        enabled: true,
        reachable: true,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        error: null,
        errorKind: null,
        syncDomains: ['playrecords'],
      },
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: true,
        ownerPasswordConfigured: true,
      },
    };

    (apiFetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(initialPayload),
    });
    (restoreDesktopProfileSyncSession as jest.Mock).mockResolvedValue(false);
    (getAuthInfoFromBrowserCookie as jest.Mock).mockReturnValue({
      username: 'cloud-owner',
      role: 'owner',
      password: 'secret',
      sessionMode: 'desktop-profile-sync',
    });

    await expect(loadDesktopProfileBootstrapState()).resolves.toEqual({
      payload: initialPayload,
      localAuth: initialPayload.localAuth,
    });

    expect(applyDesktopProfileSyncStatus).toHaveBeenCalledWith(
      initialPayload.profileSync
    );
  });

  it('skips bootstrap fetch outside desktop mode', async () => {
    (getRuntimeConfig as jest.Mock).mockReturnValue({
      APP_TARGET: 'web',
    });

    await expect(getDesktopProfileBootstrap()).resolves.toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('loads the unified desktop bootstrap payload', async () => {
    const payload = {
      appTarget: 'desktop',
      runtime: {
        siteName: 'Bootstrap LunaTV',
        profileSyncEnabled: true,
      },
      profileSync: {
        enabled: true,
        reachable: true,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        error: null,
        errorKind: null,
        syncDomains: [
          'playrecords',
          'favorites',
          'follows',
          'searchhistory',
          'skipconfigs',
        ],
      },
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: true,
        ownerPasswordConfigured: true,
      },
    };

    (apiFetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(payload),
    });

    await expect(getDesktopProfileBootstrap()).resolves.toEqual(payload);
    expect(apiFetch).toHaveBeenCalledWith('/profile/bootstrap', {
      cache: 'no-store',
    });
    expect(mutableWindow.__DESKTOP_PROFILE_BOOTSTRAP__).toEqual(payload);
  });

  it('restarts the local service and retries bootstrap fetches after a transient network failure', async () => {
    const payload = {
      appTarget: 'desktop',
      runtime: {
        siteName: 'Recovered LunaTV',
        profileSyncEnabled: false,
      },
      profileSync: {
        enabled: false,
        reachable: false,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'localstorage',
        profileMode: 'single-user-local',
        error: null,
        errorKind: null,
        syncDomains: [],
      },
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    };

    (apiFetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(payload),
      });
    (startLocalService as jest.Mock).mockResolvedValue({
      running: true,
    });

    await expect(getDesktopProfileBootstrap()).resolves.toEqual(payload);

    expect(startLocalService).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('reuses a cached desktop bootstrap payload when requested', async () => {
    const payload = {
      appTarget: 'desktop',
      runtime: {
        siteName: 'Cached LunaTV',
        profileSyncEnabled: false,
      },
      profileSync: {
        enabled: false,
        reachable: false,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'localstorage',
        profileMode: 'single-user-local',
        error: null,
        errorKind: null,
        syncDomains: [],
      },
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    };
    mutableWindow.__DESKTOP_PROFILE_BOOTSTRAP__ = payload;

    await expect(
      getDesktopProfileBootstrap({
        preferCachedPayload: true,
      })
    ).resolves.toEqual(payload);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('applies runtime and profile sync state from the bootstrap payload', () => {
    const payload = {
      appTarget: 'desktop',
      runtime: {
        siteName: 'Bootstrap LunaTV',
        profileSyncEnabled: true,
      },
      profileSync: {
        enabled: true,
        reachable: true,
        authenticated: true,
        username: 'kid',
        role: 'user',
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        error: null,
        errorKind: null,
        syncDomains: [
          'playrecords',
          'favorites',
          'follows',
          'searchhistory',
          'skipconfigs',
        ],
      },
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: true,
        ownerPasswordConfigured: true,
      },
    };
    const nextRuntimeConfig = {
      APP_TARGET: 'desktop',
      PROFILE_SYNC_ENABLED: true,
    };

    (applyDesktopProfileSyncStatus as jest.Mock).mockReturnValue(
      nextRuntimeConfig
    );

    const result = applyDesktopProfileBootstrap(payload);

    expect(applyDesktopRuntimePublicConfig).toHaveBeenCalledWith(
      payload.runtime
    );
    expect(applyDesktopProfileSyncStatus).toHaveBeenCalledWith(
      payload.profileSync
    );
    expect(result).toBe(nextRuntimeConfig);
  });

  it('loads bootstrap state and restores local auth for desktop-local mode', async () => {
    const payload = {
      appTarget: 'desktop',
      runtime: {
        siteName: 'Bootstrap LunaTV',
        profileSyncEnabled: false,
      },
      profileSync: {
        enabled: false,
        reachable: false,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'localstorage',
        profileMode: 'single-user-local',
        error: null,
        errorKind: null,
        syncDomains: [],
      },
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    };
    const restoredAuth = {
      username: 'owner',
      passwordRequired: false,
      multiUser: false,
      ownerPasswordConfigured: false,
    };

    (apiFetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(payload),
    });
    (ensureDesktopAuthSession as jest.Mock).mockResolvedValue(restoredAuth);

    await expect(loadDesktopProfileBootstrapState()).resolves.toEqual({
      payload,
      localAuth: restoredAuth,
    });

    expect(applyDesktopRuntimePublicConfig).toHaveBeenCalledWith(
      payload.runtime
    );
    expect(applyDesktopProfileSyncStatus).toHaveBeenCalledWith(
      payload.profileSync
    );
    expect(ensureDesktopAuthSession).toHaveBeenCalledTimes(1);
  });

  it('keeps bootstrap local auth when best-effort desktop auth restore fails', async () => {
    const payload = {
      appTarget: 'desktop',
      runtime: {
        siteName: 'Bootstrap LunaTV',
        profileSyncEnabled: false,
      },
      profileSync: {
        enabled: false,
        reachable: false,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'localstorage',
        profileMode: 'single-user-local',
        error: null,
        errorKind: null,
        syncDomains: [],
      },
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    };

    (apiFetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(payload),
    });
    (ensureDesktopAuthSession as jest.Mock).mockRejectedValue(
      new Error('desktop auth unavailable')
    );

    await expect(
      loadDesktopProfileBootstrapState({
        localAuthMode: 'best-effort',
      })
    ).resolves.toEqual({
      payload,
      localAuth: payload.localAuth,
    });
  });

  it('skips local auth restore when profile sync is enabled', async () => {
    const payload = {
      appTarget: 'desktop',
      runtime: {
        siteName: 'Bootstrap LunaTV',
        profileSyncEnabled: true,
      },
      profileSync: {
        enabled: true,
        reachable: true,
        authenticated: false,
        username: null,
        role: null,
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        error: null,
        errorKind: null,
        syncDomains: ['playrecords'],
      },
      localAuth: {
        username: 'owner',
        passwordRequired: true,
        multiUser: true,
        ownerPasswordConfigured: true,
      },
    };

    (apiFetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(payload),
    });

    await expect(loadDesktopProfileBootstrapState()).resolves.toEqual({
      payload,
      localAuth: payload.localAuth,
    });

    expect(ensureDesktopAuthSession).not.toHaveBeenCalled();
  });
});
