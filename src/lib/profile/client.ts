/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function */
'use client';

/**
 * 仅在浏览器端使用的数据库工具，目前基于 localStorage 实现。
 * 之所以单独拆分文件，是为了避免在客户端 bundle 中引入 `fs`, `path` 等 Node.js 内置模块，
 * 从而解决诸如 "Module not found: Can't resolve 'fs'" 的问题。
 *
 * 功能：
 * 1. 获取全部播放记录（getAllPlayRecords）。
 * 2. 保存播放记录（savePlayRecord）。
 * 3. 数据库存储模式下的混合缓存策略，提升用户体验。
 *
 * 如后续需要在客户端读取收藏等其它数据，可按同样方式在此文件中补充实现。
 */

import {
  dispatchProfileCacheUpdate,
  subscribeToProfileCacheUpdates,
} from './cache';
import {
  type Favorite,
  type PlayRecord,
  type ProfileCacheUpdateEvent,
  PROFILE_USER_DATA_API_PATHS as USER_DATA_API_PATHS,
} from './contracts';
import { cacheManager, getCacheStatus } from './hybrid-cache';
import {
  readLocalFollowRecords,
  writeLocalFollowRecords,
} from './local-adapter';
import {
  deleteRemoteProfileResource,
  fetchRemoteProfileJson as fetchFromApi,
  isUnauthorizedRemoteProfileRequestError as isUnauthorizedRequestError,
  postRemoteProfilePayload,
  wasRemoteProfileRequestRedirectedToLogin as wasRedirectedToLogin,
} from './remote-adapter';
import { shouldUseRemoteProfileStorage } from './runtime';
import { dispatchSearchHistoryUpdated } from './search-history-client';
import { generateStorageKey } from './storage-key';
import { type FollowRecord, SkipConfig } from '../types';

export type { Favorite, PlayRecord } from './contracts';
export {
  clearAllFavorites,
  deleteFavorite,
  getAllFavorites,
  isFavorited,
  saveFavorite,
} from './favorites-client';
export { getCacheStatus } from './hybrid-cache';
export {
  clearAllPlayRecords,
  deletePlayRecord,
  getAllPlayRecords,
  getCachedPlayRecordsSnapshot,
  savePlayRecord,
} from './play-records-client';
export {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
} from './search-history-client';
export {
  deleteSkipConfig,
  getAllSkipConfigs,
  getSkipConfig,
  saveSkipConfig,
} from './skip-config-client';
export { generateStorageKey } from './storage-key';

// 全局错误触发函数
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
  return shouldUseRemoteProfileStorage();
}

function dispatchDataUpdate<T>(
  eventType: ProfileCacheUpdateEvent,
  detail: T
): void {
  dispatchProfileCacheUpdate(eventType, detail);
}

export function getCachedFollowRecordsSnapshot(): Record<
  string,
  FollowRecord
> | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (shouldUseRemoteUserDataStorage()) {
    return cacheManager.getCachedFollowRecords();
  }

  try {
    return readLocalFollowRecords();
  } catch (err) {
    console.error('读取追更记录快照失败:', err);
    return null;
  }
}

// ---- 错误处理辅助函数 ----
/**
 * 数据库操作失败时的通用错误处理
 * 立即从数据库刷新对应类型的缓存以保持数据一致性
 */
async function handleDatabaseOperationFailure(
  dataType: 'followRecords',
  error: any
): Promise<void> {
  if (wasRedirectedToLogin(error) || isUnauthorizedRequestError(error)) {
    return;
  }

  console.error(`数据库操作失败 (${dataType}):`, error);
  triggerGlobalError(`数据库操作失败`);

  try {
    const freshData = await fetchFromApi<Record<string, FollowRecord>>(
      USER_DATA_API_PATHS.follows
    );
    cacheManager.cacheFollowRecords(freshData);
    dispatchDataUpdate('followRecordsUpdated', freshData);
  } catch (refreshErr) {
    if (
      wasRedirectedToLogin(refreshErr) ||
      isUnauthorizedRequestError(refreshErr)
    ) {
      return;
    }

    console.error(`刷新${dataType}缓存失败:`, refreshErr);
    triggerGlobalError(`刷新${dataType}缓存失败`);
  }
}

