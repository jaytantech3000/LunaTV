import {
  AudioSpikeProtectionLevel,
  normalizeAudioSpikeProtectionLevel,
  normalizeBooleanSetting,
  normalizeVisualEnhancementLevel,
  VisualEnhancementLevel,
} from '@/lib/player-enhancement-types';
import {
  AppRuntimeConfig,
  getRuntimeConfig,
  RuntimeCustomCategory,
} from '@/lib/runtime-config';

export interface DesktopRuntimePublicConfigPayload {
  siteName?: string | null;
  announcement?: string | null;
  doubanProxyType?: string | null;
  doubanProxy?: string | null;
  doubanImageProxyType?: string | null;
  doubanImageProxy?: string | null;
  disableYellowFilter?: boolean;
  fluidSearch?: boolean;
  enableWebLive?: boolean;
  playerAudioSpikeProtection?: boolean;
  playerAudioDynamicProtection?: boolean;
  playerAudioFixedCeiling?: boolean;
  playerVisualEnhancement?: boolean;
  playerAudioSpikeProtectionLevel?: AudioSpikeProtectionLevel | null;
  playerVisualEnhancementLevel?: VisualEnhancementLevel | null;
  profileSyncEnabled?: boolean;
  customCategories?: RuntimeCustomCategory[] | null;
}

export interface DesktopSitePresentation {
  siteName?: string;
  announcement?: string;
}

export const DESKTOP_RUNTIME_UPDATED_EVENT = 'lunatv:runtime-config-updated';
export const DESKTOP_RUNTIME_REFRESH_EVENT = 'lunatv:refresh-runtime-config';

declare global {
  interface Window {
    __SITE_PRESENTATION__?: DesktopSitePresentation;
  }
}

function normalizeCustomCategories(
  categories?: RuntimeCustomCategory[] | null
): RuntimeCustomCategory[] {
  if (!Array.isArray(categories)) {
    return [];
  }

  return categories
    .filter((category): category is RuntimeCustomCategory =>
      Boolean(
        category &&
          typeof category.name === 'string' &&
          typeof category.type === 'string' &&
          typeof category.query === 'string'
      )
    )
    .map((category) => ({
      name: category.name,
      type: category.type,
      query: category.query,
    }));
}

function sanitizeRuntimeConfig(config: AppRuntimeConfig): AppRuntimeConfig {
  return {
    APP_TARGET: config.APP_TARGET,
    STORAGE_TYPE: config.STORAGE_TYPE,
    PROFILE_MODE: config.PROFILE_MODE,
    DESKTOP_RELEASE_PROXY_BASE_URL: config.DESKTOP_RELEASE_PROXY_BASE_URL,
    DOUBAN_PROXY_TYPE: config.DOUBAN_PROXY_TYPE,
    DOUBAN_PROXY: config.DOUBAN_PROXY,
    DOUBAN_IMAGE_PROXY_TYPE: config.DOUBAN_IMAGE_PROXY_TYPE,
    DOUBAN_IMAGE_PROXY: config.DOUBAN_IMAGE_PROXY,
    DISABLE_YELLOW_FILTER: config.DISABLE_YELLOW_FILTER,
    CUSTOM_CATEGORIES: config.CUSTOM_CATEGORIES,
    FLUID_SEARCH: config.FLUID_SEARCH,
    ENABLE_WEB_LIVE: config.ENABLE_WEB_LIVE,
    API_BASE_URL: config.API_BASE_URL,
    MEDIA_PROXY_BASE_URL: config.MEDIA_PROXY_BASE_URL,
    ENABLE_ADMIN_PANEL: config.ENABLE_ADMIN_PANEL,
    PLAYER_AUDIO_SPIKE_PROTECTION: config.PLAYER_AUDIO_SPIKE_PROTECTION,
    PLAYER_AUDIO_DYNAMIC_PROTECTION: config.PLAYER_AUDIO_DYNAMIC_PROTECTION,
    PLAYER_AUDIO_FIXED_CEILING: config.PLAYER_AUDIO_FIXED_CEILING,
    PLAYER_VISUAL_ENHANCEMENT: config.PLAYER_VISUAL_ENHANCEMENT,
    PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL:
      config.PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL,
    PLAYER_VISUAL_ENHANCEMENT_LEVEL: config.PLAYER_VISUAL_ENHANCEMENT_LEVEL,
    PROFILE_SYNC_ENABLED: config.PROFILE_SYNC_ENABLED,
    PROFILE_SYNC_STORAGE_TYPE: config.PROFILE_SYNC_STORAGE_TYPE,
    PROFILE_SYNC_PROFILE_MODE: config.PROFILE_SYNC_PROFILE_MODE,
  };
}

