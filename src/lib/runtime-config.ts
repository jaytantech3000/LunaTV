export interface RuntimeCustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
}

export type RuntimePlayerEnhancementLevel =
  | 'off'
  | 'light'
  | 'standard'
  | 'strong';

export interface AppRuntimeConfig {
  APP_TARGET?: 'web' | 'desktop';
  STORAGE_TYPE?: string;
  PROFILE_MODE?: 'single-user-local' | 'shared-multi-user';
  DESKTOP_RELEASE_PROXY_BASE_URL?: string;
  DOUBAN_PROXY_TYPE?: string;
  DOUBAN_PROXY?: string;
  DOUBAN_IMAGE_PROXY_TYPE?: string;
  DOUBAN_IMAGE_PROXY?: string;
  DISABLE_YELLOW_FILTER?: boolean;
  CUSTOM_CATEGORIES?: RuntimeCustomCategory[];
  FLUID_SEARCH?: boolean;
  ENABLE_WEB_LIVE?: boolean;
  API_BASE_URL?: string;
  MEDIA_PROXY_BASE_URL?: string;
  ENABLE_ADMIN_PANEL?: boolean;
  PLAYER_AUDIO_SPIKE_PROTECTION?: boolean;
  PLAYER_AUDIO_DYNAMIC_PROTECTION?: boolean;
  PLAYER_AUDIO_FIXED_CEILING?: boolean;
  PLAYER_VISUAL_ENHANCEMENT?: boolean;
  PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL?: RuntimePlayerEnhancementLevel;
  PLAYER_VISUAL_ENHANCEMENT_LEVEL?: RuntimePlayerEnhancementLevel;
  PROFILE_SYNC_ENABLED?: boolean;
  PROFILE_SYNC_STORAGE_TYPE?: string;
  PROFILE_SYNC_PROFILE_MODE?: 'single-user-local' | 'shared-multi-user';
}

declare global {
  interface Window {
    RUNTIME_CONFIG?: AppRuntimeConfig;
  }
}

export function getRuntimeConfig(): AppRuntimeConfig {
  if (typeof window === 'undefined') {
    return {};
  }

  return window.RUNTIME_CONFIG || {};
}

export function getAppTarget(): 'web' | 'desktop' {
  return getRuntimeConfig().APP_TARGET || 'web';
}

export function isDesktopAppTarget(): boolean {
  return getAppTarget() === 'desktop';
}