// 页面加载时清理过期缓存
if (typeof window !== 'undefined') {
  setTimeout(() => cacheManager.clearExpiredCaches(), 1000);
}

/**
 * 读取全部追更记录。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function getAllFollowRecords(): Promise<
  Record<string, FollowRecord>
> {
  if (typeof window === 'undefined') {
    return {};
  }

  if (shouldUseRemoteUserDataStorage()) {
    const cachedData = cacheManager.getCachedFollowRecords();

    if (cachedData) {
      fetchFromApi<Record<string, FollowRecord>>(USER_DATA_API_PATHS.follows)
        .then((freshData) => {
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheFollowRecords(freshData);
            dispatchDataUpdate('followRecordsUpdated', freshData);
          }
        })
        .catch((err) => {
          console.warn('后台同步追更记录失败:', err);
        });

      return cachedData;
    }

    try {
      const freshData = await fetchFromApi<Record<string, FollowRecord>>(
        USER_DATA_API_PATHS.follows
      );
      cacheManager.cacheFollowRecords(freshData);
      return freshData;
    } catch (err) {
      console.error('获取追更记录失败:', err);
      triggerGlobalError('获取追更记录失败');
      return {};
    }
  }

  try {
    return readLocalFollowRecords();
  } catch (err) {
    console.error('读取追更记录失败:', err);
    triggerGlobalError('读取追更记录失败');
    return {};
  }
}

/**
 * 获取单条追更记录。
 */
export async function getFollowRecord(
  source: string,
  id: string
): Promise<FollowRecord | null> {
  const key = generateStorageKey(source, id);
  const allFollowRecords = await getAllFollowRecords();
  return allFollowRecords[key] || null;
}

/**
 * 保存追更记录。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function saveFollowRecord(
  source: string,
  id: string,
  follow: FollowRecord
): Promise<void> {
  const key = generateStorageKey(source, id);

  if (shouldUseRemoteUserDataStorage()) {
    const cachedFollows = cacheManager.getCachedFollowRecords() || {};
    cachedFollows[key] = follow;
    cacheManager.cacheFollowRecords(cachedFollows);

    dispatchDataUpdate('followRecordsUpdated', cachedFollows);

    try {
      await postRemoteProfilePayload(USER_DATA_API_PATHS.follows, {
        key,
        follow,
      });
    } catch (err) {
      await handleDatabaseOperationFailure('followRecords', err);
      triggerGlobalError('保存追更记录失败');
      throw err;
    }
    return;
  }

  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存追更记录到 localStorage');
    return;
  }

  try {
    const allFollows = await getAllFollowRecords();
    allFollows[key] = follow;
    writeLocalFollowRecords(allFollows);
    dispatchDataUpdate('followRecordsUpdated', allFollows);
  } catch (err) {
    console.error('保存追更记录失败:', err);
    triggerGlobalError('保存追更记录失败');
    throw err;
  }
}

/**
 * 删除追更记录。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function deleteFollowRecord(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  if (shouldUseRemoteUserDataStorage()) {
    const cachedFollows = cacheManager.getCachedFollowRecords() || {};
    delete cachedFollows[key];
    cacheManager.cacheFollowRecords(cachedFollows);

    dispatchDataUpdate('followRecordsUpdated', cachedFollows);

    try {
      await deleteRemoteProfileResource(USER_DATA_API_PATHS.follows, {
        key,
      });
    } catch (err) {
      await handleDatabaseOperationFailure('followRecords', err);
      triggerGlobalError('删除追更记录失败');
      throw err;
    }
    return;
  }

  if (typeof window === 'undefined') {
    console.warn('无法在服务端删除追更记录到 localStorage');
    return;
  }

  try {
    const allFollows = await getAllFollowRecords();
    delete allFollows[key];
    writeLocalFollowRecords(allFollows);
    dispatchDataUpdate('followRecordsUpdated', allFollows);
  } catch (err) {
    console.error('删除追更记录失败:', err);
    triggerGlobalError('删除追更记录失败');
    throw err;
  }
}

// ---------------- 混合缓存辅助函数 ----------------

/**
 * 清除当前用户的所有缓存数据
 * 用于用户登出时清理缓存
 */
