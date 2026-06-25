import {
  isDesktopLocalProfileRuntime,
  isDesktopProfileSyncRuntime,
  resolveProfileRuntime,
  shouldUseRemoteProfileStorage,
} from '@/lib/profile/runtime';

describe('profile runtime resolver', () => {
  it('resolves a local web runtime by default', () => {
    expect(resolveProfileRuntime({})).toEqual({
      appTarget: 'web',
      runtimeKind: 'web-local',
      syncEnabled: false,
      storageType: 'localstorage',
      profileMode: 'single-user-local',
      usesRemoteUserData: false,
    });
  });

  it('treats remote web storage as a remote profile runtime', () => {
    expect(
      resolveProfileRuntime({
        STORAGE_TYPE: 'redis',
      })
    ).toEqual({
      appTarget: 'web',
      runtimeKind: 'web-remote',
      syncEnabled: false,
      storageType: 'redis',
      profileMode: 'shared-multi-user',
      usesRemoteUserData: true,
    });
  });

  it('keeps desktop local mode on the base runtime when sync is off', () => {
    const runtime = resolveProfileRuntime({
      APP_TARGET: 'desktop',
      STORAGE_TYPE: 'localstorage',
      PROFILE_MODE: 'single-user-local',
    });

    expect(runtime.runtimeKind).toBe('desktop-local');
    expect(runtime.storageType).toBe('localstorage');
    expect(runtime.profileMode).toBe('single-user-local');
    expect(
      isDesktopLocalProfileRuntime({
        APP_TARGET: 'desktop',
        STORAGE_TYPE: 'localstorage',
      })
    ).toBe(true);
  });

  it('prefers sync-projected storage and profile mode for desktop sync runtime', () => {
    const config = {
      APP_TARGET: 'desktop' as const,
      STORAGE_TYPE: 'localstorage',
      PROFILE_SYNC_ENABLED: true,
      PROFILE_SYNC_STORAGE_TYPE: 'redis',
      PROFILE_SYNC_PROFILE_MODE: 'shared-multi-user' as const,
    };

    expect(resolveProfileRuntime(config)).toEqual({
      appTarget: 'desktop',
      runtimeKind: 'desktop-profile-sync',
      syncEnabled: true,
      storageType: 'redis',
      profileMode: 'shared-multi-user',
      usesRemoteUserData: true,
    });
    expect(shouldUseRemoteProfileStorage(config)).toBe(true);
    expect(isDesktopProfileSyncRuntime(config)).toBe(true);
  });
});
