/* eslint-disable no-console */
import { dispatchProfileCacheUpdate } from './cache';
import { PROFILE_USER_DATA_API_PATHS as USER_DATA_API_PATHS } from './contracts';
import { ensureDesktopLocalProfileStoreHydrated } from './desktop-local-migration';
import { cacheManager } from './hybrid-cache';
import { readLocalSkipConfigs, writeLocalSkipConfigs } from './local-adapter';
import {
  deleteRemoteProfileResource,
  fetchRemoteProfileJson as fetchFromApi,
  postRemoteProfilePayload,
} from './remote-adapter';
import { shouldUseProfileApiStorage } from './runtime';
import { generateStorageKey } from './storage-key';
import { SkipConfig } from '../types';

function triggerGlobalError(message: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('globalError', {
        detail: { message },
      })
    );
  }
}

function shouldUseRemoteUserDataStorage(): boolean {
  return shouldUseProfileApiStorage();
}

function dispatchSkipConfigsUpdated(configs: Record<string, SkipConfig>): void {
  dispatchProfileCacheUpdate('skipConfigsUpdated', configs);
}

export async function getSkipConfig(
  source: string,
  id: string
): Promise<SkipConfig | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  const key = generateStorageKey(source, id);

  if (shouldUseRemoteUserDataStorage()) {
    await ensureDesktopLocalProfileStoreHydrated();
    const cachedData = cacheManager.getCachedSkipConfigs();

    if (cachedData) {
      fetchFromApi<Record<string, SkipConfig>>(USER_DATA_API_PATHS.skipConfigs)
        .then((freshData) => {
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            dispatchSkipConfigsUpdated(freshData);
          }
        })
        .catch((err) => {
          console.warn('后台同步跳过片头片尾配置失败:', err);
        });

      return cachedData[key] || null;
    }

    try {
      const freshData = await fetchFromApi<Record<string, SkipConfig>>(
        USER_DATA_API_PATHS.skipConfigs
      );
      cacheManager.cacheSkipConfigs(freshData);
      return freshData[key] || null;
    } catch (err) {
      console.error('获取跳过片头片尾配置失败:', err);
      triggerGlobalError('获取跳过片头片尾配置失败');
      return null;
    }
  }

  try {
    const configs = readLocalSkipConfigs();
    return configs[key] || null;
  } catch (err) {
    console.error('读取跳过片头片尾配置失败:', err);
    triggerGlobalError('读取跳过片头片尾配置失败');
    return null;
  }
}

export async function saveSkipConfig(
  source: string,
  id: string,
  config: SkipConfig
): Promise<void> {
  const key = generateStorageKey(source, id);

  if (shouldUseRemoteUserDataStorage()) {
    await ensureDesktopLocalProfileStoreHydrated();
    const cachedConfigs = cacheManager.getCachedSkipConfigs() || {};
    cachedConfigs[key] = config;
    cacheManager.cacheSkipConfigs(cachedConfigs);
    dispatchSkipConfigsUpdated(cachedConfigs);

    try {
      await postRemoteProfilePayload(USER_DATA_API_PATHS.skipConfigs, {
        key,
        config,
      });
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
      triggerGlobalError('保存跳过片头片尾配置失败');
    }
    return;
  }

  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存跳过片头片尾配置到 localStorage');
    return;
  }

  try {
    const configs = readLocalSkipConfigs();
    configs[key] = config;
    writeLocalSkipConfigs(configs);
    dispatchSkipConfigsUpdated(configs);
  } catch (err) {
    console.error('保存跳过片头片尾配置失败:', err);
    triggerGlobalError('保存跳过片头片尾配置失败');
    throw err;
  }
}

export async function getAllSkipConfigs(): Promise<Record<string, SkipConfig>> {
  if (typeof window === 'undefined') {
    return {};
  }

  if (shouldUseRemoteUserDataStorage()) {
    await ensureDesktopLocalProfileStoreHydrated();
    const cachedData = cacheManager.getCachedSkipConfigs();

    if (cachedData) {
      fetchFromApi<Record<string, SkipConfig>>(USER_DATA_API_PATHS.skipConfigs)
        .then((freshData) => {
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            dispatchSkipConfigsUpdated(freshData);
          }
        })
        .catch((err) => {
          console.warn('后台同步跳过片头片尾配置失败:', err);
          triggerGlobalError('后台同步跳过片头片尾配置失败');
        });

      return cachedData;
    }

    try {
      const freshData = await fetchFromApi<Record<string, SkipConfig>>(
        USER_DATA_API_PATHS.skipConfigs
      );
      cacheManager.cacheSkipConfigs(freshData);
      return freshData;
    } catch (err) {
      console.error('获取跳过片头片尾配置失败:', err);
      triggerGlobalError('获取跳过片头片尾配置失败');
      return {};
    }
  }

  try {
    return readLocalSkipConfigs();
  } catch (err) {
    console.error('读取跳过片头片尾配置失败:', err);
    triggerGlobalError('读取跳过片头片尾配置失败');
    return {};
  }
}

export async function deleteSkipConfig(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  if (shouldUseRemoteUserDataStorage()) {
    await ensureDesktopLocalProfileStoreHydrated();
    const cachedConfigs = cacheManager.getCachedSkipConfigs() || {};
    delete cachedConfigs[key];
    cacheManager.cacheSkipConfigs(cachedConfigs);
    dispatchSkipConfigsUpdated(cachedConfigs);

    try {
      await deleteRemoteProfileResource(USER_DATA_API_PATHS.skipConfigs, {
        key,
      });
    } catch (err) {
      console.error('删除跳过片头片尾配置失败:', err);
      triggerGlobalError('删除跳过片头片尾配置失败');
    }
    return;
  }

  if (typeof window === 'undefined') {
    console.warn('无法在服务端删除跳过片头片尾配置到 localStorage');
    return;
  }

  try {
    const configs = readLocalSkipConfigs();
    delete configs[key];
    writeLocalSkipConfigs(configs);
    dispatchSkipConfigsUpdated(configs);
  } catch (err) {
    console.error('删除跳过片头片尾配置失败:', err);
    triggerGlobalError('删除跳过片头片尾配置失败');
    throw err;
  }
}
