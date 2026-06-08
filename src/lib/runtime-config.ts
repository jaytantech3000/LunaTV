export interface RuntimeCustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
}

export interface AppRuntimeConfig {
  STORAGE_TYPE?: string;
  DOUBAN_PROXY_TYPE?: string;
  DOUBAN_PROXY?: string;
  DOUBAN_IMAGE_PROXY_TYPE?: string;
  DOUBAN_IMAGE_PROXY?: string;
  DISABLE_YELLOW_FILTER?: boolean;
  CUSTOM_CATEGORIES?: RuntimeCustomCategory[];
  FLUID_SEARCH?: boolean;
  ENABLE_WEB_LIVE?: boolean;
  API_BASE_URL?: string;
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