export function mergeDesktopRuntimePublicConfig(
  currentConfig: AppRuntimeConfig,
  payload: DesktopRuntimePublicConfigPayload
): AppRuntimeConfig {
  const runtimeConfig = sanitizeRuntimeConfig(currentConfig);
  const audioSpikeProtectionLevel = normalizeAudioSpikeProtectionLevel(
    payload.playerAudioSpikeProtectionLevel ??
      payload.playerAudioSpikeProtection ??
      runtimeConfig.PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL ??
      runtimeConfig.PLAYER_AUDIO_SPIKE_PROTECTION,
    'off'
  );
  const visualEnhancementLevel = normalizeVisualEnhancementLevel(
    payload.playerVisualEnhancementLevel ??
      payload.playerVisualEnhancement ??
      runtimeConfig.PLAYER_VISUAL_ENHANCEMENT_LEVEL ??
      runtimeConfig.PLAYER_VISUAL_ENHANCEMENT,
    'off'
  );
  const audioDynamicProtection = normalizeBooleanSetting(
    payload.playerAudioDynamicProtection ??
      runtimeConfig.PLAYER_AUDIO_DYNAMIC_PROTECTION,
    audioSpikeProtectionLevel !== 'off'
  );
  const audioFixedCeiling = normalizeBooleanSetting(
    payload.playerAudioFixedCeiling ?? runtimeConfig.PLAYER_AUDIO_FIXED_CEILING,
    audioSpikeProtectionLevel !== 'off'
  );

  return {
    ...runtimeConfig,
    DOUBAN_PROXY_TYPE:
      payload.doubanProxyType ?? runtimeConfig.DOUBAN_PROXY_TYPE,
    DOUBAN_PROXY: payload.doubanProxy ?? runtimeConfig.DOUBAN_PROXY,
    DOUBAN_IMAGE_PROXY_TYPE:
      payload.doubanImageProxyType ?? runtimeConfig.DOUBAN_IMAGE_PROXY_TYPE,
    DOUBAN_IMAGE_PROXY:
      payload.doubanImageProxy ?? runtimeConfig.DOUBAN_IMAGE_PROXY,
    DISABLE_YELLOW_FILTER:
      payload.disableYellowFilter ??
      runtimeConfig.DISABLE_YELLOW_FILTER ??
      false,
    FLUID_SEARCH: payload.fluidSearch ?? runtimeConfig.FLUID_SEARCH ?? true,
    ENABLE_WEB_LIVE:
      payload.enableWebLive ?? runtimeConfig.ENABLE_WEB_LIVE ?? false,
    PLAYER_AUDIO_SPIKE_PROTECTION: audioSpikeProtectionLevel !== 'off',
    PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: audioSpikeProtectionLevel,
    PLAYER_AUDIO_DYNAMIC_PROTECTION: audioDynamicProtection,
    PLAYER_AUDIO_FIXED_CEILING: audioFixedCeiling,
    PLAYER_VISUAL_ENHANCEMENT: visualEnhancementLevel !== 'off',
    PLAYER_VISUAL_ENHANCEMENT_LEVEL: visualEnhancementLevel,
    PROFILE_SYNC_ENABLED:
      payload.profileSyncEnabled ?? runtimeConfig.PROFILE_SYNC_ENABLED ?? false,
    CUSTOM_CATEGORIES:
      payload.customCategories !== undefined
        ? normalizeCustomCategories(payload.customCategories)
        : runtimeConfig.CUSTOM_CATEGORIES || [],
  };
}

export function applyDesktopRuntimePublicConfig(
  payload: DesktopRuntimePublicConfigPayload
): AppRuntimeConfig {
  const currentConfig = getRuntimeConfig();
  const nextConfig = mergeDesktopRuntimePublicConfig(currentConfig, payload);

  if (typeof window !== 'undefined') {
    window.RUNTIME_CONFIG = nextConfig;
    window.__SITE_PRESENTATION__ = {
      siteName: payload.siteName ?? window.__SITE_PRESENTATION__?.siteName,
      announcement:
        payload.announcement ?? window.__SITE_PRESENTATION__?.announcement,
    };
  }

  return nextConfig;
}

export function getDesktopSitePresentation(): DesktopSitePresentation {
  if (typeof window === 'undefined') {
    return {};
  }

  return window.__SITE_PRESENTATION__ || {};
}

export function requestDesktopRuntimeRefresh() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(DESKTOP_RUNTIME_REFRESH_EVENT));
}
