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

export function mergeDesktopRuntimePublicConfig(
  currentConfig: AppRuntimeConfig,
  payload: DesktopRuntimePublicConfigPayload
): AppRuntimeConfig {
  const audioSpikeProtectionLevel = normalizeAudioSpikeProtectionLevel(
    payload.playerAudioSpikeProtectionLevel ??
      payload.playerAudioSpikeProtection ??
      currentConfig.PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL ??
      currentConfig.PLAYER_AUDIO_SPIKE_PROTECTION,
    'off'
  );
  const visualEnhancementLevel = normalizeVisualEnhancementLevel(
    payload.playerVisualEnhancementLevel ??
      payload.playerVisualEnhancement ??
      currentConfig.PLAYER_VISUAL_ENHANCEMENT_LEVEL ??
      currentConfig.PLAYER_VISUAL_ENHANCEMENT,
    'off'
  );
  const audioDynamicProtection = normalizeBooleanSetting(
    payload.playerAudioDynamicProtection ??
      currentConfig.PLAYER_AUDIO_DYNAMIC_PROTECTION,
    audioSpikeProtectionLevel !== 'off'
  );
  const audioFixedCeiling = normalizeBooleanSetting(
    payload.playerAudioFixedCeiling ??
      currentConfig.PLAYER_AUDIO_FIXED_CEILING,
    audioSpikeProtectionLevel !== 'off'
  );

  return {
    ...currentConfig,
    DOUBAN_PROXY_TYPE:
      payload.doubanProxyType ?? currentConfig.DOUBAN_PROXY_TYPE,
    DOUBAN_PROXY: payload.doubanProxy ?? currentConfig.DOUBAN_PROXY,
    DOUBAN_IMAGE_PROXY_TYPE:
      payload.doubanImageProxyType ?? currentConfig.DOUBAN_IMAGE_PROXY_TYPE,
    DOUBAN_IMAGE_PROXY:
      payload.doubanImageProxy ?? currentConfig.DOUBAN_IMAGE_PROXY,
    DISABLE_YELLOW_FILTER:
      payload.disableYellowFilter ??
      currentConfig.DISABLE_YELLOW_FILTER ??
      false,
    FLUID_SEARCH: payload.fluidSearch ?? currentConfig.FLUID_SEARCH ?? true,
    ENABLE_WEB_LIVE:
      payload.enableWebLive ?? currentConfig.ENABLE_WEB_LIVE ?? false,
    PLAYER_AUDIO_SPIKE_PROTECTION: audioSpikeProtectionLevel !== 'off',
    PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: audioSpikeProtectionLevel,
    PLAYER_AUDIO_DYNAMIC_PROTECTION: audioDynamicProtection,
    PLAYER_AUDIO_FIXED_CEILING: audioFixedCeiling,
    PLAYER_VISUAL_ENHANCEMENT: visualEnhancementLevel !== 'off',
    PLAYER_VISUAL_ENHANCEMENT_LEVEL: visualEnhancementLevel,
    PROFILE_SYNC_ENABLED:
      payload.profileSyncEnabled ?? currentConfig.PROFILE_SYNC_ENABLED ?? false,
    CUSTOM_CATEGORIES:
      payload.customCategories !== undefined
        ? normalizeCustomCategories(payload.customCategories)
        : currentConfig.CUSTOM_CATEGORIES || [],
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
