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
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

import { POST } from './route';

const removedSiteFlagKey = ['Enable', 'WebMusic'].join('');
describe('/api/admin/profile-sync/merge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    process.env.USERNAME = 'owner';
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
    (getConfig as jest.Mock).mockResolvedValue({
      ConfigSubscribtion: {
        URL: '',
        AutoUpdate: false,
        LastCheck: '',
      },
      ConfigFile:
        '{"auth":{"username":"owner","password":"remote-owner-secret"}}',
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
          { username: 'owner', role: 'owner' },
          { username: 'admin-user', role: 'admin', banned: false },
          { username: 'target-user', role: 'user', banned: false },
        ],
      },
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
    await expect(response.json()).resolves.toEqual({
      ok: true,
      targetUsername: 'target-user',
      strategy: 'local-first',
      summary: {
        playRecordCount: 3,
        favoriteCount: 0,
        followCount: 0,
        searchHistoryCount: 3,
        skipConfigCount: 0,
      },
    });
    expect(db.deleteAllPlayRecords).toHaveBeenCalledWith('target-user');
    expect(db.savePlayRecord).toHaveBeenCalledWith(
      'target-user',
      'same',
      '1',
      expect.objectContaining({
        title: 'local-play',
      })
    );
    expect(db.savePlayRecord).toHaveBeenCalledWith(
      'target-user',
      'remote-only',
      '1',
      expect.objectContaining({
        title: 'remote-only-play',
      })
    );
    expect(db.savePlayRecord).toHaveBeenCalledWith(
      'target-user',
      'local-only',
      '1',
      expect.objectContaining({
        title: 'local-only-play',
      })
    );
    expect(db.deleteSearchHistory).toHaveBeenCalledWith('target-user');
    expect(db.addSearchHistory).toHaveBeenNthCalledWith(
      1,
      'target-user',
      'remote-only'
    );
    expect(db.addSearchHistory).toHaveBeenNthCalledWith(
      2,
      'target-user',
      'local-only'
    );
    expect(db.addSearchHistory).toHaveBeenNthCalledWith(
      3,
      'target-user',
      'remote-shared'
    );
  });

  it('persists the desktop admin config snapshot when provided', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'admin-user',
    });
    (getConfig as jest.Mock).mockResolvedValue({
      ConfigSubscribtion: {
        URL: '',
        AutoUpdate: false,
        LastCheck: '',
      },
      ConfigFile:
        '{"auth":{"username":"owner","password":"remote-owner-secret"}}',
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
          { username: 'owner', role: 'owner' },
          { username: 'admin-user', role: 'admin', banned: false },
          { username: 'target-user', role: 'user', banned: false },
        ],
      },
    });
    (db.getAllPlayRecords as jest.Mock).mockResolvedValue({});
    (db.getAllFavorites as jest.Mock).mockResolvedValue({});
    (db.getAllFollowRecords as jest.Mock).mockResolvedValue({});
    (db.getSearchHistory as jest.Mock).mockResolvedValue([]);
    (db.getAllSkipConfigs as jest.Mock).mockResolvedValue({});

    const adminConfig = {
      ConfigSubscribtion: {
        URL: '',
        AutoUpdate: false,
        LastCheck: '',
      },
      ConfigFile: '{"auth":{"username":"owner","password":"owner-secret"}}',
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
            username: 'owner',
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
    expect(db.saveAdminConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        ConfigFile:
          '{"auth":{"username":"owner","password":"remote-owner-secret"}}',
        SiteConfig: expect.objectContaining({
          SiteName: 'Desktop LunaTV',
        }),
        SourceConfig: expect.arrayContaining([
          expect.objectContaining({
            key: 'demo',
          }),
        ]),
        UserConfig: {
          Users: expect.arrayContaining([
            expect.objectContaining({
              username: 'desktop-admin',
              role: 'admin',
            }),
            expect.objectContaining({
              username: 'desktop-user',
              role: 'user',
            }),
          ]),
          Tags: expect.arrayContaining([
            expect.objectContaining({
              name: 'kids',
            }),
          ]),
        },
      })
    );
    expect(
      (db.saveAdminConfig as jest.Mock).mock.calls[0][0].SiteConfig
    ).not.toHaveProperty(removedSiteFlagKey);
  });
});
