import type { AdminConfig } from '@/lib/admin.types';

export type AdminSettingsSyncSnapshot = Pick<
  AdminConfig,
  | 'SiteConfig'
  | 'SourceConfig'
  | 'CustomCategories'
  | 'LiveConfig'
  | 'AdFilterConfig'
  | 'PlayerEnhancementConfig'
>;

const EMPTY_CONFIG_SUBSCRIPTION: AdminConfig['ConfigSubscribtion'] = {
  URL: '',
  AutoUpdate: false,
  LastCheck: '',
};

export function pickAdminSettingsSyncSnapshot(
  config: AdminConfig
): AdminSettingsSyncSnapshot {
  return {
    SiteConfig: config.SiteConfig,
    SourceConfig: config.SourceConfig,
    CustomCategories: config.CustomCategories,
    LiveConfig: config.LiveConfig ?? [],
    AdFilterConfig: config.AdFilterConfig ?? { enabled: true },
    PlayerEnhancementConfig: config.PlayerEnhancementConfig ?? {
      AudioSpikeProtection: false,
      VisualEnhancement: false,
    },
  };
}

export function applyAdminSettingsSyncSnapshot(
  currentConfig: AdminConfig,
  snapshot: Partial<AdminSettingsSyncSnapshot>
): AdminConfig {
  return {
    ...currentConfig,
    SiteConfig: snapshot.SiteConfig ?? currentConfig.SiteConfig,
    SourceConfig: snapshot.SourceConfig ?? currentConfig.SourceConfig,
    CustomCategories:
      snapshot.CustomCategories ?? currentConfig.CustomCategories,
    LiveConfig: snapshot.LiveConfig ?? currentConfig.LiveConfig,
    AdFilterConfig: snapshot.AdFilterConfig ?? currentConfig.AdFilterConfig,
    PlayerEnhancementConfig:
      snapshot.PlayerEnhancementConfig ?? currentConfig.PlayerEnhancementConfig,
  };
}

export function redactAdminConfigForAdminRole(
  config: AdminConfig
): AdminConfig {
  return {
    ...config,
    ConfigSubscribtion: EMPTY_CONFIG_SUBSCRIPTION,
    ConfigFile: '',
  };
}
