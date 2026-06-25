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

import { getAuthInfoFromBrowserCookie } from './auth';
import {
  dispatchProfileCacheUpdate,
  dispatchProfileSearchHistoryUpdated,
  subscribeToProfileCacheUpdates,
} from './profile/cache';
import {
  type ProfileCacheUpdateEvent,
  PROFILE_USER_DATA_API_PATHS as USER_DATA_API_PATHS,
} from './profile/contracts';
import {
  clearLocalFavorites,
  clearLocalPlayRecords,
  clearLocalSearchHistoryValues,
  LOCAL_SEARCH_HISTORY_LIMIT,
  readLocalFavorites,
  readLocalFollowRecords,
  readLocalPlayRecords,
  readLocalSearchHistoryValues,
  readLocalSkipConfigs,
  writeLocalFavorites,
  writeLocalFollowRecords,
  writeLocalPlayRecords,
  writeLocalSearchHistoryValues,
  writeLocalSkipConfigs,
} from './profile/local-adapter';
import {
  deleteRemoteProfileResource,
  postRemoteProfilePayload,
} from './profile/remote-adapter';
import { shouldUseRemoteProfileStorage } from './profile/runtime';
import {
  type ProfileRequestInit,
  fetchProfileResponse,
  isUnauthorizedProfileRequestError,
  wasProfileRequestRedirectedToLogin,
} from './profile/session';
import {
  type SearchHistoryEntry,
  type SearchHistoryMode,
  decodeSearchHistoryValue,
  decodeSearchHistoryValues,
  encodeSearchHistoryValue,
  resolveSearchHistoryRawValue,
} from './search-history';
import { type FollowRecord, SkipConfig } from './types';

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

// ---- 类型 ----
export interface PlayRecord {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  index: number; // 第几集
  total_episodes: number; // 总集数
  play_time: number; // 播放进度（秒）
  total_time: number; // 总进度（秒）
  save_time: number; // 记录保存时间（时间戳）
  search_title?: string; // 搜索时使用的标题
  playback_mode?: 'online' | 'offline';
  offline_content_id?: string;
  is_adult?: boolean;
}

// ---- 收藏类型 ----
export interface Favorite {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  total_episodes: number;
  save_time: number;
  search_title?: string;
  playback_mode?: 'online' | 'offline';
  offline_content_id?: string;
  is_adult?: boolean;
  origin?: 'vod' | 'live';
}

// ---- 缓存数据结构 ----
interface CacheData<T> {
  data: T;
  timestamp: number;
  version: string;
}

interface UserCacheStore {
  playRecords?: CacheData<Record<string, PlayRecord>>;
  favorites?: CacheData<Record<string, Favorite>>;
  followRecords?: CacheData<Record<string, FollowRecord>>;
  searchHistory?: CacheData<string[]>;
  skipConfigs?: CacheData<Record<string, SkipConfig>>;
}

// 缓存相关常量
const CACHE_PREFIX = 'moontv_cache_';
const CACHE_VERSION = '1.0.0';
const CACHE_EXPIRE_TIME = 60 * 60 * 1000; // 一小时缓存过期
function shouldUseRemoteUserDataStorage(): boolean {
  return shouldUseRemoteProfileStorage();
}

// ---- 缓存管理器 ----
class HybridCacheManager {
  private static instance: HybridCacheManager;

  static getInstance(): HybridCacheManager {
    if (!HybridCacheManager.instance) {
      HybridCacheManager.instance = new HybridCacheManager();
    }
    return HybridCacheManager.instance;
  }

  /**
   * 获取当前用户名
   */
  private getCurrentUsername(): string | null {
    const authInfo = getAuthInfoFromBrowserCookie();
    return authInfo?.username || null;
  }

  /**
   * 生成用户专属的缓存key
   */
  private getUserCacheKey(username: string): string {
    return `${CACHE_PREFIX}${username}`;
  }

  /**
   * 获取用户缓存数据
   */
  private getUserCache(username: string): UserCacheStore {
    if (typeof window === 'undefined') return {};

    try {
      const cacheKey = this.getUserCacheKey(username);
      const cached = localStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : {};
    } catch (error) {
      console.warn('获取用户缓存失败:', error);
      return {};
    }
  }

