import {
  buildDesktopProfileSyncDiagnostics,
  buildDesktopProfileSyncErrorHint,
  buildDesktopProfileSyncStatusDetail,
  buildDesktopProfileSyncStatusValue,
  resolveDesktopProfileSyncDomainsText,
} from './profile-sync-status-copy';

describe('desktop profile sync status copy helpers', () => {
  it('describes the default sync domains when sync is disabled', () => {
    expect(resolveDesktopProfileSyncDomainsText(null)).toBe(
      '播放记录、收藏、追更、搜索历史、跳过片头片尾'
    );
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
      '仅同步 收藏、追更'
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
      '未能从本地服务读取 profile sync 状态。最近错误：local service unavailable'
    );
  });

  it('builds structured diagnostics fields for the settings and admin surfaces', () => {
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
      { label: '当前模式', value: '远端多用户 / redis' },
      { label: '远端可达性', value: '不可达' },
      { label: '远端账号', value: 'kid' },
      { label: '最近错误', value: '远端账号同步后端不可达。' },
      { label: '同步域', value: '收藏、追更' },
    ]);
  });

  it('returns an empty hint when the error kind is absent', () => {
    expect(buildDesktopProfileSyncErrorHint(null)).toBe('');
    expect(buildDesktopProfileSyncErrorHint(undefined)).toBe('');
  });
});
