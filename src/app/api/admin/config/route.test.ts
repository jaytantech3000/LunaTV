jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

import { GET } from './route';

describe('/api/admin/config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    process.env.USERNAME = 'admin';
  });

  it('returns a redacted config for admin users without hiding user-management data', async () => {
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'remote-admin',
    });
    (getConfig as jest.Mock).mockResolvedValue({
      ConfigSubscribtion: {
        URL: 'https://remote.example/sub',
        AutoUpdate: true,
        LastCheck: '2026-07-02T00:00:00Z',
      },
      ConfigFile: '{"auth":{"username":"admin","password":"admin-secret"}}',
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
          { username: 'remote-admin', role: 'admin', banned: false },
        ],
        Tags: [{ name: 'kids', enabledApis: ['demo'] }],
      },
      SourceConfig: [],
      CustomCategories: [],
      LiveConfig: [],
      AdFilterConfig: { enabled: true },
      PlayerEnhancementConfig: {
        AudioSpikeProtection: false,
        VisualEnhancement: false,
      },
    });

    const response = await GET(
      new NextRequest('http://localhost/api/admin/config')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      Role: 'admin',
      Config: expect.objectContaining({
        ConfigSubscribtion: {
          URL: '',
          AutoUpdate: false,
          LastCheck: '',
        },
        ConfigFile: '',
        UserConfig: {
          Users: [
            { username: 'admin', role: 'owner' },
            { username: 'remote-admin', role: 'admin', banned: false },
          ],
          Tags: [{ name: 'kids', enabledApis: ['demo'] }],
        },
        SiteConfig: expect.objectContaining({
          SiteName: 'Remote LunaTV',
        }),
      }),
    });
  });
});
