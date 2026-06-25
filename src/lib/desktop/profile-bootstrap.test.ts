import {
  applyDesktopProfileBootstrap,
  getDesktopProfileBootstrap,
} from '@/lib/desktop/profile-bootstrap';
import { applyDesktopProfileSyncStatus } from '@/lib/desktop/profile-sync';
import { applyDesktopRuntimePublicConfig } from '@/lib/desktop/runtime-config';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { apiFetch } from '@/lib/transport/api-client';

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(),
}));

jest.mock('@/lib/transport/api-client', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('@/lib/desktop/profile-sync', () => ({
  applyDesktopProfileSyncStatus: jest.fn(),
}));

jest.mock('@/lib/desktop/runtime-config', () => ({
  applyDesktopRuntimePublicConfig: jest.fn(),
}));

describe('desktop profile bootstrap helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getRuntimeConfig as jest.Mock).mockReturnValue({
      APP_TARGET: 'desktop',
    });
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
});