  /**
   * 保存用户缓存数据
   */
  private saveUserCache(username: string, cache: UserCacheStore): void {
    if (typeof window === 'undefined') return;

    try {
      // 检查缓存大小，超过15MB时清理旧数据
      const cacheSize = JSON.stringify(cache).length;
      if (cacheSize > 15 * 1024 * 1024) {
        console.warn('缓存过大，清理旧数据');
        this.cleanOldCache(cache);
      }

      const cacheKey = this.getUserCacheKey(username);
      localStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch (error) {
      console.warn('保存用户缓存失败:', error);
      // 存储空间不足时清理缓存后重试
      if (
        error instanceof DOMException &&
        error.name === 'QuotaExceededError'
      ) {
        this.clearAllCache();
        try {
          const cacheKey = this.getUserCacheKey(username);
          localStorage.setItem(cacheKey, JSON.stringify(cache));
        } catch (retryError) {
          console.error('重试保存缓存仍然失败:', retryError);
        }
      }
    }
  }

  /**
   * 清理过期缓存数据
   */
  private cleanOldCache(cache: UserCacheStore): void {
    const now = Date.now();
    const maxAge = 60 * 24 * 60 * 60 * 1000; // 两个月

    // 清理过期的播放记录缓存
    if (cache.playRecords && now - cache.playRecords.timestamp > maxAge) {
      delete cache.playRecords;
    }

    // 清理过期的收藏缓存
    if (cache.favorites && now - cache.favorites.timestamp > maxAge) {
      delete cache.favorites;
    }

    // 清理过期的追更缓存
    if (cache.followRecords && now - cache.followRecords.timestamp > maxAge) {
      delete cache.followRecords;
    }
  }

  /**
   * 清理所有缓存
   */
  private clearAllCache(): void {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith('moontv_cache_')) {
        localStorage.removeItem(key);
      }
    });
  }

  /**
   * 检查缓存是否有效
   */
  private isCacheValid<T>(cache: CacheData<T>): boolean {
    const now = Date.now();
    return (
      cache.version === CACHE_VERSION &&
      now - cache.timestamp < CACHE_EXPIRE_TIME
    );
  }

  /**
   * 创建缓存数据
   */
  private createCacheData<T>(data: T): CacheData<T> {
    return {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };
  }

  /**
   * 获取缓存的播放记录
   */
  getCachedPlayRecords(): Record<string, PlayRecord> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.playRecords;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 缓存播放记录
   */
  cachePlayRecords(data: Record<string, PlayRecord>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.playRecords = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 获取缓存的收藏
   */
  getCachedFavorites(): Record<string, Favorite> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.favorites;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 缓存收藏
   */
  cacheFavorites(data: Record<string, Favorite>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.favorites = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 获取缓存的追更记录
   */
  getCachedFollowRecords(): Record<string, FollowRecord> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.followRecords;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 缓存追更记录
   */
  cacheFollowRecords(data: Record<string, FollowRecord>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.followRecords = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 获取缓存的搜索历史
   */
  getCachedSearchHistory(): string[] | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.searchHistory;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 缓存搜索历史
   */
  cacheSearchHistory(data: string[]): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.searchHistory = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 获取缓存的跳过片头片尾配置
   */
  getCachedSkipConfigs(): Record<string, SkipConfig> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.skipConfigs;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 缓存跳过片头片尾配置
   */
  cacheSkipConfigs(data: Record<string, SkipConfig>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.skipConfigs = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 清除指定用户的所有缓存
   */
  clearUserCache(username?: string): void {
    const targetUsername = username || this.getCurrentUsername();
    if (!targetUsername) return;

    try {
      const cacheKey = this.getUserCacheKey(targetUsername);
      localStorage.removeItem(cacheKey);
    } catch (error) {
      console.warn('清除用户缓存失败:', error);
    }
  }

  /**
   * 清除所有过期缓存
   */
  clearExpiredCaches(): void {
    if (typeof window === 'undefined') return;

    try {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(CACHE_PREFIX)) {
          try {
            const cache = JSON.parse(localStorage.getItem(key) || '{}');
            // 检查是否有任何缓存数据过期
            let hasValidData = false;
            for (const [, cacheData] of Object.entries(cache)) {
              if (cacheData && this.isCacheValid(cacheData as CacheData<any>)) {
                hasValidData = true;
                break;
              }
            }
            if (!hasValidData) {
              keysToRemove.push(key);
            }
          } catch {
            // 解析失败的缓存也删除
            keysToRemove.push(key);
          }
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn('清除过期缓存失败:', error);
    }
  }
}

// 获取缓存管理器实例
const cacheManager = HybridCacheManager.getInstance();

function dispatchDataUpdate<T>(
  eventType: ProfileCacheUpdateEvent,
  detail: T
): void {
  dispatchProfileCacheUpdate(eventType, detail);
}

function dispatchSearchHistoryUpdated(rawHistory: string[]): void {
  dispatchProfileSearchHistoryUpdated(rawHistory);
}

function shouldReplaceSearchHistoryValue(
  rawHistoryValue: string,
  keyword: string,
  mode?: SearchHistoryMode
): boolean {
  const entry = decodeSearchHistoryValue(rawHistoryValue);

  if (!entry || entry.keyword !== keyword) {
    return false;
  }

  if (!mode) {
    return !entry.mode;
  }

  return !entry.mode || entry.mode === mode;
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

function isUnauthorizedRequestError(error: unknown): boolean {
  return isUnauthorizedProfileRequestError(error);
}

function wasRedirectedToLogin(error: unknown): boolean {
  return wasProfileRequestRedirectedToLogin(error);
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

async function refreshSearchHistorySilently(): Promise<void> {
  try {
    const freshData = await fetchFromApi<string[]>(
      USER_DATA_API_PATHS.searchHistory,
      {
        redirectOnUnauthorized: false,
      }
    );
    cacheManager.cacheSearchHistory(freshData);
    dispatchSearchHistoryUpdated(freshData);
  } catch (error) {
    if (wasRedirectedToLogin(error) || isUnauthorizedRequestError(error)) {
      return;
    }

    console.warn('刷新搜索历史缓存失败:', error);
  }
}

async function handleSearchHistoryOperationFailure(
  operation: string,
  error: unknown
): Promise<void> {
  if (wasRedirectedToLogin(error) || isUnauthorizedRequestError(error)) {
    return;
  }

  console.warn(`搜索历史${operation}失败:`, error);
  await refreshSearchHistorySilently();
}

// 页面加载时清理过期缓存
if (typeof window !== 'undefined') {
  setTimeout(() => cacheManager.clearExpiredCaches(), 1000);
}

// ---- 工具函数 ----
/**
 * 通用的 fetch 函数，处理 401 状态码自动跳转登录
 */
async function fetchWithAuth(
  url: string,
  options?: ProfileRequestInit
): Promise<Response> {
  return fetchProfileResponse(url, options);

  /*
  if (!res.ok) {
    // 如果是 401 未授权，跳转到登录页面
    if (res.status === 401) {
      if (!redirectOnUnauthorized) {
        throw new DatabaseRequestError(
          `请求 ${requestUrl} 失败: ${res.status}`,
          {
            status: res.status,
          }
        );
      }

      // 调用 logout 接口
      try {
        await purgeOfflineDownloads();
        await fetch(buildApiUrl(USER_DATA_API_PATHS.logout), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('注销请求失败:', error);
      }
      const currentUrl = window.location.pathname + window.location.search;
      const loginUrl = new URL('/login', window.location.origin);
      loginUrl.searchParams.set('redirect', currentUrl);
      window.location.href = loginUrl.toString();
      throw new DatabaseRequestError('用户未授权，已跳转到登录页面', {
        status: res.status,
        redirectedToLogin: true,
      });
    }

    throw new DatabaseRequestError(`请求 ${requestUrl} 失败: ${res.status}`, {
      status: res.status,
    });
  }
  return res;
  */
}

async function fetchFromApi<T>(
  path: string,
  options?: ProfileRequestInit
): Promise<T> {
  const response = await fetchWithAuth(path, options);
  return (await response.json()) as T;
}

/**
 * 生成存储key
 */
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
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

/* ---------------- 搜索历史相关 API ---------------- */

/**
 * 获取搜索历史。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function getSearchHistory(): Promise<SearchHistoryEntry[]> {
  // 服务器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return [];
  }

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedSearchHistory();

    if (cachedData) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<string[]>(USER_DATA_API_PATHS.searchHistory, {
        redirectOnUnauthorized: false,
      })
        .then((freshData) => {
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSearchHistory(freshData);
            dispatchSearchHistoryUpdated(freshData);
          }
        })
        .catch((err) => {
          if (wasRedirectedToLogin(err) || isUnauthorizedRequestError(err)) {
            return;
          }

          console.warn('后台同步搜索历史失败:', err);
        });

      return decodeSearchHistoryValues(cachedData);
    } else {
      // 缓存为空，直接从 API 获取并缓存
      try {
        const freshData = await fetchFromApi<string[]>(
          USER_DATA_API_PATHS.searchHistory,
          {
            redirectOnUnauthorized: false,
          }
        );
        cacheManager.cacheSearchHistory(freshData);
        return decodeSearchHistoryValues(freshData);
      } catch (err) {
        console.error('获取搜索历史失败:', err);
        return [];
      }
    }
  }

  // localStorage 模式
  try {
    return decodeSearchHistoryValues(readLocalSearchHistoryValues());
  } catch (err) {
    console.error('读取搜索历史失败:', err);
    triggerGlobalError('读取搜索历史失败');
    return [];
  }
}

/**
 * 将关键字添加到搜索历史。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function addSearchHistory(
  keyword: string,
  mode?: SearchHistoryMode
): Promise<void> {
  const trimmed = keyword.trim();
  const encodedKeyword = encodeSearchHistoryValue(trimmed, mode);

  if (!encodedKeyword) return;

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 立即更新缓存
    const cachedHistory = cacheManager.getCachedSearchHistory() || [];
    const newHistory = [
      encodedKeyword,
      ...cachedHistory.filter(
        (value) => !shouldReplaceSearchHistoryValue(value, trimmed, mode)
      ),
    ];
    // 限制长度
    if (newHistory.length > LOCAL_SEARCH_HISTORY_LIMIT) {
      newHistory.length = LOCAL_SEARCH_HISTORY_LIMIT;
    }
    cacheManager.cacheSearchHistory(newHistory);

    // 触发立即更新事件
    dispatchSearchHistoryUpdated(newHistory);

    // 异步同步到数据库
    try {
      await postRemoteProfilePayload(
        USER_DATA_API_PATHS.searchHistory,
        {
          keyword: encodedKeyword,
        },
        {
          redirectOnUnauthorized: false,
        }
      );
    } catch (err) {
      await handleSearchHistoryOperationFailure('保存', err);
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;

  try {
    const history = readLocalSearchHistoryValues();
    const newHistory = [
      encodedKeyword,
      ...history.filter(
        (value) => !shouldReplaceSearchHistoryValue(value, trimmed, mode)
      ),
    ];
    // 限制长度
    if (newHistory.length > LOCAL_SEARCH_HISTORY_LIMIT) {
      newHistory.length = LOCAL_SEARCH_HISTORY_LIMIT;
    }
    writeLocalSearchHistoryValues(newHistory);
    dispatchSearchHistoryUpdated(newHistory);
  } catch (err) {
    console.error('保存搜索历史失败:', err);
    triggerGlobalError('保存搜索历史失败');
  }
}

/**
 * 清空搜索历史。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function clearSearchHistory(): Promise<void> {
  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 立即更新缓存
    cacheManager.cacheSearchHistory([]);

    // 触发立即更新事件
    dispatchSearchHistoryUpdated([]);

    // 异步同步到数据库
    try {
      await deleteRemoteProfileResource(
        USER_DATA_API_PATHS.searchHistory,
        undefined,
        {
          redirectOnUnauthorized: false,
        }
      );
    } catch (err) {
      await handleSearchHistoryOperationFailure('清空', err);
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  clearLocalSearchHistoryValues();
  dispatchSearchHistoryUpdated([]);
}

/**
 * 删除单条搜索历史。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function deleteSearchHistory(
  entry: SearchHistoryEntry | string
): Promise<void> {
  const rawValue = resolveSearchHistoryRawValue(entry);
  const trimmedKeyword =
    typeof entry === 'string' ? entry.trim() : entry.keyword.trim();

  if (!rawValue || !trimmedKeyword) return;

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 立即更新缓存
    const cachedHistory = cacheManager.getCachedSearchHistory() || [];
    const newHistory = cachedHistory.filter((value) =>
      typeof entry === 'string'
        ? !shouldReplaceSearchHistoryValue(value, trimmedKeyword)
        : value !== rawValue
    );
    cacheManager.cacheSearchHistory(newHistory);

    // 触发立即更新事件
    dispatchSearchHistoryUpdated(newHistory);

    // 异步同步到数据库
    try {
      await deleteRemoteProfileResource(
        USER_DATA_API_PATHS.searchHistory,
        {
          keyword: rawValue,
        },
        {
          redirectOnUnauthorized: false,
        }
      );
    } catch (err) {
      await handleSearchHistoryOperationFailure('删除', err);
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;

  try {
    const history = readLocalSearchHistoryValues();
    const newHistory = history.filter((value) =>
      typeof entry === 'string'
        ? !shouldReplaceSearchHistoryValue(value, trimmedKeyword)
        : value !== rawValue
    );
    writeLocalSearchHistoryValues(newHistory);
    dispatchSearchHistoryUpdated(newHistory);
  } catch (err) {
    console.error('删除搜索历史失败:', err);
    triggerGlobalError('删除搜索历史失败');
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
export function getCacheStatus(): {
  hasPlayRecords: boolean;
  hasFavorites: boolean;
  hasFollowRecords: boolean;
  hasSearchHistory: boolean;
  hasSkipConfigs: boolean;
  username: string | null;
} {
  if (!shouldUseRemoteUserDataStorage()) {
    return {
      hasPlayRecords: false,
      hasFavorites: false,
      hasFollowRecords: false,
      hasSearchHistory: false,
      hasSkipConfigs: false,
      username: null,
    };
  }

  const authInfo = getAuthInfoFromBrowserCookie();
  return {
    hasPlayRecords: !!cacheManager.getCachedPlayRecords(),
    hasFavorites: !!cacheManager.getCachedFavorites(),
    hasFollowRecords: !!cacheManager.getCachedFollowRecords(),
    hasSearchHistory: !!cacheManager.getCachedSearchHistory(),
    hasSkipConfigs: !!cacheManager.getCachedSkipConfigs(),
    username: authInfo?.username || null,
  };
}

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

// ---------------- 跳过片头片尾配置相关 API ----------------

/**
 * 获取跳过片头片尾配置。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function getSkipConfig(
  source: string,
  id: string
): Promise<SkipConfig | null> {
  // 服务器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return null;
  }

  const key = generateStorageKey(source, id);

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedSkipConfigs();

    if (cachedData) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<Record<string, SkipConfig>>(USER_DATA_API_PATHS.skipConfigs)
        .then((freshData) => {
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            // 触发数据更新事件
            dispatchDataUpdate('skipConfigsUpdated', freshData);
          }
        })
        .catch((err) => {
          console.warn('后台同步跳过片头片尾配置失败:', err);
        });

      return cachedData[key] || null;
    } else {
      // 缓存为空，直接从 API 获取并缓存
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
  }

  // localStorage 模式
  try {
    const configs = readLocalSkipConfigs();
    return configs[key] || null;
  } catch (err) {
    console.error('读取跳过片头片尾配置失败:', err);
    triggerGlobalError('读取跳过片头片尾配置失败');
    return null;
  }
}

/**
 * 保存跳过片头片尾配置。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function saveSkipConfig(
  source: string,
  id: string,
  config: SkipConfig
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 立即更新缓存
    const cachedConfigs = cacheManager.getCachedSkipConfigs() || {};
    cachedConfigs[key] = config;
    cacheManager.cacheSkipConfigs(cachedConfigs);

    // 触发立即更新事件
    dispatchDataUpdate('skipConfigsUpdated', cachedConfigs);

    // 异步同步到数据库
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

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存跳过片头片尾配置到 localStorage');
    return;
  }

  try {
    const configs = readLocalSkipConfigs();
    configs[key] = config;
    writeLocalSkipConfigs(configs);
    dispatchDataUpdate('skipConfigsUpdated', configs);
  } catch (err) {
    console.error('保存跳过片头片尾配置失败:', err);
    triggerGlobalError('保存跳过片头片尾配置失败');
    throw err;
  }
}

/**
 * 获取所有跳过片头片尾配置。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 */
export async function getAllSkipConfigs(): Promise<Record<string, SkipConfig>> {
  // 服务器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return {};
  }

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedSkipConfigs();

    if (cachedData) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<Record<string, SkipConfig>>(USER_DATA_API_PATHS.skipConfigs)
        .then((freshData) => {
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            // 触发数据更新事件
            dispatchDataUpdate('skipConfigsUpdated', freshData);
          }
        })
        .catch((err) => {
          console.warn('后台同步跳过片头片尾配置失败:', err);
          triggerGlobalError('后台同步跳过片头片尾配置失败');
        });

      return cachedData;
    } else {
      // 缓存为空，直接从 API 获取并缓存
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
  }

  // localStorage 模式
  try {
    return readLocalSkipConfigs();
  } catch (err) {
    console.error('读取跳过片头片尾配置失败:', err);
    triggerGlobalError('读取跳过片头片尾配置失败');
    return {};
  }
}

/**
 * 删除跳过片头片尾配置。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function deleteSkipConfig(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (shouldUseRemoteUserDataStorage()) {
    // 立即更新缓存
    const cachedConfigs = cacheManager.getCachedSkipConfigs() || {};
    delete cachedConfigs[key];
    cacheManager.cacheSkipConfigs(cachedConfigs);

    // 触发立即更新事件
    dispatchDataUpdate('skipConfigsUpdated', cachedConfigs);

    // 异步同步到数据库
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

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端删除跳过片头片尾配置到 localStorage');
    return;
  }

  try {
    const configs = readLocalSkipConfigs();
    delete configs[key];
    writeLocalSkipConfigs(configs);
    dispatchDataUpdate('skipConfigsUpdated', configs);
  } catch (err) {
    console.error('删除跳过片头片尾配置失败:', err);
    triggerGlobalError('删除跳过片头片尾配置失败');
    throw err;
  }
}
