jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  configSelfCheck: jest.fn((config) => {
    if (!config?.SiteConfig) {
      return config;
    }

    return {
      ...config,
      SiteConfig: {
        SiteName: config.SiteConfig.SiteName,
        Announcement: config.SiteConfig.Announcement,
        SearchDownstreamMaxPage: config.SiteConfig.SearchDownstreamMaxPage,
        SiteInterfaceCacheTime: config.SiteConfig.SiteInterfaceCacheTime,
        DoubanProxyType: config.SiteConfig.DoubanProxyType,
        DoubanProxy: config.SiteConfig.DoubanProxy,
        DoubanImageProxyType: config.SiteConfig.DoubanImageProxyType,
        DoubanImageProxy: config.SiteConfig.DoubanImageProxy,
        DisableYellowFilter: config.SiteConfig.DisableYellowFilter,
        FluidSearch: config.SiteConfig.FluidSearch,
        EnableWebLive: config.SiteConfig.EnableWebLive,
      },
    };
  }),
  getConfig: jest.fn(),
  setCachedConfig: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    getProfileSyncRevision: jest.fn(),
    getAdminSettingsRevision: jest.fn(),
    commitProfileSyncMerge: jest.fn(),
    getAdminConfig: jest.fn(),
    saveAdminConfig: jest.fn(),
    getAllPlayRecords: jest.fn(),
    savePlayRecord: jest.fn(),
    deleteAllPlayRecords: jest.fn(),
    getAllFavorites: jest.fn(),
    saveFavorite: jest.fn(),
    deleteAllFavorites: jest.fn(),
    getAllFollowRecords: jest.fn(),
    saveFollowRecord: jest.fn(),
    deleteAllFollowRecords: jest.fn(),
    getSearchHistory: jest.fn(),
    addSearchHistory: jest.fn(),
    deleteSearchHistory: jest.fn(),
    getAllSkipConfigs: jest.fn(),
    setSkipConfig: jest.fn(),
    deleteSkipConfig: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';

import { POST } from './route';

