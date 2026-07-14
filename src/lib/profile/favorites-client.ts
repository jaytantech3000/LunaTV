/* eslint-disable no-console */
import { dispatchProfileCacheUpdate } from './cache';
import {
  type Favorite,
  PROFILE_USER_DATA_API_PATHS as USER_DATA_API_PATHS,
} from './contracts';
import { ensureDesktopLocalProfileStoreHydrated } from './desktop-local-migration';
import { cacheManager } from './hybrid-cache';
import {
  clearLocalFavorites,
  readLocalFavorites,
  writeLocalFavorites,
} from './local-adapter';
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
import { shouldUseProfileApiStorage } from './runtime';
import { generateStorageKey } from './storage-key';

let favoritesReadPromise: Promise<Record<string, Favorite>> | null = null;
let favoritesMutationVersion = 0;

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

function dispatchFavoritesUpdated(favorites: Record<string, Favorite>): void {
  dispatchProfileCacheUpdate('favoritesUpdated', favorites);
}

async function handleFavoriteOperationFailure(error: unknown): Promise<void> {
  if (wasRedirectedToLogin(error) || isUnauthorizedRequestError(error)) {
    return;
  }

  console.error('数据库操作失败 (favorites):', error);
  triggerGlobalError('数据库操作失败');

  try {
    const freshData = await fetchFromApi<Record<string, Favorite>>(
      USER_DATA_API_PATHS.favorites
    );
    cacheManager.cacheFavorites(freshData);
    dispatchFavoritesUpdated(freshData);
  } catch (refreshErr) {
    if (
      wasRedirectedToLogin(refreshErr) ||
      isUnauthorizedRequestError(refreshErr)
    ) {
      return;
    }

    console.error('刷新favorites缓存失败:', refreshErr);
    triggerGlobalError('刷新favorites缓存失败');
  }
}

export async function getAllFavorites(): Promise<Record<string, Favorite>> {
  if (typeof window === 'undefined') {
    return {};
  }

  if (shouldUseRemoteUserDataStorage()) {
    if (isProfileApiAuthPending()) {
      return {};
    }

    await ensureDesktopLocalProfileStoreHydrated();
    const cachedData = cacheManager.getCachedFavorites();

    if (cachedData) {
      return cachedData;
    }

    if (!favoritesReadPromise) {
      const readMutationVersion = favoritesMutationVersion;
      favoritesReadPromise = fetchFromApi<Record<string, Favorite>>(
        USER_DATA_API_PATHS.favorites,
        PROFILE_API_NO_REDIRECT_OPTIONS
      )
        .then((freshData) => {
          if (readMutationVersion === favoritesMutationVersion) {
            cacheManager.cacheFavorites(freshData);
          }
          return freshData;
        })
        .catch((err) => {
          if (wasRedirectedToLogin(err) || isUnauthorizedRequestError(err)) {
            return {};
          }

          console.error('获取收藏失败:', err);
          triggerGlobalError('获取收藏失败');
          return {};
        })
        .finally(() => {
          favoritesReadPromise = null;
        });
    }

    return favoritesReadPromise;
  }

  try {
    return readLocalFavorites();
  } catch (err) {
    console.error('读取收藏失败:', err);
    triggerGlobalError('读取收藏失败');
    return {};
  }
}

export async function saveFavorite(
  source: string,
  id: string,
  favorite: Favorite
): Promise<void> {
  const key = generateStorageKey(source, id);

  if (shouldUseRemoteUserDataStorage()) {
    await ensureDesktopLocalProfileStoreHydrated();
    favoritesMutationVersion += 1;
    const cachedFavorites = cacheManager.getCachedFavorites() || {};
    cachedFavorites[key] = favorite;
    cacheManager.cacheFavorites(cachedFavorites);
    dispatchFavoritesUpdated(cachedFavorites);

    try {
      await postRemoteProfilePayload(USER_DATA_API_PATHS.favorites, {
        key,
        favorite,
      });
    } catch (err) {
      await handleFavoriteOperationFailure(err);
      triggerGlobalError('保存收藏失败');
      throw err;
    }
    return;
  }

  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存收藏到 localStorage');
    return;
  }

  try {
    const allFavorites = await getAllFavorites();
    allFavorites[key] = favorite;
    writeLocalFavorites(allFavorites);
    dispatchFavoritesUpdated(allFavorites);
  } catch (err) {
    console.error('保存收藏失败:', err);
    triggerGlobalError('保存收藏失败');
    throw err;
  }
}

