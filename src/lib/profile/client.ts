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
import { fetchRemoteProfileJson as fetchFromApi } from './remote-adapter';
import { shouldUseRemoteProfileStorage } from './runtime';
import { dispatchSearchHistoryUpdated } from './search-history-client';
import { type FollowRecord, SkipConfig } from '../types';

export type { Favorite, PlayRecord } from './contracts';
export {
  clearAllFavorites,
  deleteFavorite,
  getAllFavorites,
  isFavorited,
  saveFavorite,
} from './favorites-client';
export {
  deleteFollowRecord,
  getAllFollowRecords,
  getCachedFollowRecordsSnapshot,
  getFollowRecord,
  saveFollowRecord,
} from './follow-records-client';
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

// 页面加载时清理过期缓存
if (typeof window !== 'undefined') {
  setTimeout(() => cacheManager.clearExpiredCaches(), 1000);
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