const removedSiteFlagKey = ['Enable', 'WebMusic'].join('');
describe('/api/admin/profile-sync/merge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    process.env.USERNAME = 'admin';
    (db.getProfileSyncRevision as jest.Mock).mockResolvedValue('0');
    (db.getAdminSettingsRevision as jest.Mock).mockResolvedValue('0');
    (db.commitProfileSyncMerge as jest.Mock).mockResolvedValue({
      revision: '1',
    });
  });

  it('rejects unauthenticated requests', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue(null);

    const response = await POST(
      new NextRequest('http://localhost/api/admin/profile-sync/merge', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
    });
  });

  it('merges the target user snapshot with local-first strategy', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'admin-user',
    });
    const authorizationConfig = {
      ConfigSubscribtion: {
        URL: '',
        AutoUpdate: false,
        LastCheck: '',
      },
      ConfigFile:
        '{"auth":{"username":"admin","password":"remote-owner-secret"}}',
      SiteConfig: {
        SiteName: 'Remote LunaTV',
        Announcement: '',
        SearchDownstreamMaxPage: 5,
        SiteInterfaceCacheTime: 7200,
        DoubanProxyType: 'custom',
        DoubanProxy: '',
        DoubanImageProxyType: 'custom',
        DoubanImageProxy: '',
        DisableYellowFilter: false,
        FluidSearch: true,
        EnableWebLive: false,
      },
      UserConfig: {
        Users: [
          { username: 'admin', role: 'owner' },
          { username: 'admin-user', role: 'admin', banned: false },
          { username: 'target-user', role: 'user', banned: false },
        ],
      },
    };
    (getConfig as jest.Mock).mockResolvedValue(authorizationConfig);
    (db.getAdminConfig as jest.Mock).mockResolvedValue({
      ...authorizationConfig,
      ConfigFile:
        '{"auth":{"username":"admin","password":"fresh-owner-secret"}}',
    });
    (db.getAllPlayRecords as jest.Mock).mockResolvedValue({
      'same+1': {
        title: 'remote-play',
        source_name: 'Demo',
        cover: 'cover.jpg',
        year: '2026',
        index: 1,
        total_episodes: 12,
        play_time: 30,
        total_time: 60,
        save_time: 1,
        search_title: 'remote-play',
      },
      'remote-only+1': {
        title: 'remote-only-play',
        source_name: 'Demo',
        cover: 'cover.jpg',
        year: '2026',
        index: 1,
        total_episodes: 12,
        play_time: 30,
        total_time: 60,
        save_time: 2,
        search_title: 'remote-only-play',
      },
    });
    (db.getAllFavorites as jest.Mock).mockResolvedValue({});
    (db.getAllFollowRecords as jest.Mock).mockResolvedValue({});
    (db.getSearchHistory as jest.Mock).mockResolvedValue([
      'remote-shared',
      'remote-only',
    ]);
    (db.getAllSkipConfigs as jest.Mock).mockResolvedValue({});

    const response = await POST(
      new NextRequest('http://localhost/api/admin/profile-sync/merge', {
        method: 'POST',
        body: JSON.stringify({
          targetUsername: 'target-user',
          strategy: 'local-first',
          snapshot: {
            playRecords: {
              'same+1': {
                title: 'local-play',
                source_name: 'Demo',
                cover: 'cover.jpg',
                year: '2026',
                index: 1,
                total_episodes: 12,
                play_time: 30,
                total_time: 60,
                save_time: 11,
                search_title: 'local-play',
              },
              'local-only+1': {
                title: 'local-only-play',
                source_name: 'Demo',
                cover: 'cover.jpg',
                year: '2026',
                index: 1,
                total_episodes: 12,
                play_time: 30,
                total_time: 60,
                save_time: 12,
                search_title: 'local-only-play',
              },
            },
            favorites: {},
            follows: {},
            searchHistory: ['remote-shared', 'local-only'],
            skipConfigs: {},
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      targetUsername: 'target-user',
      strategy: 'local-first',
      revision: '1',
      mergedSnapshot: {
        playRecords: expect.objectContaining({
          'same+1': expect.objectContaining({ title: 'local-play' }),
          'remote-only+1': expect.objectContaining({
            title: 'remote-only-play',
          }),
          'local-only+1': expect.objectContaining({
            title: 'local-only-play',
          }),
        }),
        searchHistory: ['remote-shared', 'local-only', 'remote-only'],
      },
    });
    expect(db.commitProfileSyncMerge).toHaveBeenCalledTimes(1);
    expect(db.deleteAllPlayRecords).not.toHaveBeenCalled();
    expect(db.savePlayRecord).not.toHaveBeenCalled();
    expect(db.deleteSearchHistory).not.toHaveBeenCalled();
    expect(db.addSearchHistory).not.toHaveBeenCalled();
  });

  it('merges and replaces only explicitly selected profile domains', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'admin',
    });
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: {
        Users: [{ username: 'target-user', role: 'user', banned: false }],
      },
    });
    (db.getAllFavorites as jest.Mock).mockResolvedValue({
      'remote+1': {
        title: 'remote favorite',
        source_name: 'Demo',
        total_episodes: 12,
        year: '2026',
        cover: 'cover.jpg',
        save_time: 1,
        search_title: 'remote favorite',
      },
    });

    const response = await POST(
      new NextRequest('http://localhost/api/admin/profile-sync/merge', {
        method: 'POST',
        body: JSON.stringify({
          targetUsername: 'target-user',
          strategy: 'local-first',
          domains: ['favorites'],
          protocolVersion: '1.5',
          requestId: 'request-123',
          snapshot: {
            favorites: {
              'local+1': {
                title: 'local favorite',
                source_name: 'Demo',
                total_episodes: 12,
                year: '2026',
                cover: 'cover.jpg',
                save_time: 2,
                search_title: 'local favorite',
              },
            },
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      targetUsername: 'target-user',
      strategy: 'local-first',
      protocolVersion: '1.5',
      requestId: 'request-123',
      revision: '1',
      mergedSnapshot: {
        playRecords: {},
        favorites: {
          'remote+1': expect.objectContaining({ title: 'remote favorite' }),
          'local+1': expect.objectContaining({ title: 'local favorite' }),
        },
        follows: {},
        searchHistory: [],
        skipConfigs: {},
      },
      summary: {
        playRecordCount: 0,
        favoriteCount: 2,
        followCount: 0,
        searchHistoryCount: 0,
        skipConfigCount: 0,
      },
    });
    expect(db.getAllFavorites).toHaveBeenCalledWith('target-user');
    expect(db.commitProfileSyncMerge).toHaveBeenCalledTimes(1);
    expect(db.deleteAllFavorites).not.toHaveBeenCalled();
    expect(db.saveFavorite).not.toHaveBeenCalled();
    expect(db.getAllPlayRecords).not.toHaveBeenCalled();
    expect(db.deleteAllPlayRecords).not.toHaveBeenCalled();
    expect(db.savePlayRecord).not.toHaveBeenCalled();
    expect(db.getAllFollowRecords).not.toHaveBeenCalled();
    expect(db.deleteAllFollowRecords).not.toHaveBeenCalled();
    expect(db.saveFollowRecord).not.toHaveBeenCalled();
    expect(db.getSearchHistory).not.toHaveBeenCalled();
    expect(db.deleteSearchHistory).not.toHaveBeenCalled();
    expect(db.addSearchHistory).not.toHaveBeenCalled();
    expect(db.getAllSkipConfigs).not.toHaveBeenCalled();
    expect(db.deleteSkipConfig).not.toHaveBeenCalled();
    expect(db.setSkipConfig).not.toHaveBeenCalled();
  });

  it('accepts an empty explicit domain selection without profile database calls', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'admin',
    });
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: {
        Users: [{ username: 'target-user', role: 'user', banned: false }],
      },
    });

    const response = await POST(
      new NextRequest('http://localhost/api/admin/profile-sync/merge', {
        method: 'POST',
        body: JSON.stringify({
          targetUsername: 'target-user',
          strategy: 'web-first',
          domains: [],
          snapshot: {},
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.getAllPlayRecords).not.toHaveBeenCalled();
    expect(db.getAllFavorites).not.toHaveBeenCalled();
    expect(db.getAllFollowRecords).not.toHaveBeenCalled();
    expect(db.getSearchHistory).not.toHaveBeenCalled();
    expect(db.getAllSkipConfigs).not.toHaveBeenCalled();
    expect(db.deleteAllPlayRecords).not.toHaveBeenCalled();
    expect(db.deleteAllFavorites).not.toHaveBeenCalled();
    expect(db.deleteAllFollowRecords).not.toHaveBeenCalled();
    expect(db.deleteSearchHistory).not.toHaveBeenCalled();
    expect(db.deleteSkipConfig).not.toHaveBeenCalled();
  });

  it('rejects an explicit selection whose snapshot omits the selected domain', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'admin',
    });
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: {
        Users: [{ username: 'target-user', role: 'user', banned: false }],
      },
    });

    const response = await POST(
      new NextRequest('http://localhost/api/admin/profile-sync/merge', {
        method: 'POST',
        body: JSON.stringify({
          targetUsername: 'target-user',
          strategy: 'web-first',
          domains: ['searchHistory'],
          snapshot: {},
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '资料快照格式错误',
    });
    expect(db.getSearchHistory).not.toHaveBeenCalled();
    expect(db.deleteSearchHistory).not.toHaveBeenCalled();
  });

  it('commits sanitized admin settings with the stable admin revision', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'admin-user',
    });
    const authorizationConfig = {
      ConfigSubscribtion: {
        URL: '',
        AutoUpdate: false,
        LastCheck: '',
      },
      ConfigFile:
        '{"auth":{"username":"admin","password":"remote-owner-secret"}}',
      SiteConfig: {
        SiteName: 'Remote LunaTV',
        Announcement: '',
        SearchDownstreamMaxPage: 5,
        SiteInterfaceCacheTime: 7200,
        DoubanProxyType: 'custom',
        DoubanProxy: '',
        DoubanImageProxyType: 'custom',
        DoubanImageProxy: '',
        DisableYellowFilter: false,
        FluidSearch: true,
        EnableWebLive: false,
      },
      UserConfig: {
        Users: [
          { username: 'admin', role: 'owner' },
          { username: 'admin-user', role: 'admin', banned: false },
          { username: 'target-user', role: 'user', banned: false },
        ],
      },
    };
    (getConfig as jest.Mock).mockResolvedValue(authorizationConfig);
    (db.getAdminConfig as jest.Mock).mockResolvedValue({
      ...authorizationConfig,
      ConfigFile:
        '{"auth":{"username":"admin","password":"fresh-owner-secret"}}',
    });
    (db.getAllPlayRecords as jest.Mock).mockResolvedValue({});
    (db.getAllFavorites as jest.Mock).mockResolvedValue({});
    (db.getAllFollowRecords as jest.Mock).mockResolvedValue({});
    (db.getSearchHistory as jest.Mock).mockResolvedValue([]);
    (db.getAllSkipConfigs as jest.Mock).mockResolvedValue({});
    (db.getAdminSettingsRevision as jest.Mock).mockResolvedValue('12');

    const adminConfig = {
      ConfigSubscribtion: {
        URL: '',
        AutoUpdate: false,
        LastCheck: '',
      },
      ConfigFile: '{"auth":{"username":"admin","password":"owner-secret"}}',
      SiteConfig: {
        SiteName: 'Desktop LunaTV',
        Announcement: '同步公告',
        SearchDownstreamMaxPage: 5,
        SiteInterfaceCacheTime: 7200,
        DoubanProxyType: 'custom',
        DoubanProxy: '',
        DoubanImageProxyType: 'custom',
        DoubanImageProxy: '',
        DisableYellowFilter: false,
        FluidSearch: true,
        EnableWebLive: false,
        [removedSiteFlagKey]: true,
      },
      UserConfig: {
        Users: [
          {
            username: 'admin',
            role: 'owner',
          },
          {
            username: 'desktop-admin',
            role: 'admin',
          },
          {
            username: 'desktop-user',
            role: 'user',
          },
        ],
        Tags: [
          {
            name: 'kids',
            enabledApis: ['demo'],
          },
        ],
      },
      SourceConfig: [
        {
          key: 'demo',
          name: 'Demo',
          api: 'https://example.com/api.php/provide/vod',
          from: 'custom',
        },
      ],
      CustomCategories: [],
      LiveConfig: [],
      AdFilterConfig: {
        enabled: true,
      },
      PlayerEnhancementConfig: {
        AudioSpikeProtection: false,
        VisualEnhancement: false,
      },
    };

    const response = await POST(
      new NextRequest('http://localhost/api/admin/profile-sync/merge', {
        method: 'POST',
        body: JSON.stringify({
          targetUsername: 'target-user',
          strategy: 'web-first',
          snapshot: {
            playRecords: {},
            favorites: {},
            follows: {},
            searchHistory: [],
            skipConfigs: {},
          },
          adminConfig,
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ revision: '1' });
    expect(db.saveAdminConfig).not.toHaveBeenCalled();
    expect(db.getAdminSettingsRevision).toHaveBeenCalledTimes(2);
    expect(db.commitProfileSyncMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        adminSettings: {
          expectedRevision: '12',
          config: expect.objectContaining({
            ConfigSubscribtion: {
              URL: '',
              AutoUpdate: false,
              LastCheck: '',
            },
            ConfigFile:
              '{"auth":{"username":"admin","password":"fresh-owner-secret"}}',
            UserConfig: {
              Users: [
                { username: 'admin', role: 'owner' },
                { username: 'admin-user', role: 'admin', banned: false },
                { username: 'target-user', role: 'user', banned: false },
              ],
            },
            SiteConfig: expect.objectContaining({
              SiteName: 'Desktop LunaTV',
            }),
            SourceConfig: [
              expect.objectContaining({
                key: 'demo',
              }),
            ],
          }),
        },
      })
    );
    expect(
      (db.commitProfileSyncMerge as jest.Mock).mock.calls[0][0].adminSettings
        .config.SiteConfig
    ).not.toHaveProperty(removedSiteFlagKey);
    expect(db.getAdminConfig).toHaveBeenCalledTimes(1);
    expect(setCachedConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        SiteConfig: expect.objectContaining({
          SiteName: 'Desktop LunaTV',
        }),
      })
    );
  });

  it('returns the committed revision and authoritative merged snapshot', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'admin',
    });
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: {
        Users: [{ username: 'target-user', role: 'user', banned: false }],
      },
    });
    (db.getProfileSyncRevision as jest.Mock).mockResolvedValue('7');
    (db.getAllFavorites as jest.Mock).mockResolvedValue({
      'remote+1': {
        title: 'remote favorite',
        source_name: 'Demo',
        total_episodes: 12,
        year: '2026',
        cover: 'cover.jpg',
        save_time: 1,
        search_title: 'remote favorite',
      },
    });
    (db.commitProfileSyncMerge as jest.Mock).mockResolvedValue({
      revision: '8',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/admin/profile-sync/merge', {
        method: 'POST',
        body: JSON.stringify({
          targetUsername: 'target-user',
          strategy: 'local-first',
          domains: ['favorites'],
          protocolVersion: '1.5',
          requestId: 'request-123',
          snapshot: {
            favorites: {
              'local+1': {
                title: 'local favorite',
                source_name: 'Demo',
                total_episodes: 12,
                year: '2026',
                cover: 'cover.jpg',
                save_time: 2,
                search_title: 'local favorite',
              },
            },
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      targetUsername: 'target-user',
      strategy: 'local-first',
      protocolVersion: '1.5',
      requestId: 'request-123',
      revision: '8',
      mergedSnapshot: {
        playRecords: {},
        favorites: {
          'remote+1': expect.objectContaining({ title: 'remote favorite' }),
          'local+1': expect.objectContaining({ title: 'local favorite' }),
        },
        follows: {},
        searchHistory: [],
        skipConfigs: {},
      },
      summary: {
        playRecordCount: 0,
        favoriteCount: 2,
        followCount: 0,
        searchHistoryCount: 0,
        skipConfigCount: 0,
      },
    });
    expect(db.commitProfileSyncMerge).toHaveBeenCalledWith({
      username: 'target-user',
      expectedRevision: '7',
      domains: ['favorites'],
      mergedSnapshot: expect.objectContaining({
        favorites: expect.objectContaining({
          'remote+1': expect.objectContaining({ title: 'remote favorite' }),
          'local+1': expect.objectContaining({ title: 'local favorite' }),
        }),
      }),
    });
    expect(db.deleteAllFavorites).not.toHaveBeenCalled();
    expect(db.saveFavorite).not.toHaveBeenCalled();
  });

  it('retries a commit conflict with a fresh stable revision', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'admin',
    });
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: {
        Users: [{ username: 'target-user', role: 'user', banned: false }],
      },
    });
    (db.getProfileSyncRevision as jest.Mock)
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('2')
      .mockResolvedValueOnce('2');
    (db.getAllFavorites as jest.Mock).mockResolvedValue({});
    (db.commitProfileSyncMerge as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ revision: '3' });

    const response = await POST(
      new NextRequest('http://localhost/api/admin/profile-sync/merge', {
        method: 'POST',
        body: JSON.stringify({
          targetUsername: 'target-user',
          strategy: 'local-first',
          domains: ['favorites'],
          snapshot: { favorites: {} },
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ revision: '3' });
    expect(db.commitProfileSyncMerge).toHaveBeenCalledTimes(2);
    expect(db.commitProfileSyncMerge).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ expectedRevision: '1' })
    );
    expect(db.commitProfileSyncMerge).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ expectedRevision: '2' })
    );
  });

  it('returns 409 after five commit conflicts', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'admin',
    });
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: {
        Users: [{ username: 'target-user', role: 'user', banned: false }],
      },
    });
    (db.getProfileSyncRevision as jest.Mock).mockResolvedValue('7');
    (db.getAllFavorites as jest.Mock).mockResolvedValue({});
    (db.commitProfileSyncMerge as jest.Mock).mockResolvedValue(null);

    const response = await POST(
      new NextRequest('http://localhost/api/admin/profile-sync/merge', {
        method: 'POST',
        body: JSON.stringify({
          targetUsername: 'target-user',
          strategy: 'web-first',
          domains: ['favorites'],
          snapshot: { favorites: {} },
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: '资料合并冲突，请稍后重试',
    });
    expect(db.commitProfileSyncMerge).toHaveBeenCalledTimes(5);
  });

  it('maps profile storage failures to 503', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'admin',
    });
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: {
        Users: [{ username: 'target-user', role: 'user', banned: false }],
      },
    });
    (db.getProfileSyncRevision as jest.Mock).mockRejectedValue(
      new Error('storage unavailable')
    );
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const response = await POST(
      new NextRequest('http://localhost/api/admin/profile-sync/merge', {
        method: 'POST',
        body: JSON.stringify({
          targetUsername: 'target-user',
          strategy: 'web-first',
          domains: ['favorites'],
          snapshot: { favorites: {} },
        }),
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: '资料合并服务暂不可用',
    });
    expect(db.commitProfileSyncMerge).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('maps cross-slot atomic commit failures to 409', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'admin',
    });
    (getConfig as jest.Mock).mockResolvedValue({
      UserConfig: {
        Users: [{ username: 'target-user', role: 'user', banned: false }],
      },
    });
    (db.getAllFavorites as jest.Mock).mockResolvedValue({});
    (db.commitProfileSyncMerge as jest.Mock).mockRejectedValue(
      new Error('PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE')
    );
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const response = await POST(
      new NextRequest('http://localhost/api/admin/profile-sync/merge', {
        method: 'POST',
        body: JSON.stringify({
          targetUsername: 'target-user',
          strategy: 'web-first',
          domains: ['favorites'],
          snapshot: { favorites: {} },
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: '资料合并原子提交不可用',
    });
    consoleErrorSpy.mockRestore();
  });
});
