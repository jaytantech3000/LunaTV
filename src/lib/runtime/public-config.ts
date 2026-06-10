import { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import { AppRuntimeConfig } from '@/lib/runtime-config';
import {
  AppStorageType,
  getConfiguredStorageType,
  getProfileMode,
  isSingleUserLocalMode,
} from '@/lib/runtime/storage-mode';
import { CURRENT_VERSION } from '@/lib/version';

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
  const baseRuntimeConfig: AppRuntimeConfig = {
    APP_TARGET: appTarget,
    STORAGE_TYPE: storageType,
    PROFILE_MODE: getProfileMode(storageType),
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
    API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || '',
    MEDIA_PROXY_BASE_URL:
      process.env.NEXT_PUBLIC_MEDIA_PROXY_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      '',
    ENABLE_ADMIN_PANEL:
      appTarget === 'desktop' ? false : isAdminPanelEnabled(),
  };

  if (!shouldUseServerConfigProjection(storageType)) {
    return baseRuntimeConfig;
  }

  const nextConfig = config || (await getConfig());

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
