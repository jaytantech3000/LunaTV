jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

import type { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';

import { buildPublicRuntimeConfig } from './public-config';

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;

function buildAdminConfig(): AdminConfig {
  return {
    ConfigSubscribtion: {
      URL: '',
      AutoUpdate: false,
      LastCheck: '',
    },
    ConfigFile: '{}',
    SiteConfig: {
      SiteName: 'LunaTV',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType: 'custom',
      DoubanProxy: '',
      DoubanImageProxyType: 'server',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
      FluidSearch: true,
      EnableWebLive: false,
      EnableWebMusic: true,
    },
    UserConfig: {
      Users: [],
    },
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
    AdFilterConfig: {
      enabled: true,
    },
  };
}

describe('buildPublicRuntimeConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_STORAGE_TYPE: 'redis',
      NEXT_PUBLIC_APP_TARGET: 'desktop',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('projects the admin music switch into desktop runtime config', async () => {
    mockGetConfig.mockResolvedValue(buildAdminConfig());

    await expect(buildPublicRuntimeConfig()).resolves.toMatchObject({
      APP_TARGET: 'desktop',
      ENABLE_WEB_MUSIC: true,
      ENABLE_WEB_LIVE: false,
    });
  });

  it('keeps desktop music disabled until the admin switch enables it', async () => {
    mockGetConfig.mockResolvedValue({
      ...buildAdminConfig(),
      SiteConfig: {
        ...buildAdminConfig().SiteConfig,
        EnableWebMusic: false,
      },
    });

    await expect(buildPublicRuntimeConfig()).resolves.toMatchObject({
      APP_TARGET: 'desktop',
      ENABLE_WEB_MUSIC: false,
      ENABLE_WEB_LIVE: false,
    });
  });
});
