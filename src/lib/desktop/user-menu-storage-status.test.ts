import type { ResolvedProfileRuntime } from '@/lib/profile/contracts';

import {
  type UserMenuStorageStatusView,
  buildUserMenuStorageStatusView,
} from './user-menu-storage-status';

function runtime(
  overrides: Partial<ResolvedProfileRuntime>
): ResolvedProfileRuntime {
  return {
    appTarget: 'desktop',
    runtimeKind: 'desktop-profile-sync',
    syncEnabled: true,
    storageType: 'redis',
    profileMode: 'shared-multi-user',
    usesRemoteUserData: true,
    ...overrides,
  };
}

describe('buildUserMenuStorageStatusView', () => {
  it('keeps SQLite and local mode green while remote Redis is ready', () => {
    expect(
      buildUserMenuStorageStatusView(runtime({}), {
        enabled: true,
        reachable: true,
        authenticated: true,
        reauthRequired: false,
        storageType: 'redis',
        errorKind: null,
        pendingOutboxCount: 0,
      })
    ).toEqual<UserMenuStorageStatusView>({
      local: [
        {
          key: 'local-store',
          label: '本地 SQLite',
          tone: 'green',
          detail: '本地 SQLite 是日常读写主数据源；远端仅作为后台同步目标。',
        },
        {
          key: 'local-mode',
          label: '在使用',
          tone: 'green',
          detail: '本机优先保存修改，远端同步不会阻塞本地使用。',
        },
      ],
      remote: [
        {
          key: 'remote-provider',
          label: '远端 Redis',
          tone: 'gray',
          detail: '远端 Redis 是后台同步目标，不是本地日常读写主库。',
        },
        {
          key: 'remote-status',
          label: '已连接',
          tone: 'green',
          detail: '远端 Redis 已连接并已登录，本地修改会在后台同步。',
        },
      ],
    });
  });

  it('keeps local tags green and exposes remote errors plus pending changes when sync is unavailable', () => {
    const view = buildUserMenuStorageStatusView(runtime({}), {
      enabled: true,
      reachable: false,
      authenticated: false,
      reauthRequired: true,
      storageType: 'redis',
      error: '远端服务不可达',
      errorKind: 'unreachable',
      pendingOutboxCount: 3,
    });

    expect(view.local.map((tag) => tag.tone)).toEqual(['green', 'green']);
    expect(view.remote?.[0]).toMatchObject({
      key: 'remote-provider',
      label: '远端 Redis',
      tone: 'gray',
    });
    expect(view.remote?.[1]).toMatchObject({
      key: 'remote-status',
      label: '未连接',
      tone: 'red',
    });
    expect(view.remote?.[1].detail).toContain('远端服务不可达');
    expect(view.remote?.[1].detail).toContain('3 项修改已保存到本机');
    expect(view.remote?.[1].detail).toContain('重新登录后继续同步');
  });

  it('uses gray tags for an unconfigured remote and preserves browser-local semantics', () => {
    expect(
      buildUserMenuStorageStatusView(
        runtime({
          appTarget: 'web',
          runtimeKind: 'web-local',
          syncEnabled: false,
          storageType: 'localstorage',
          usesRemoteUserData: false,
        }),
        {
          enabled: false,
          reachable: false,
          authenticated: false,
          reauthRequired: false,
          storageType: null,
          errorKind: 'not-configured',
        }
      )
    ).toEqual({
      local: [
        {
          key: 'local-store',
          label: '本地浏览器',
          tone: 'green',
          detail: '本地浏览器存储用于当前设备；未配置远端同步。',
        },
        {
          key: 'local-mode',
          label: '本地模式',
          tone: 'green',
          detail: '当前仅使用本机存储，数据不会自动同步到远端。',
        },
      ],
      remote: null,
    });
  });

  it('marks a disabled desktop remote as unconfigured instead of disconnected', () => {
    const view = buildUserMenuStorageStatusView(runtime({}), {
      enabled: false,
      reachable: false,
      authenticated: false,
      reauthRequired: false,
      storageType: null,
      errorKind: 'not-configured',
    });

    expect(view.remote).toEqual([
      {
        key: 'remote-provider',
        label: '远端 未配置',
        tone: 'gray',
        detail: '尚未配置远端同步目标。',
      },
      {
        key: 'remote-status',
        label: '未配置',
        tone: 'gray',
        detail: '远端同步尚未配置。',
      },
    ]);
  });

  it('uses a neutral waiting-login tag when the remote is reachable but unauthenticated', () => {
    const view = buildUserMenuStorageStatusView(runtime({}), {
      enabled: true,
      reachable: true,
      authenticated: false,
      reauthRequired: false,
      storageType: 'redis',
      errorKind: null,
    });

    expect(view.remote?.[1]).toMatchObject({
      key: 'remote-status',
      label: '等待登录',
      tone: 'gray',
    });
  });

  it.each(['protocol-incompatible', 'upstream-failure'] as const)(
    'uses a red status-exception tag for reachable %s errors',
    (errorKind) => {
      const view = buildUserMenuStorageStatusView(runtime({}), {
        enabled: true,
        reachable: true,
        authenticated: false,
        reauthRequired: false,
        storageType: 'redis',
        error: '远端状态异常',
        errorKind,
      });

      expect(view.remote?.[1]).toMatchObject({
        key: 'remote-status',
        label: '状态异常',
        tone: 'red',
      });
    }
  );

  it('uses the disabled flag as the source of truth for an unconfigured remote', () => {
    const view = buildUserMenuStorageStatusView(runtime({}), {
      enabled: false,
      reachable: false,
      authenticated: false,
      reauthRequired: false,
      storageType: null,
      errorKind: null,
    });

    expect(view.remote?.[1]).toMatchObject({
      key: 'remote-status',
      label: '未配置',
      tone: 'gray',
    });
  });

  it('does not add a local SQLite tag for web-remote runtime', () => {
    const view = buildUserMenuStorageStatusView(
      runtime({
        appTarget: 'web',
        runtimeKind: 'web-remote',
        syncEnabled: false,
        storageType: 'redis',
        profileMode: 'shared-multi-user',
        usesRemoteUserData: true,
      }),
      undefined
    );

    expect(view.local).not.toContainEqual(
      expect.objectContaining({
        key: 'local-store',
        label: '本地 SQLite',
      })
    );
  });

  it('does not claim remote health when the desktop status read fails', () => {
    const view = buildUserMenuStorageStatusView(
      runtime({}),
      undefined,
      'local service unavailable'
    );

    expect(view.remote?.[1]).toEqual({
      key: 'remote-status',
      label: '状态未知',
      tone: 'gray',
      detail: '远端 Redis 状态未知：local service unavailable',
    });
  });
});
