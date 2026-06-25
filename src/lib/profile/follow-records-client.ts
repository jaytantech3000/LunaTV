/* eslint-disable no-console */
import { dispatchProfileCacheUpdate } from './cache';
import { PROFILE_USER_DATA_API_PATHS as USER_DATA_API_PATHS } from './contracts';
import { cacheManager } from './hybrid-cache';
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
import { generateStorageKey } from './storage-key';
import { type FollowRecord } from '../types';

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

function dispatchFollowRecordsUpdated(
  followRecords: Record<string, FollowRecord>
): void {
  dispatchProfileCacheUpdate('followRecordsUpdated', followRecords);
}

async function handleFollowRecordOperationFailure(
  error: unknown
): Promise<void> {
  if (wasRedirectedToLogin(error) || isUnauthorizedRequestError(error)) {
    return;
  }

  console.error('数据库操作失败 (followRecords):', error);
  triggerGlobalError('数据库操作失败');

  try {
    const freshData = await fetchFromApi<Record<string, FollowRecord>>(
      USER_DATA_API_PATHS.follows
    );
    cacheManager.cacheFollowRecords(freshData);
    dispatchFollowRecordsUpdated(freshData);
  } catch (refreshErr) {
    if (
      wasRedirectedToLogin(refreshErr) ||
      isUnauthorizedRequestError(refreshErr)
    ) {
      return;
    }

    console.error('刷新followRecords缓存失败:', refreshErr);
    triggerGlobalError('刷新followRecords缓存失败');
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
            dispatchFollowRecordsUpdated(freshData);
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

export async function getFollowRecord(
  source: string,
  id: string
): Promise<FollowRecord | null> {
  const key = generateStorageKey(source, id);
  const allFollowRecords = await getAllFollowRecords();
  return allFollowRecords[key] || null;
}

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
    dispatchFollowRecordsUpdated(cachedFollows);

    try {
      await postRemoteProfilePayload(USER_DATA_API_PATHS.follows, {
        key,
        follow,
      });
    } catch (err) {
      await handleFollowRecordOperationFailure(err);
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
    dispatchFollowRecordsUpdated(allFollows);
  } catch (err) {
    console.error('保存追更记录失败:', err);
    triggerGlobalError('保存追更记录失败');
    throw err;
  }
}

export async function deleteFollowRecord(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  if (shouldUseRemoteUserDataStorage()) {
    const cachedFollows = cacheManager.getCachedFollowRecords() || {};
    delete cachedFollows[key];
    cacheManager.cacheFollowRecords(cachedFollows);
    dispatchFollowRecordsUpdated(cachedFollows);

    try {
      await deleteRemoteProfileResource(USER_DATA_API_PATHS.follows, {
        key,
      });
    } catch (err) {
      await handleFollowRecordOperationFailure(err);
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
    dispatchFollowRecordsUpdated(allFollows);
  } catch (err) {
    console.error('删除追更记录失败:', err);
    triggerGlobalError('删除追更记录失败');
    throw err;
  }
}
