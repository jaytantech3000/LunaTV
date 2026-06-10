import { AppRuntimeConfig, getRuntimeConfig } from '@/lib/runtime-config';

const FLUID_SEARCH_STORAGE_KEY = 'fluidSearch';
const DESKTOP_FLUID_SEARCH_MIGRATION_KEY =
  'desktopFluidSearchEnabledV1';

export function isFluidSearchSupported(
  runtimeConfig: AppRuntimeConfig = getRuntimeConfig()
): boolean {
  return runtimeConfig.FLUID_SEARCH !== false;
}

export function getDefaultFluidSearchSetting(
  runtimeConfig: AppRuntimeConfig = getRuntimeConfig()
): boolean {
  return isFluidSearchSupported(runtimeConfig);
}

export function getPreferredFluidSearchSetting(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const runtimeConfig = getRuntimeConfig();
  const defaultValue = getDefaultFluidSearchSetting(runtimeConfig);

  if (!defaultValue) {
    return false;
  }

  if (runtimeConfig.APP_TARGET === 'desktop') {
    const migrated = localStorage.getItem(DESKTOP_FLUID_SEARCH_MIGRATION_KEY);
    if (migrated !== '1') {
      localStorage.setItem(DESKTOP_FLUID_SEARCH_MIGRATION_KEY, '1');
      localStorage.setItem(FLUID_SEARCH_STORAGE_KEY, JSON.stringify(true));
      return true;
    }
  }

  const savedValue = localStorage.getItem(FLUID_SEARCH_STORAGE_KEY);
  if (savedValue !== null) {
    try {
      return JSON.parse(savedValue);
    } catch {
      return defaultValue;
    }
  }

  return defaultValue;
}

export function setPreferredFluidSearchSetting(value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(FLUID_SEARCH_STORAGE_KEY, JSON.stringify(value));

  if (getRuntimeConfig().APP_TARGET === 'desktop') {
    localStorage.setItem(DESKTOP_FLUID_SEARCH_MIGRATION_KEY, '1');
  }
}
