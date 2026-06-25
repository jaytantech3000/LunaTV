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
  clearLocalFavorites,
  clearLocalPlayRecords,
  readLocalFavorites,
  readLocalFollowRecords,
  readLocalPlayRecords,
  writeLocalFavorites,
  writeLocalFollowRecords,
  writeLocalPlayRecords,
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
import { decodeSearchHistoryValues } from '../search-history';
import { type FollowRecord, SkipConfig } from '../types';

export type { Favorite, PlayRecord } from './contracts';
export { getCacheStatus } from './hybrid-cache';
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

export function getCachedPlayRecordsSnapshot(): Record<
  string,
  PlayRecord
> | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (shouldUseRemoteUserDataStorage()) {
    return cacheManager.getCachedPlayRecords();
  }

  try {
    return readLocalPlayRecords();
  } catch (err) {
    console.error('读取播放记录快照失败:', err);
    return null;
  }
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
  dataType: 'playRecords' | 'favorites' | 'followRecords' | 'searchHistory',
  error: any
): Promise<void> {
  if (wasRedirectedToLogin(error) || isUnauthorizedRequestError(error)) {
    return;
  }

  console.error(`数据库操作失败 (${dataType}):`, error);
  triggerGlobalError(`数据库操作失败`);

  try {
    let freshData: any;
    let eventType: ProfileCacheUpdateEvent;
    let eventDetail: any;

    switch (dataType) {
      case 'playRecords':
        freshData = await fetchFromApi<Record<string, PlayRecord>>(
          USER_DATA_API_PATHS.playRecords
        );
        cacheManager.cachePlayRecords(freshData);
        eventType = 'playRecordsUpdated';
        eventDetail = freshData;
        break;
      case 'favorites':
        freshData = await fetchFromApi<Record<string, Favorite>>(
          USER_DATA_API_PATHS.favorites
        );
        cacheManager.cacheFavorites(freshData);
        eventType = 'favoritesUpdated';
        eventDetail = freshData;
        break;
      case 'followRecords':
        freshData = await fetchFromApi<Record<string, FollowRecord>>(
          USER_DATA_API_PATHS.follows
        );
        cacheManager.cacheFollowRecords(freshData);
        eventType = 'followRecordsUpdated';
        eventDetail = freshData;
        break;
      case 'searchHistory':
        freshData = await fetchFromApi<string[]>(
          USER_DATA_API_PATHS.searchHistory
        );
        cacheManager.cacheSearchHistory(freshData);
        eventType = 'searchHistoryUpdated';
        eventDetail = decodeSearchHistoryValues(freshData);
        break;
    }

    // 触发更新事件通知组件
    dispatchDataUpdate(eventType, eventDetail);
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

// ---- API ----
/**
 * 读取全部播放记录。
 * 非本地存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 * 在服务端渲染阶段 (window === undefined) 时返回空对象，避免报错。
 */
export async function getAllPlayRecords(): Promise<Record<string, PlayRecord>> {
  // 服务器端渲染阶段直接返回空，交由客户端 useEffect 再行请求
  if (typeof window === 'undefined') {
    return {};
  }

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedPlayRecords();

    if (cachedData) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<Record<string, PlayRecord>>(USER_DATA_API_PATHS.playRecords)
        .then((freshData) => {
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cachePlayRecords(freshData);
            // 触发数据更新事件，供组件监听
            dispatchDataUpdate('playRecordsUpdated', freshData);
          }
        })
        .catch((err) => {
          console.warn('后台同步播放记录失败:', err);
          triggerGlobalError('后台同步播放记录失败');
        });

      return cachedData;
    } else {
      // 缓存为空，直接从 API 获取并缓存
      try {
        const freshData = await fetchFromApi<Record<string, PlayRecord>>(
          USER_DATA_API_PATHS.playRecords
        );
        cacheManager.cachePlayRecords(freshData);
        return freshData;
      } catch (err) {
        console.error('获取播放记录失败:', err);
        triggerGlobalError('获取播放记录失败');
        return {};
      }
    }
  }

  // localstorage 模式
  try {
    return readLocalPlayRecords();
  } catch (err) {
    console.error('读取播放记录失败:', err);
    triggerGlobalError('读取播放记录失败');
    return {};
  }
}

