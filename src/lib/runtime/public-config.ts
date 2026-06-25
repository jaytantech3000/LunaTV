import { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import {
  normalizeAudioSpikeProtectionLevel,
  normalizeBooleanSetting,
  normalizeVisualEnhancementLevel,
} from '@/lib/player-enhancement-types';
import {
  AppStorageType,
  getConfiguredStorageType,
  getProfileMode,
  isSingleUserLocalMode,
} from '@/lib/runtime/storage-mode';
import { AppRuntimeConfig } from '@/lib/runtime-config';
import { CURRENT_VERSION } from '@/lib/version';

const DEFAULT_DESKTOP_RELEASE_PROXY_BASE_URL = 'https://hkcu.qzz.io';

export interface SitePresentation {
  siteName: string;
  announcement: string;
}

function shouldUseServerConfigProjection(storageType: AppStorageType): boolean {
  return !isSingleUserLocalMode(storageType);
}

export function isAdminPanelEnabled(): boolean {
  const explicitFlag = process.env.NEXT_PUBLIC_ENABLE_ADMIN_PANEL;
  if (explicitFlag === 'true') {
    return true;
  }

  if (explicitFlag === 'false') {
    return false;
  }

  return !(process.env.NEXT_PUBLIC_API_BASE_URL || '').trim();
}

function isWebMusicEnabled(appTarget: AppRuntimeConfig['APP_TARGET']): boolean {
  const explicitFlag = process.env.NEXT_PUBLIC_ENABLE_WEB_MUSIC;
  if (explicitFlag === 'true') {
    return true;
  }

  if (explicitFlag === 'false') {
    return false;
  }

  return appTarget !== 'desktop';
}

export async function resolveSitePresentation(
  config?: AdminConfig
): Promise<SitePresentation> {
  const storageType = getConfiguredStorageType();
  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTV';
  let announcement =
    process.env.ANNOUNCEMENT ||
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。';

  if (shouldUseServerConfigProjection(storageType)) {
    const nextConfig = config || (await getConfig());
    siteName = nextConfig.SiteConfig.SiteName;
    announcement = nextConfig.SiteConfig.Announcement;
  }

  return {
    siteName,
    announcement,
  };
}

export async function buildPublicRuntimeConfig(
  config?: AdminConfig
): Promise<AppRuntimeConfig> {
  const storageType = getConfiguredStorageType();
  const appTarget =
    (process.env.NEXT_PUBLIC_APP_TARGET as AppRuntimeConfig['APP_TARGET']) ||
    'web';
  const baseAudioSpikeProtectionLevel = normalizeAudioSpikeProtectionLevel(
    process.env.NEXT_PUBLIC_PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL ??
      process.env.NEXT_PUBLIC_PLAYER_AUDIO_SPIKE_PROTECTION,
    'off'
  );
  const baseAudioDynamicProtection = normalizeBooleanSetting(
    process.env.NEXT_PUBLIC_PLAYER_AUDIO_DYNAMIC_PROTECTION,
    baseAudioSpikeProtectionLevel !== 'off'
  );
  const baseAudioFixedCeiling = normalizeBooleanSetting(
    process.env.NEXT_PUBLIC_PLAYER_AUDIO_FIXED_CEILING,
    baseAudioSpikeProtectionLevel !== 'off'
  );
  const baseVisualEnhancementLevel = normalizeVisualEnhancementLevel(
    process.env.NEXT_PUBLIC_PLAYER_VISUAL_ENHANCEMENT_LEVEL ??
      process.env.NEXT_PUBLIC_PLAYER_VISUAL_ENHANCEMENT,
    'off'
  );
  const baseRuntimeConfig: AppRuntimeConfig = {
    APP_TARGET: appTarget,
    STORAGE_TYPE: storageType,
    PROFILE_MODE: getProfileMode(storageType),
    DESKTOP_RELEASE_PROXY_BASE_URL:
      process.env.NEXT_PUBLIC_DESKTOP_RELEASE_PROXY_BASE_URL ||
      process.env.SITE_BASE ||
      (appTarget === 'desktop' ? DEFAULT_DESKTOP_RELEASE_PROXY_BASE_URL : '') ||
      '',
    DOUBAN_PROXY_TYPE:
      process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'cmliussss-cdn-tencent',
    DOUBAN_PROXY: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
    DOUBAN_IMAGE_PROXY_TYPE:
      process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE ||
      'cmliussss-cdn-tencent',
    DOUBAN_IMAGE_PROXY: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
    DISABLE_YELLOW_FILTER:
      process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
    CUSTOM_CATEGORIES: [],
    FLUID_SEARCH: process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false',
    ENABLE_WEB_LIVE: false,
    ENABLE_WEB_MUSIC: isWebMusicEnabled(appTarget),
    API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || '',
    MEDIA_PROXY_BASE_URL:
      process.env.NEXT_PUBLIC_MEDIA_PROXY_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      '',
    ENABLE_ADMIN_PANEL: appTarget === 'desktop' ? false : isAdminPanelEnabled(),
    PLAYER_AUDIO_SPIKE_PROTECTION: baseAudioSpikeProtectionLevel !== 'off',
    PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: baseAudioSpikeProtectionLevel,
    PLAYER_AUDIO_DYNAMIC_PROTECTION: baseAudioDynamicProtection,
    PLAYER_AUDIO_FIXED_CEILING: baseAudioFixedCeiling,
    PLAYER_VISUAL_ENHANCEMENT: baseVisualEnhancementLevel !== 'off',
    PLAYER_VISUAL_ENHANCEMENT_LEVEL: baseVisualEnhancementLevel,
  };

  if (!shouldUseServerConfigProjection(storageType)) {
    return baseRuntimeConfig;
  }

  const nextConfig = config || (await getConfig());
  const playerEnhancementConfig = nextConfig.PlayerEnhancementConfig;
  const audioSpikeProtectionLevel = normalizeAudioSpikeProtectionLevel(
    playerEnhancementConfig?.AudioSpikeProtectionLevel ??
      playerEnhancementConfig?.AudioSpikeProtection ??
      false,
    'off'
  );
  const audioDynamicProtection = normalizeBooleanSetting(
    playerEnhancementConfig?.AudioDynamicProtection,
    baseAudioDynamicProtection
  );
  const audioFixedCeiling = normalizeBooleanSetting(
    playerEnhancementConfig?.AudioFixedCeiling,
    baseAudioFixedCeiling
  );
  const visualEnhancementLevel = normalizeVisualEnhancementLevel(
    playerEnhancementConfig?.VisualEnhancementLevel ??
      playerEnhancementConfig?.VisualEnhancement ??
      false,
    'off'
  );

  return {
    ...baseRuntimeConfig,
    DOUBAN_PROXY_TYPE: nextConfig.SiteConfig.DoubanProxyType,
    DOUBAN_PROXY: nextConfig.SiteConfig.DoubanProxy,
    DOUBAN_IMAGE_PROXY_TYPE: nextConfig.SiteConfig.DoubanImageProxyType,
    DOUBAN_IMAGE_PROXY: nextConfig.SiteConfig.DoubanImageProxy,
    DISABLE_YELLOW_FILTER: nextConfig.SiteConfig.DisableYellowFilter,
    CUSTOM_CATEGORIES: nextConfig.CustomCategories.filter(
      (category) => !category.disabled
    ).map((category) => ({
      name: category.name || '',
      type: category.type,
      query: category.query,
    })),
    FLUID_SEARCH: nextConfig.SiteConfig.FluidSearch,
    ENABLE_WEB_LIVE: nextConfig.SiteConfig.EnableWebLive ?? false,
    PLAYER_AUDIO_SPIKE_PROTECTION: audioSpikeProtectionLevel !== 'off',
    PLAYER_AUDIO_SPIKE_PROTECTION_LEVEL: audioSpikeProtectionLevel,
    PLAYER_AUDIO_DYNAMIC_PROTECTION: audioDynamicProtection,
    PLAYER_AUDIO_FIXED_CEILING: audioFixedCeiling,
    PLAYER_VISUAL_ENHANCEMENT: visualEnhancementLevel !== 'off',
    PLAYER_VISUAL_ENHANCEMENT_LEVEL: visualEnhancementLevel,
  };
}

export async function buildServerConfigPayload(config?: AdminConfig): Promise<{
  SiteName: string;
  StorageType: AppStorageType;
  ProfileMode: ReturnType<typeof getProfileMode>;
  EnableAdminPanel: boolean;
  Version: string;
}> {
  const storageType = getConfiguredStorageType();
  const presentation = await resolveSitePresentation(config);

  return {
    SiteName: presentation.siteName,
    StorageType: storageType,
    ProfileMode: getProfileMode(storageType),
    EnableAdminPanel: isAdminPanelEnabled(),
    Version: CURRENT_VERSION,
  };
}
