import {
  buildDesktopProfileSyncDiagnostics,
  buildDesktopProfileSyncErrorHint,
  buildDesktopProfileSyncLoginStatusMessage,
  buildDesktopProfileSyncStatusDetail,
  buildDesktopProfileSyncStatusValue,
  resolveDesktopProfileSyncDomainsText,
} from './profile-sync-status-copy';

describe('desktop profile sync status copy helpers', () => {
  it('describes the default sync domains when sync is disabled', () => {
    expect(resolveDesktopProfileSyncDomainsText(null)).toBe(
      '播放记录、收藏、追更、搜索历史、跳过片头片尾'
    );
    expect(
      buildDesktopProfileSyncStatusDetail({
        enabled: false,
        reachable: false,
        authenticated: false,
        username: null,
        role: null,
        storageType: null,
        profileMode: null,
        error: null,
        errorKind: 'not-configured',
        syncDomains: null,
      })
    ).toContain('请前往帐号同步页开启帐号同步');
  });

  it('builds enabled sync detail with domains, account, and hints', () => {
    const status = {
      enabled: true,
      reachable: false,
      authenticated: false,
      username: 'kid',
      role: 'user',
      storageType: 'redis',
      profileMode: 'shared-multi-user',
      error: '远端账号同步后端不可达。',
      errorKind: 'unreachable',
      syncDomains: ['favorites', 'follows'],
    } as const;

    expect(buildDesktopProfileSyncStatusValue(status)).toBe('已启用但不可达');
    expect(buildDesktopProfileSyncStatusDetail(status)).toContain(
      '本地 SQLite 是日常读写主数据源；仅在后台同步 收藏、追更'
    );
    expect(buildDesktopProfileSyncStatusDetail(status)).toContain(
      '当前远端账号：kid'
    );
    expect(buildDesktopProfileSyncStatusDetail(status)).toContain(
      '建议：确认当前网络和远端 Web 站点可达。'
    );
  });

  it('surfaces unknown status when the local service read fails', () => {
    expect(
      buildDesktopProfileSyncStatusValue(undefined, 'local service unavailable')
    ).toBe('状态未知');
    expect(
      buildDesktopProfileSyncStatusDetail(
        undefined,
        'local service unavailable'
      )
    ).toBe(
      '未能从本地服务读取 profile sync 状态。请前往配置页检查本地服务。最近错误：local service unavailable'
    );
  });

  it('builds the reduced diagnostics fields for the account sync page', () => {
    const status = {
      enabled: true,
      reachable: false,
      authenticated: false,
      username: 'kid',
      role: 'user',
      storageType: 'redis',
      profileMode: 'shared-multi-user',
      error: '远端账号同步后端不可达。',
      errorKind: 'unreachable',
      syncDomains: ['favorites', 'follows'],
    } as const;

    expect(buildDesktopProfileSyncDiagnostics(status)).toEqual([
      { label: '远端可达性', value: '不可达' },
      { label: '当前帐号', value: 'kid' },
      { label: '最近错误', value: '远端账号同步后端不可达。' },
      { label: '本地队列', value: '本地修改已同步' },
      { label: '同步范围', value: '收藏、追更' },
    ]);
  });

  it('treats reachable sync protocol failures as degraded instead of healthy', () => {
    const status = {
      enabled: true,
      reachable: true,
      authenticated: false,
      username: 'kid',
      role: 'user',
      storageType: 'redis',
      profileMode: 'shared-multi-user',
      error: 'unexpected profile sync response',
      errorKind: 'protocol-incompatible',
      syncDomains: ['favorites', 'follows'],
    } as const;

    expect(buildDesktopProfileSyncStatusValue(status)).toBe('已连接但状态异常');
    expect(buildDesktopProfileSyncDiagnostics(status)).toEqual([
      { label: '远端可达性', value: '可达，但状态异常' },
      { label: '当前帐号', value: 'kid' },
      { label: '最近错误', value: 'unexpected profile sync response' },
      { label: '本地队列', value: '本地修改已同步' },
      { label: '同步范围', value: '收藏、追更' },
    ]);
    expect(buildDesktopProfileSyncLoginStatusMessage(status)).toBe(
      '云端账号同步协议不兼容，请升级桌面端或 Web 端。'
    );
  });

  it('distinguishes locally saved changes from remote sync completion', () => {
    const status = {
      enabled: true,
      reachable: true,
      authenticated: false,
      pendingOutboxCount: 3,
      reauthRequired: true,
      lastOutboxError: '远端账号同步后端返回 401',
      syncDomains: ['favorites'],
    } as const;

    expect(buildDesktopProfileSyncDiagnostics(status)).toContainEqual({
      label: '本地队列',
      value: '3 项等待同步（需重新登录）',
    });
    expect(buildDesktopProfileSyncDiagnostics(status)).toContainEqual({
      label: '最近错误',
      value: '远端账号同步后端返回 401',
    });
    expect(buildDesktopProfileSyncStatusDetail(status)).toContain(
      '3 项修改已保存到本机，重新登录后继续同步。'
    );
  });

  it('returns an empty hint when the error kind is absent', () => {
    expect(buildDesktopProfileSyncErrorHint(null)).toBe('');
    expect(buildDesktopProfileSyncErrorHint(undefined)).toBe('');
  });
});
