/* eslint-disable no-console */
import { dispatchProfileSearchHistoryUpdated } from './cache';
import { PROFILE_USER_DATA_API_PATHS as USER_DATA_API_PATHS } from './contracts';
import { ensureDesktopLocalProfileStoreHydrated } from './desktop-local-migration';
import { cacheManager } from './hybrid-cache';
import {
  clearLocalSearchHistoryValues,
  LOCAL_SEARCH_HISTORY_LIMIT,
  readLocalSearchHistoryValues,
  writeLocalSearchHistoryValues,
} from './local-adapter';
import {
  type RemoteProfileRequestInit,
  deleteRemoteProfileResource,
  fetchRemoteProfileJson as fetchFromApi,
  isUnauthorizedRemoteProfileRequestError as isUnauthorizedRequestError,
  postRemoteProfilePayload,
  wasRemoteProfileRequestRedirectedToLogin as wasRedirectedToLogin,
} from './remote-adapter';
import { shouldUseProfileApiStorage } from './runtime';
import {
  type SearchHistoryEntry,
  type SearchHistoryMode,
  decodeSearchHistoryValue,
  decodeSearchHistoryValues,
  encodeSearchHistoryValue,
  resolveSearchHistoryRawValue,
} from '../search-history';

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

export function dispatchSearchHistoryUpdated(rawHistory: string[]): void {
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

async function fetchSearchHistoryValues(
  options?: RemoteProfileRequestInit
): Promise<string[]> {
  return fetchFromApi<string[]>(USER_DATA_API_PATHS.searchHistory, options);
}

async function refreshSearchHistorySilently(): Promise<void> {
  try {
    const freshData = await fetchSearchHistoryValues({
      redirectOnUnauthorized: false,
    });
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

export async function getSearchHistory(): Promise<SearchHistoryEntry[]> {
  if (typeof window === 'undefined') {
    return [];
  }

  if (shouldUseRemoteUserDataStorage()) {
    await ensureDesktopLocalProfileStoreHydrated();
    const cachedData = cacheManager.getCachedSearchHistory();

    if (cachedData) {
      fetchSearchHistoryValues({
        redirectOnUnauthorized: false,
      })
        .then((freshData) => {
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
    }

    try {
      const freshData = await fetchSearchHistoryValues({
        redirectOnUnauthorized: false,
      });
      cacheManager.cacheSearchHistory(freshData);
      return decodeSearchHistoryValues(freshData);
    } catch (err) {
      console.error('获取搜索历史失败:', err);
      return [];
    }
  }

  try {
    return decodeSearchHistoryValues(readLocalSearchHistoryValues());
  } catch (err) {
    console.error('读取搜索历史失败:', err);
    triggerGlobalError('读取搜索历史失败');
    return [];
  }
}

export async function addSearchHistory(
  keyword: string,
  mode?: SearchHistoryMode
): Promise<void> {
  const trimmed = keyword.trim();
  const encodedKeyword = encodeSearchHistoryValue(trimmed, mode);

  if (!encodedKeyword) {
    return;
  }

  if (shouldUseRemoteUserDataStorage()) {
    await ensureDesktopLocalProfileStoreHydrated();
    const cachedHistory = cacheManager.getCachedSearchHistory() || [];
    const newHistory = [
      encodedKeyword,
      ...cachedHistory.filter(
        (value) => !shouldReplaceSearchHistoryValue(value, trimmed, mode)
      ),
    ];

    if (newHistory.length > LOCAL_SEARCH_HISTORY_LIMIT) {
      newHistory.length = LOCAL_SEARCH_HISTORY_LIMIT;
    }

    cacheManager.cacheSearchHistory(newHistory);
    dispatchSearchHistoryUpdated(newHistory);

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

  if (typeof window === 'undefined') {
    return;
  }

  try {
    const history = readLocalSearchHistoryValues();
    const newHistory = [
      encodedKeyword,
      ...history.filter(
        (value) => !shouldReplaceSearchHistoryValue(value, trimmed, mode)
      ),
    ];

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

export async function clearSearchHistory(): Promise<void> {
  if (shouldUseRemoteUserDataStorage()) {
    await ensureDesktopLocalProfileStoreHydrated();
    cacheManager.cacheSearchHistory([]);
    dispatchSearchHistoryUpdated([]);

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

  if (typeof window === 'undefined') {
    return;
  }

  clearLocalSearchHistoryValues();
  dispatchSearchHistoryUpdated([]);
}

export async function deleteSearchHistory(
  entry: SearchHistoryEntry | string
): Promise<void> {
  const rawValue = resolveSearchHistoryRawValue(entry);
  const trimmedKeyword =
    typeof entry === 'string' ? entry.trim() : entry.keyword.trim();

  if (!rawValue || !trimmedKeyword) {
    return;
  }

  if (shouldUseRemoteUserDataStorage()) {
    await ensureDesktopLocalProfileStoreHydrated();
    const cachedHistory = cacheManager.getCachedSearchHistory() || [];
    const newHistory = cachedHistory.filter((value) =>
      typeof entry === 'string'
        ? !shouldReplaceSearchHistoryValue(value, trimmedKeyword)
        : value !== rawValue
    );
    cacheManager.cacheSearchHistory(newHistory);
    dispatchSearchHistoryUpdated(newHistory);

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

  if (typeof window === 'undefined') {
    return;
  }

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
