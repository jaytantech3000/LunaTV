import type { AdminConfig } from '@/lib/admin.types';

import {
  applyAdminSettingsSyncSnapshot,
  pickAdminSettingsSyncSnapshot,
  redactAdminConfigForAdminRole,
} from './admin-settings-sync';

function buildAdminConfig(): AdminConfig {
  return {
    ConfigSubscribtion: {
      URL: 'https://remote.example/sub',
      AutoUpdate: true,
      LastCheck: '2026-07-02T00:00:00Z',
    },
    ConfigFile: '{"auth":{"username":"admin","password":"admin-secret"}}',
    SiteConfig: {
      SiteName: 'Remote LunaTV',
      Announcement: 'announcement',
      SearchDownstreamMaxPage: 8,
      SiteInterfaceCacheTime: 3600,
      DoubanProxyType: 'custom',
      DoubanProxy: 'https://remote.example/douban',
      DoubanImageProxyType: 'custom',
      DoubanImageProxy: 'https://remote.example/image',
      DisableYellowFilter: true,
      FluidSearch: false,
      EnableWebLive: true,
    },
    UserConfig: {
      Users: [
        { username: 'admin', role: 'owner' },
        { username: 'remote-admin', role: 'admin' },
      ],
      Tags: [{ name: 'kids', enabledApis: ['demo'] }],
    },
    SourceConfig: [
      {
        key: 'demo',
        name: 'Demo',
        api: 'https://remote.example/api.php/provide/vod',
        from: 'custom',
      },
    ],
    CustomCategories: [],
    LiveConfig: [],
    AdFilterConfig: { enabled: false },
    PlayerEnhancementConfig: {
      AudioSpikeProtection: true,
      VisualEnhancement: true,
    },
  };
}

describe('admin-settings-sync', () => {
  it('extracts only adminsettings business fields', () => {
    const snapshot = pickAdminSettingsSyncSnapshot(buildAdminConfig());

    expect(snapshot).toEqual({
      SiteConfig: expect.objectContaining({ SiteName: 'Remote LunaTV' }),
      SourceConfig: expect.arrayContaining([
        expect.objectContaining({ key: 'demo' }),
      ]),
      CustomCategories: [],
      LiveConfig: [],
      AdFilterConfig: { enabled: false },
      PlayerEnhancementConfig: expect.objectContaining({
        AudioSpikeProtection: true,
      }),
    });
    expect(snapshot).not.toHaveProperty('ConfigFile');
    expect(snapshot).not.toHaveProperty('UserConfig');
  });

  it('redacts owner-only raw fields for admin role reads without hiding users', () => {
    const config = buildAdminConfig();
    const redacted = redactAdminConfigForAdminRole(config);

    expect(redacted.ConfigFile).toBe('');
    expect(redacted.ConfigSubscribtion).toEqual({
      URL: '',
      AutoUpdate: false,
      LastCheck: '',
    });
    expect(redacted.UserConfig).toEqual(config.UserConfig);
    expect(redacted.SiteConfig.SiteName).toBe('Remote LunaTV');
  });

  it('applies only allowlisted fields when merging a sync snapshot', () => {
    const current = buildAdminConfig();
    const remote = buildAdminConfig();
    remote.SiteConfig.SiteName = 'Desktop LunaTV';
    remote.SourceConfig[0].name = 'Desktop Source';
    remote.CustomCategories = [
      {
        name: 'Desktop Movies',
        type: 'movie',
        query: 'desktop-movies',
        from: 'custom',
      },
    ];
    remote.LiveConfig = [
      {
        key: 'desktop-live',
        name: 'Desktop Live',
        url: 'https://desktop.example/live.m3u',
        from: 'custom',
      },
    ];
    remote.AdFilterConfig = { enabled: true };
    remote.PlayerEnhancementConfig = {
      AudioSpikeProtection: false,
      VisualEnhancement: false,
    };
    const merged = applyAdminSettingsSyncSnapshot(current, {
      ...pickAdminSettingsSyncSnapshot(remote),
    });

    expect(merged.SiteConfig.SiteName).toBe('Desktop LunaTV');
    expect(merged.SourceConfig[0].name).toBe('Desktop Source');
    expect(merged.CustomCategories[0].query).toBe('desktop-movies');
    expect(merged.LiveConfig?.[0].key).toBe('desktop-live');
    expect(merged.AdFilterConfig).toEqual({ enabled: true });
    expect(merged.PlayerEnhancementConfig).toEqual({
      AudioSpikeProtection: false,
      VisualEnhancement: false,
    });
    expect(merged.ConfigSubscribtion).toEqual(current.ConfigSubscribtion);
    expect(merged.ConfigFile).toBe(current.ConfigFile);
    expect(merged.UserConfig).toEqual(current.UserConfig);
  });
});
