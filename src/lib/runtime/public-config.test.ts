jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

import type { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';

import { buildPublicRuntimeConfig } from './public-config';

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
const removedSiteFlagKey = ['Enable', 'WebMusic'].join('');
const removedEnvKey = ['NEXT', 'PUBLIC', 'ENABLE', 'WEB', 'MUSIC'].join('_');

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

  it('does not project the legacy admin music switch into desktop runtime config', async () => {
    mockGetConfig.mockResolvedValue(buildAdminConfig());

    const runtimeConfig = await buildPublicRuntimeConfig();

    expect(runtimeConfig).toMatchObject({
      APP_TARGET: 'desktop',
      ENABLE_WEB_LIVE: false,
    });
    expect(runtimeConfig).not.toHaveProperty(
      removedEnvKey.replace(/^NEXT_PUBLIC_/, '')
    );
  });

  it('ignores the removed runtime env switch even if legacy env state still exists', async () => {
    process.env[removedEnvKey] = 'false';
    mockGetConfig.mockResolvedValue({
      ...buildAdminConfig(),
      SiteConfig: {
        ...buildAdminConfig().SiteConfig,
        [removedSiteFlagKey]: true,
      },
    });

    const runtimeConfig = await buildPublicRuntimeConfig();

    expect(runtimeConfig).toMatchObject({
      APP_TARGET: 'desktop',
      ENABLE_WEB_LIVE: false,
    });
    expect(runtimeConfig).not.toHaveProperty(
      removedEnvKey.replace(/^NEXT_PUBLIC_/, '')
    );
  });
});
