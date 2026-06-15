jest.mock('@/lib/db', () => ({
  db: {
    getAdminConfig: jest.fn(),
    saveAdminConfig: jest.fn(),
    getAllUsers: jest.fn(async () => ['admin']),
  },
}));

import { AdminConfig } from './admin.types';
import { configSelfCheck } from './config';

function buildAdminConfig(
  overrides: Partial<AdminConfig> = {}
): AdminConfig {
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
      DoubanProxyType: '',
      DoubanProxy: '',
      DoubanImageProxyType: '',
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
    PlayerEnhancementConfig: {
      AudioSpikeProtection: true,
      AudioSpikeProtectionLevel: 'standard',
      AudioDynamicProtection: true,
      AudioFixedCeiling: true,
      VisualEnhancement: false,
      VisualEnhancementLevel: 'off',
    },
    ...overrides,
  };
}

describe('configSelfCheck player enhancement migration', () => {
  const originalUsername = process.env.USERNAME;

  beforeEach(() => {
    process.env.USERNAME = 'admin';
  });

  afterEach(() => {
    process.env.USERNAME = originalUsername;
  });

  it('migrates legacy default audio enhancement values in persisted config files', () => {
    const adminConfig = buildAdminConfig({
      ConfigFile: JSON.stringify({
        player_enhancements: {
          audio_spike_protection_level: 'standard',
          audio_dynamic_protection: true,
          audio_fixed_ceiling: true,
          visual_enhancement_level: 'off',
        },
      }),
    });

    const result = configSelfCheck(adminConfig);
    const fileConfig = JSON.parse(result.ConfigFile);

    expect(result.PlayerEnhancementConfig).toMatchObject({
      AudioSpikeProtection: false,
      AudioSpikeProtectionLevel: 'off',
      AudioDynamicProtection: false,
      AudioFixedCeiling: false,
    });
    expect(fileConfig.player_enhancements).toMatchObject({
      audio_defaults_migrated_v2: true,
      audio_spike_protection_level: 'off',
      audio_spike_protection: false,
      audio_dynamic_protection: false,
      audio_fixed_ceiling: false,
    });
  });

  it('keeps explicit non-default audio enhancement settings intact', () => {
    const adminConfig = buildAdminConfig({
      ConfigFile: JSON.stringify({
        player_enhancements: {
          audio_spike_protection_level: 'light',
          audio_dynamic_protection: true,
          audio_fixed_ceiling: false,
          visual_enhancement_level: 'off',
        },
      }),
      PlayerEnhancementConfig: {
        AudioSpikeProtection: true,
        AudioSpikeProtectionLevel: 'light',
        AudioDynamicProtection: true,
        AudioFixedCeiling: false,
        VisualEnhancement: false,
        VisualEnhancementLevel: 'off',
      },
    });

    const result = configSelfCheck(adminConfig);

    expect(result.PlayerEnhancementConfig).toMatchObject({
      AudioSpikeProtection: true,
      AudioSpikeProtectionLevel: 'light',
      AudioDynamicProtection: true,
      AudioFixedCeiling: false,
    });
  });
});