export function clearUserCache(): void {
  if (shouldUseRemoteUserDataStorage()) {
    cacheManager.clearUserCache();
  }
}

/**
 * 手动刷新所有缓存数据
 * 强制从服务器重新获取数据并更新缓存
 */
export async function refreshAllCache(): Promise<void> {
  if (!shouldUseRemoteUserDataStorage()) return;

  try {
    // 并行刷新所有数据
    const [playRecords, favorites, followRecords, searchHistory, skipConfigs] =
      await Promise.allSettled([
        fetchFromApi<Record<string, PlayRecord>>(
          USER_DATA_API_PATHS.playRecords
        ),
        fetchFromApi<Record<string, Favorite>>(USER_DATA_API_PATHS.favorites),
        fetchFromApi<Record<string, FollowRecord>>(USER_DATA_API_PATHS.follows),
        fetchFromApi<string[]>(USER_DATA_API_PATHS.searchHistory),
        fetchFromApi<Record<string, SkipConfig>>(
          USER_DATA_API_PATHS.skipConfigs
        ),
      ]);

    if (playRecords.status === 'fulfilled') {
      cacheManager.cachePlayRecords(playRecords.value);
      dispatchDataUpdate('playRecordsUpdated', playRecords.value);
    }

    if (favorites.status === 'fulfilled') {
      cacheManager.cacheFavorites(favorites.value);
      dispatchDataUpdate('favoritesUpdated', favorites.value);
    }

    if (followRecords.status === 'fulfilled') {
      cacheManager.cacheFollowRecords(followRecords.value);
      dispatchDataUpdate('followRecordsUpdated', followRecords.value);
    }

    if (searchHistory.status === 'fulfilled') {
      cacheManager.cacheSearchHistory(searchHistory.value);
      dispatchSearchHistoryUpdated(searchHistory.value);
    }

    if (skipConfigs.status === 'fulfilled') {
      cacheManager.cacheSkipConfigs(skipConfigs.value);
      dispatchDataUpdate('skipConfigsUpdated', skipConfigs.value);
    }
  } catch (err) {
    console.error('刷新缓存失败:', err);
    triggerGlobalError('刷新缓存失败');
  }
}

/**
 * 获取缓存状态信息
 * 用于调试和监控缓存健康状态
 */
// ---------------- React Hook 辅助类型 ----------------

export type CacheUpdateEvent = ProfileCacheUpdateEvent;

/**
 * 用于 React 组件监听数据更新的事件监听器
 * 使用方法：
 *
 * useEffect(() => {
 *   const unsubscribe = subscribeToDataUpdates('playRecordsUpdated', (data) => {
 *     setPlayRecords(data);
 *   });
 *   return unsubscribe;
 * }, []);
 */
export function subscribeToDataUpdates<T>(
  eventType: CacheUpdateEvent,
  callback: (data: T) => void
): () => void {
  return subscribeToProfileCacheUpdates(eventType, callback);
}

/**
 * 预加载所有用户数据到缓存
 * 适合在应用启动时调用，提升后续访问速度
 */
export async function preloadUserData(): Promise<void> {
  if (!shouldUseRemoteUserDataStorage()) return;

  // 检查是否已有有效缓存，避免重复请求
  const status = getCacheStatus();
  if (
    status.hasPlayRecords &&
    status.hasFavorites &&
    status.hasFollowRecords &&
    status.hasSearchHistory &&
    status.hasSkipConfigs
  ) {
    return;
  }

  // 后台静默预加载，不阻塞界面
  refreshAllCache().catch((err) => {
    console.warn('预加载用户数据失败:', err);
    triggerGlobalError('预加载用户数据失败');
  });
}
