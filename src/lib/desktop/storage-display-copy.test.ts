import { ResolvedProfileRuntime } from '@/lib/profile/contracts';

import { getProfileStorageDisplayCopy } from './storage-display-copy';

function runtime(
  overrides: Partial<ResolvedProfileRuntime>
): ResolvedProfileRuntime {
  return {
    appTarget: 'web',
    runtimeKind: 'web-local',
    syncEnabled: false,
    storageType: 'localstorage',
    profileMode: 'single-user-local',
    usesRemoteUserData: false,
    ...overrides,
  };
}

describe('getProfileStorageDisplayCopy', () => {
  it('describes desktop local storage as local SQLite', () => {
    expect(
      getProfileStorageDisplayCopy(
        runtime({ appTarget: 'desktop', runtimeKind: 'desktop-local' })
      )
    ).toBe('本地 SQLite');
  });

  it('describes Upstash desktop profile sync as local SQLite with remote sync', () => {
    expect(
      getProfileStorageDisplayCopy(
        runtime({
          appTarget: 'desktop',
          runtimeKind: 'desktop-profile-sync',
          syncEnabled: true,
          storageType: 'upstash',
          usesRemoteUserData: true,
        })
      )
    ).toBe('本地 SQLite · 远端同步：Upstash');
  });

  it('describes Redis desktop profile sync as local SQLite with remote sync', () => {
    expect(
      getProfileStorageDisplayCopy(
        runtime({
          appTarget: 'desktop',
          runtimeKind: 'desktop-profile-sync',
          syncEnabled: true,
          storageType: 'redis',
          usesRemoteUserData: true,
        })
      )
    ).toBe('本地 SQLite · 远端同步：Redis');
  });

  it('preserves an unknown non-empty desktop remote provider label', () => {
    expect(
      getProfileStorageDisplayCopy(
        runtime({
          appTarget: 'desktop',
          runtimeKind: 'desktop-profile-sync',
          syncEnabled: true,
          storageType: 'custom-provider',
          usesRemoteUserData: true,
        })
      )
    ).toBe('本地 SQLite · 远端同步：custom-provider');
  });

  it('describes web local storage as local browser storage', () => {
    expect(getProfileStorageDisplayCopy(runtime({}))).toBe('本地浏览器');
  });

  it('describes unknown web remote storage as remote storage', () => {
    expect(
      getProfileStorageDisplayCopy(
        runtime({
          runtimeKind: 'web-remote',
          storageType: 'custom-provider',
          usesRemoteUserData: true,
        })
      )
    ).toBe('custom-provider 远端存储');
  });
});