/**
 * 保存播放记录。
 * 数据库存储模式下使用乐观更新：先更新缓存（立即生效），再异步同步到数据库。
 */
export async function savePlayRecord(
  source: string,
  id: string,
  record: PlayRecord
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 立即更新缓存
    const cachedRecords = cacheManager.getCachedPlayRecords() || {};
    cachedRecords[key] = record;
    cacheManager.cachePlayRecords(cachedRecords);

    // 触发立即更新事件
    dispatchDataUpdate('playRecordsUpdated', cachedRecords);

    // 异步同步到数据库
    try {
      await postRemoteProfilePayload(USER_DATA_API_PATHS.playRecords, {
        key,
        record,
      });
    } catch (err) {
      await handleDatabaseOperationFailure('playRecords', err);
      triggerGlobalError('保存播放记录失败');
      throw err;
    }
    return;
  }

  // localstorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存播放记录到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllPlayRecords();
    allRecords[key] = record;
    writeLocalPlayRecords(allRecords);
    dispatchDataUpdate('playRecordsUpdated', allRecords);
  } catch (err) {
    console.error('保存播放记录失败:', err);
    triggerGlobalError('保存播放记录失败');
    throw err;
  }
}

/**
 * 删除播放记录。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function deletePlayRecord(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 立即更新缓存
    const cachedRecords = cacheManager.getCachedPlayRecords() || {};
    delete cachedRecords[key];
    cacheManager.cachePlayRecords(cachedRecords);

    // 触发立即更新事件
    dispatchDataUpdate('playRecordsUpdated', cachedRecords);

    // 异步同步到数据库
    try {
      await deleteRemoteProfileResource(USER_DATA_API_PATHS.playRecords, {
        key,
      });
    } catch (err) {
      await handleDatabaseOperationFailure('playRecords', err);
      triggerGlobalError('删除播放记录失败');
      throw err;
    }
    return;
  }

  // localstorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端删除播放记录到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllPlayRecords();
    delete allRecords[key];
    writeLocalPlayRecords(allRecords);
    dispatchDataUpdate('playRecordsUpdated', allRecords);
  } catch (err) {
    console.error('删除播放记录失败:', err);
    triggerGlobalError('删除播放记录失败');
    throw err;
  }
}

// ---------------- 收藏相关 API ----------------

/**
 * 获取全部收藏。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function getAllFavorites(): Promise<Record<string, Favorite>> {
  // 服务器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return {};
  }

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedFavorites();

    if (cachedData) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<Record<string, Favorite>>(USER_DATA_API_PATHS.favorites)
        .then((freshData) => {
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheFavorites(freshData);
            // 触发数据更新事件
            dispatchDataUpdate('favoritesUpdated', freshData);
          }
        })
        .catch((err) => {
          console.warn('后台同步收藏失败:', err);
          triggerGlobalError('后台同步收藏失败');
        });

      return cachedData;
    } else {
      // 缓存为空，直接从 API 获取并缓存
      try {
        const freshData = await fetchFromApi<Record<string, Favorite>>(
          USER_DATA_API_PATHS.favorites
        );
        cacheManager.cacheFavorites(freshData);
        return freshData;
      } catch (err) {
        console.error('获取收藏失败:', err);
        triggerGlobalError('获取收藏失败');
        return {};
      }
    }
  }

  // localStorage 模式
  try {
    return readLocalFavorites();
  } catch (err) {
    console.error('读取收藏失败:', err);
    triggerGlobalError('读取收藏失败');
    return {};
  }
}

/**
 * 保存收藏。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function saveFavorite(
  source: string,
  id: string,
  favorite: Favorite
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 立即更新缓存
    const cachedFavorites = cacheManager.getCachedFavorites() || {};
    cachedFavorites[key] = favorite;
    cacheManager.cacheFavorites(cachedFavorites);

    // 触发立即更新事件
    dispatchDataUpdate('favoritesUpdated', cachedFavorites);

    // 异步同步到数据库
    try {
      await postRemoteProfilePayload(USER_DATA_API_PATHS.favorites, {
        key,
        favorite,
      });
    } catch (err) {
      await handleDatabaseOperationFailure('favorites', err);
      triggerGlobalError('保存收藏失败');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存收藏到 localStorage');
    return;
  }

  try {
    const allFavorites = await getAllFavorites();
    allFavorites[key] = favorite;
    writeLocalFavorites(allFavorites);
    dispatchDataUpdate('favoritesUpdated', allFavorites);
  } catch (err) {
    console.error('保存收藏失败:', err);
    triggerGlobalError('保存收藏失败');
    throw err;
  }
}

/**
 * 删除收藏。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function deleteFavorite(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 立即更新缓存
    const cachedFavorites = cacheManager.getCachedFavorites() || {};
    delete cachedFavorites[key];
    cacheManager.cacheFavorites(cachedFavorites);

    // 触发立即更新事件
    dispatchDataUpdate('favoritesUpdated', cachedFavorites);

    // 异步同步到数据库
    try {
      await deleteRemoteProfileResource(USER_DATA_API_PATHS.favorites, {
        key,
      });
    } catch (err) {
      await handleDatabaseOperationFailure('favorites', err);
      triggerGlobalError('删除收藏失败');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端删除收藏到 localStorage');
    return;
  }

  try {
    const allFavorites = await getAllFavorites();
    delete allFavorites[key];
    writeLocalFavorites(allFavorites);
    dispatchDataUpdate('favoritesUpdated', allFavorites);
  } catch (err) {
    console.error('删除收藏失败:', err);
    triggerGlobalError('删除收藏失败');
    throw err;
  }
}

/**
 * 判断是否已收藏。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function isFavorited(
  source: string,
  id: string
): Promise<boolean> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    const cachedFavorites = cacheManager.getCachedFavorites();

    if (cachedFavorites) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<Record<string, Favorite>>(USER_DATA_API_PATHS.favorites)
        .then((freshData) => {
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedFavorites) !== JSON.stringify(freshData)) {
            cacheManager.cacheFavorites(freshData);
            // 触发数据更新事件
            dispatchDataUpdate('favoritesUpdated', freshData);
          }
        })
        .catch((err) => {
          console.warn('后台同步收藏失败:', err);
          triggerGlobalError('后台同步收藏失败');
        });

      return !!cachedFavorites[key];
    } else {
      // 缓存为空，直接从 API 获取并缓存
      try {
        const freshData = await fetchFromApi<Record<string, Favorite>>(
          USER_DATA_API_PATHS.favorites
        );
        cacheManager.cacheFavorites(freshData);
        return !!freshData[key];
      } catch (err) {
        console.error('检查收藏状态失败:', err);
        triggerGlobalError('检查收藏状态失败');
        return false;
      }
    }
  }

  // localStorage 模式
  const allFavorites = await getAllFavorites();
  return !!allFavorites[key];
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

/**
 * 清空全部播放记录
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function clearAllPlayRecords(): Promise<void> {
  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 立即更新缓存
    cacheManager.cachePlayRecords({});

    // 触发立即更新事件
    dispatchDataUpdate('playRecordsUpdated', {});

    // 异步同步到数据库
    try {
      await deleteRemoteProfileResource(USER_DATA_API_PATHS.playRecords);
    } catch (err) {
      await handleDatabaseOperationFailure('playRecords', err);
      triggerGlobalError('清空播放记录失败');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  clearLocalPlayRecords();
  dispatchDataUpdate('playRecordsUpdated', {});
}

/**
 * 清空全部收藏
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function clearAllFavorites(): Promise<void> {
  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 立即更新缓存
    cacheManager.cacheFavorites({});

    // 触发立即更新事件
    dispatchDataUpdate('favoritesUpdated', {});

    // 异步同步到数据库
    try {
      await deleteRemoteProfileResource(USER_DATA_API_PATHS.favorites);
    } catch (err) {
      await handleDatabaseOperationFailure('favorites', err);
      triggerGlobalError('清空收藏失败');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  clearLocalFavorites();
  dispatchDataUpdate('favoritesUpdated', {});
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
