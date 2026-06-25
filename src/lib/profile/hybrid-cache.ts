/* eslint-disable no-console */
import { type Favorite, type PlayRecord } from './contracts';
import { shouldUseProfileApiStorage } from './runtime';
import { getAuthInfoFromBrowserCookie } from '../auth';
import { type FollowRecord, SkipConfig } from '../types';

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

const CACHE_PREFIX = 'moontv_cache_';
const CACHE_VERSION = '1.0.0';
const CACHE_EXPIRE_TIME = 60 * 60 * 1000;

function shouldUseRemoteUserDataStorage(): boolean {
  return shouldUseProfileApiStorage();
}

class HybridCacheManager {
  private static instance: HybridCacheManager;

  static getInstance(): HybridCacheManager {
    if (!HybridCacheManager.instance) {
      HybridCacheManager.instance = new HybridCacheManager();
    }

    return HybridCacheManager.instance;
  }

  private getCurrentUsername(): string | null {
    const authInfo = getAuthInfoFromBrowserCookie();
    return authInfo?.username || null;
  }

  private getUserCacheKey(username: string): string {
    return `${CACHE_PREFIX}${username}`;
  }

  private getUserCache(username: string): UserCacheStore {
    if (typeof window === 'undefined') {
      return {};
    }

    try {
      const cacheKey = this.getUserCacheKey(username);
      const cached = localStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : {};
    } catch (error) {
      console.warn('Failed to read user profile cache:', error);
      return {};
    }
  }

  private saveUserCache(username: string, cache: UserCacheStore): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const cacheSize = JSON.stringify(cache).length;
      if (cacheSize > 15 * 1024 * 1024) {
        console.warn('Profile cache too large, pruning stale entries.');
        this.cleanOldCache(cache);
      }

      const cacheKey = this.getUserCacheKey(username);
      localStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch (error) {
      console.warn('Failed to persist user profile cache:', error);
      if (
        error instanceof DOMException &&
        error.name === 'QuotaExceededError'
      ) {
        this.clearAllCache();
        try {
          const cacheKey = this.getUserCacheKey(username);
          localStorage.setItem(cacheKey, JSON.stringify(cache));
        } catch (retryError) {
          console.error(
            'Retrying profile cache persistence still failed:',
            retryError
          );
        }
      }
    }
  }

  private cleanOldCache(cache: UserCacheStore): void {
    const now = Date.now();
    const maxAge = 60 * 24 * 60 * 60 * 1000;

    if (cache.playRecords && now - cache.playRecords.timestamp > maxAge) {
      delete cache.playRecords;
    }

    if (cache.favorites && now - cache.favorites.timestamp > maxAge) {
      delete cache.favorites;
    }

    if (cache.followRecords && now - cache.followRecords.timestamp > maxAge) {
      delete cache.followRecords;
    }
  }

  private clearAllCache(): void {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  }

  private isCacheValid<T>(cache: CacheData<T>): boolean {
    const now = Date.now();
    return (
      cache.version === CACHE_VERSION &&
      now - cache.timestamp < CACHE_EXPIRE_TIME
    );
  }

  private createCacheData<T>(data: T): CacheData<T> {
    return {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };
  }

  getCachedPlayRecords(): Record<string, PlayRecord> | null {
    const username = this.getCurrentUsername();
    if (!username) {
      return null;
    }

    const cached = this.getUserCache(username).playRecords;
    return cached && this.isCacheValid(cached) ? cached.data : null;
  }

  cachePlayRecords(data: Record<string, PlayRecord>): void {
    const username = this.getCurrentUsername();
    if (!username) {
      return;
    }

    const userCache = this.getUserCache(username);
    userCache.playRecords = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  getCachedFavorites(): Record<string, Favorite> | null {
    const username = this.getCurrentUsername();
    if (!username) {
      return null;
    }

    const cached = this.getUserCache(username).favorites;
    return cached && this.isCacheValid(cached) ? cached.data : null;
  }

  cacheFavorites(data: Record<string, Favorite>): void {
    const username = this.getCurrentUsername();
    if (!username) {
      return;
    }

    const userCache = this.getUserCache(username);
    userCache.favorites = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  getCachedFollowRecords(): Record<string, FollowRecord> | null {
    const username = this.getCurrentUsername();
    if (!username) {
      return null;
    }

    const cached = this.getUserCache(username).followRecords;
    return cached && this.isCacheValid(cached) ? cached.data : null;
  }

  cacheFollowRecords(data: Record<string, FollowRecord>): void {
    const username = this.getCurrentUsername();
    if (!username) {
      return;
    }

    const userCache = this.getUserCache(username);
    userCache.followRecords = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  getCachedSearchHistory(): string[] | null {
    const username = this.getCurrentUsername();
    if (!username) {
      return null;
    }

    const cached = this.getUserCache(username).searchHistory;
    return cached && this.isCacheValid(cached) ? cached.data : null;
  }

  cacheSearchHistory(data: string[]): void {
    const username = this.getCurrentUsername();
    if (!username) {
      return;
    }

    const userCache = this.getUserCache(username);
    userCache.searchHistory = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  getCachedSkipConfigs(): Record<string, SkipConfig> | null {
    const username = this.getCurrentUsername();
    if (!username) {
      return null;
    }

    const cached = this.getUserCache(username).skipConfigs;
    return cached && this.isCacheValid(cached) ? cached.data : null;
  }

  cacheSkipConfigs(data: Record<string, SkipConfig>): void {
    const username = this.getCurrentUsername();
    if (!username) {
      return;
    }

    const userCache = this.getUserCache(username);
    userCache.skipConfigs = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  clearUserCache(username?: string): void {
    const targetUsername = username || this.getCurrentUsername();
    if (!targetUsername) {
      return;
    }

    try {
      const cacheKey = this.getUserCacheKey(targetUsername);
      localStorage.removeItem(cacheKey);
    } catch (error) {
      console.warn('Failed to clear user profile cache:', error);
    }
  }

  clearExpiredCaches(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const keysToRemove: string[] = [];

      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(CACHE_PREFIX)) {
          continue;
        }

        try {
          const cache = JSON.parse(localStorage.getItem(key) || '{}');
          let hasValidData = false;
          for (const [, cacheData] of Object.entries(cache)) {
            if (
              cacheData &&
              this.isCacheValid(cacheData as CacheData<unknown>)
            ) {
              hasValidData = true;
              break;
            }
          }

          if (!hasValidData) {
            keysToRemove.push(key);
          }
        } catch {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn('Failed to prune expired profile caches:', error);
    }
  }
}

export const cacheManager = HybridCacheManager.getInstance();

export interface ProfileCacheStatus {
  hasPlayRecords: boolean;
  hasFavorites: boolean;
  hasFollowRecords: boolean;
  hasSearchHistory: boolean;
  hasSkipConfigs: boolean;
  username: string | null;
}

export function getCacheStatus(): ProfileCacheStatus {
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