export async function deleteFavorite(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  if (shouldUseRemoteUserDataStorage()) {
    await ensureDesktopLocalProfileStoreHydrated();
    favoritesMutationVersion += 1;
    const cachedFavorites = cacheManager.getCachedFavorites() || {};
    delete cachedFavorites[key];
    cacheManager.cacheFavorites(cachedFavorites);
    dispatchFavoritesUpdated(cachedFavorites);

    try {
      await deleteRemoteProfileResource(USER_DATA_API_PATHS.favorites, {
        key,
      });
    } catch (err) {
      await handleFavoriteOperationFailure(err);
      triggerGlobalError('删除收藏失败');
      throw err;
    }
    return;
  }

  if (typeof window === 'undefined') {
    console.warn('无法在服务端删除收藏到 localStorage');
    return;
  }

  try {
    const allFavorites = await getAllFavorites();
    delete allFavorites[key];
    writeLocalFavorites(allFavorites);
    dispatchFavoritesUpdated(allFavorites);
  } catch (err) {
    console.error('删除收藏失败:', err);
    triggerGlobalError('删除收藏失败');
    throw err;
  }
}

export async function isFavorited(
  source: string,
  id: string
): Promise<boolean> {
  const key = generateStorageKey(source, id);

  if (shouldUseRemoteUserDataStorage()) {
    if (isProfileApiAuthPending()) {
      return false;
    }

    await ensureDesktopLocalProfileStoreHydrated();
    const cachedFavorites = cacheManager.getCachedFavorites();

    if (cachedFavorites) {
      fetchFromApi<Record<string, Favorite>>(
        USER_DATA_API_PATHS.favorites,
        PROFILE_API_NO_REDIRECT_OPTIONS
      )
        .then((freshData) => {
          if (JSON.stringify(cachedFavorites) !== JSON.stringify(freshData)) {
            cacheManager.cacheFavorites(freshData);
            dispatchFavoritesUpdated(freshData);
          }
        })
        .catch((err) => {
          if (wasRedirectedToLogin(err) || isUnauthorizedRequestError(err)) {
            return;
          }

          console.warn('后台同步收藏失败:', err);
          triggerGlobalError('后台同步收藏失败');
        });

      return !!cachedFavorites[key];
    }

    try {
      const freshData = await fetchFromApi<Record<string, Favorite>>(
        USER_DATA_API_PATHS.favorites,
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
      cacheManager.cacheFavorites(freshData);
      return !!freshData[key];
    } catch (err) {
      if (wasRedirectedToLogin(err) || isUnauthorizedRequestError(err)) {
        return false;
      }

      console.error('检查收藏状态失败:', err);
      triggerGlobalError('检查收藏状态失败');
      return false;
    }
  }

  const allFavorites = await getAllFavorites();
  return !!allFavorites[key];
}

export async function clearAllFavorites(): Promise<void> {
  if (shouldUseRemoteUserDataStorage()) {
    await ensureDesktopLocalProfileStoreHydrated();
    favoritesMutationVersion += 1;
    cacheManager.cacheFavorites({});
    dispatchFavoritesUpdated({});

    try {
      await deleteRemoteProfileResource(USER_DATA_API_PATHS.favorites);
    } catch (err) {
      await handleFavoriteOperationFailure(err);
      triggerGlobalError('清空收藏失败');
      throw err;
    }
    return;
  }

  if (typeof window === 'undefined') {
    return;
  }

  clearLocalFavorites();
  dispatchFavoritesUpdated({});
}
