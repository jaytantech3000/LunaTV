/* eslint-disable no-console */
import { dispatchProfileCacheUpdate } from './cache';
import { PROFILE_USER_DATA_API_PATHS as USER_DATA_API_PATHS } from './contracts';
import { ensureDesktopLocalProfileStoreHydrated } from './desktop-local-migration';
import { cacheManager } from './hybrid-cache';
import { readLocalSkipConfigs, writeLocalSkipConfigs } from './local-adapter';
import {
  deleteRemoteProfileResource,
  fetchRemoteProfileJson as fetchFromApi,
  isUnauthorizedRemoteProfileRequestError as isUnauthorizedRequestError,
  postRemoteProfilePayload,
  wasRemoteProfileRequestRedirectedToLogin as wasRedirectedToLogin,
} from './remote-adapter';
import {
  isProfileApiAuthPending,
  PROFILE_API_NO_REDIRECT_OPTIONS,
} from './request-state';
import {
  isDesktopLocalProfileRuntime,
  shouldUseProfileApiStorage,
} from './runtime';
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

// 桌面端本地优先写：本地服务 SQLite 是权威且持久的本地存储。
// 瞬时失败只重试，不弹“保存失败”；持久化由本地库负责，无需前端队列。
const LOCAL_WRITE_RETRY_COUNT = 3;
const LOCAL_WRITE_RETRY_DELAY_MS = 250;
const RETRYABLE_LOCAL_WRITE_STATUSES = new Set([
  408, 425, 429, 500, 502, 503, 504,
]);

function isRecoverableLocalWriteError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  const status =
    typeof error === 'object' && error !== null
      ? (error as { status?: unknown }).status
      : undefined;
  if (typeof status === 'number') {
    return RETRYABLE_LOCAL_WRITE_STATUSES.has(status);
  }

  return (
    error instanceof Error &&
    /failed to fetch|load failed|network|err_connection_refused/i.test(
      error.message
    )
  );
}

function delayLocalWriteRetry(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, LOCAL_WRITE_RETRY_DELAY_MS);
  });
}

async function runLocalWriteWithRetry(
  operation: () => Promise<unknown>
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      if (
        attempt + 1 >= LOCAL_WRITE_RETRY_COUNT ||
        !isRecoverableLocalWriteError(error)
      ) {
        throw error;
      }
      await delayLocalWriteRetry();
    }
  }
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
    if (isProfileApiAuthPending()) {
      return null;
    }

    await ensureDesktopLocalProfileStoreHydrated();
    const cachedData = cacheManager.getCachedSkipConfigs();

    if (cachedData) {
      fetchFromApi<Record<string, SkipConfig>>(
        USER_DATA_API_PATHS.skipConfigs,
        PROFILE_API_NO_REDIRECT_OPTIONS
      )
        .then((freshData) => {
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            dispatchSkipConfigsUpdated(freshData);
          }
        })
        .catch((err) => {
          if (wasRedirectedToLogin(err) || isUnauthorizedRequestError(err)) {
            return;
          }

          console.warn('后台同步跳过片头片尾配置失败:', err);
        });

      return cachedData[key] || null;
    }

    try {
      const freshData = await fetchFromApi<Record<string, SkipConfig>>(
        USER_DATA_API_PATHS.skipConfigs,
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
      cacheManager.cacheSkipConfigs(freshData);
      return freshData[key] || null;
    } catch (err) {
      if (wasRedirectedToLogin(err) || isUnauthorizedRequestError(err)) {
        return null;
      }

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

    if (isDesktopLocalProfileRuntime()) {
      try {
        await runLocalWriteWithRetry(() =>
          postRemoteProfilePayload(USER_DATA_API_PATHS.skipConfigs, {
            key,
            config,
          })
        );
      } catch (err) {
        console.warn('保存跳过片头片尾配置失败，未写入本地库:', err);
      }
      return;
    }

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
    if (isProfileApiAuthPending()) {
      return {};
    }

    await ensureDesktopLocalProfileStoreHydrated();
    const cachedData = cacheManager.getCachedSkipConfigs();

    if (cachedData) {
      fetchFromApi<Record<string, SkipConfig>>(
        USER_DATA_API_PATHS.skipConfigs,
        PROFILE_API_NO_REDIRECT_OPTIONS
      )
        .then((freshData) => {
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            dispatchSkipConfigsUpdated(freshData);
          }
        })
        .catch((err) => {
          if (wasRedirectedToLogin(err) || isUnauthorizedRequestError(err)) {
            return;
          }

          console.warn('后台同步跳过片头片尾配置失败:', err);
          triggerGlobalError('后台同步跳过片头片尾配置失败');
        });

      return cachedData;
    }

    try {
      const freshData = await fetchFromApi<Record<string, SkipConfig>>(
        USER_DATA_API_PATHS.skipConfigs,
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
      cacheManager.cacheSkipConfigs(freshData);
      return freshData;
    } catch (err) {
      if (wasRedirectedToLogin(err) || isUnauthorizedRequestError(err)) {
        return {};
      }

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

    if (isDesktopLocalProfileRuntime()) {
      try {
        await runLocalWriteWithRetry(() =>
          deleteRemoteProfileResource(USER_DATA_API_PATHS.skipConfigs, {
            key,
          })
        );
      } catch (err) {
        console.warn('删除跳过片头片尾配置失败，未写入本地库:', err);
      }
      return;
    }

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
