import type { ResolvedProfileRuntime } from '@/lib/profile/contracts';

import { buildUserMenuStorageTags } from './user-menu-storage-tags';

function runtime(
  overrides: Partial<ResolvedProfileRuntime>
): ResolvedProfileRuntime {
  return {
    appTarget: 'desktop',
    runtimeKind: 'desktop-local',
    syncEnabled: true,
    syncStorageType: 'redis',
    storageType: 'localstorage',
    profileMode: 'single-user-local',
    usesRemoteUserData: false,
    ...overrides,
  };
}

describe('buildUserMenuStorageTags', () => {
  it('renders local SQLite and a Redis remote tag for desktop profile sync', () => {
    expect(buildUserMenuStorageTags(runtime({}))).toEqual([
      {
        key: 'local',
        label: '本地 SQLite',
        tone: 'green',
        detail: '本地 SQLite 是日常读写主数据源。',
      },
      {
        key: 'remote',
        label: '远端 Redis',
        tone: 'gray',
        detail: '远端 Redis 仅作后台同步目标。',
      },
    ]);
  });

  it('maps Upstash, unknown, empty, and localstorage providers to compact labels', () => {
    expect(
      buildUserMenuStorageTags(runtime({ syncStorageType: 'upstash' }))[1].label
    ).toBe('远端 Upstash');
    expect(
      buildUserMenuStorageTags(
        runtime({ syncStorageType: 'custom-provider' })
      )[1]
    ).toMatchObject({
      label: '远端存储',
      detail: '远端存储仅作后台同步目标。',
    });
    expect(
      buildUserMenuStorageTags(runtime({ syncStorageType: 'localstorage' }))[1]
    ).toMatchObject({
      label: '远端未配置',
    });
    expect(
      buildUserMenuStorageTags(runtime({ syncStorageType: '' }))[1]
    ).toMatchObject({
      label: '远端未配置',
      detail: '尚未配置远端同步目标。',
    });
  });

  it('renders only local SQLite for desktop-local runtime', () => {
    expect(
      buildUserMenuStorageTags(
        runtime({
          runtimeKind: 'desktop-local',
          syncEnabled: false,
          storageType: 'localstorage',
          profileMode: 'single-user-local',
          usesRemoteUserData: false,
        })
      )
    ).toHaveLength(1);
    expect(
      buildUserMenuStorageTags(runtime({ syncEnabled: false }))[0]
    ).toMatchObject({
      key: 'local',
      label: '本地 SQLite',
    });
  });

  it('does not render desktop storage tags for web runtimes', () => {
    expect(
      buildUserMenuStorageTags(
        runtime({
          appTarget: 'web',
          runtimeKind: 'web-remote',
          syncEnabled: false,
          storageType: 'upstash',
          usesRemoteUserData: true,
        })
      )
    ).toEqual([]);
    expect(
      buildUserMenuStorageTags(
        runtime({
          appTarget: 'web',
          runtimeKind: 'web-local',
          syncEnabled: false,
          storageType: 'localstorage',
          profileMode: 'single-user-local',
          usesRemoteUserData: false,
        })
      )
    ).toEqual([]);
  });
});
