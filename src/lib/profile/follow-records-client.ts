/* eslint-disable no-console */
import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';

import { dispatchProfileCacheUpdate } from './cache';
import { PROFILE_USER_DATA_API_PATHS as USER_DATA_API_PATHS } from './contracts';
import { ensureDesktopLocalProfileStoreHydrated } from './desktop-local-migration';
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
import {
  isProfileApiAuthPending,
  PROFILE_API_NO_REDIRECT_OPTIONS,
} from './request-state';
import {
  isDesktopLocalProfileRuntime,
  shouldUseProfileApiStorage,
} from './runtime';
import { generateStorageKey } from './storage-key';
import { type FollowRecord } from '../types';

const DESKTOP_PROFILE_BOOTSTRAP_WAIT_TIMEOUT_MS = 12000;
const DESKTOP_PROFILE_BOOTSTRAP_POLL_INTERVAL_MS = 200;

let desktopProfileBootstrapWaitPromise: Promise<void> | null = null;
let followRecordsReadPromise: Promise<Record<string, FollowRecord>> | null =
  null;
let followRecordsMutationVersion = 0;

interface GetAllFollowRecordsOptions {
  suppressGlobalError?: boolean;
}

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

function hasDesktopProfileBootstrapPayload(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return Boolean(
    (window as Window & { __DESKTOP_PROFILE_BOOTSTRAP__?: unknown })
      .__DESKTOP_PROFILE_BOOTSTRAP__
  );
}

async function waitForDesktopProfileBootstrapReady(): Promise<void> {
  if (
    typeof window === 'undefined' ||
    !isDesktopLocalProfileRuntime() ||
    hasDesktopProfileBootstrapPayload()
  ) {
    return;
  }

  if (!desktopProfileBootstrapWaitPromise) {
    desktopProfileBootstrapWaitPromise = new Promise((resolve) => {
      let settled = false;
      let pollTimer: number | null = null;
      let timeoutTimer: number | null = null;

      const cleanup = () => {
        if (pollTimer !== null) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }

        if (timeoutTimer !== null) {
          window.clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }

        window.removeEventListener(
          DESKTOP_RUNTIME_UPDATED_EVENT,
          handleRuntimeUpdated
        );
        desktopProfileBootstrapWaitPromise = null;
      };

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve();
      };

      const handleRuntimeUpdated = () => {
        if (hasDesktopProfileBootstrapPayload()) {
          finish();
        }
      };

      window.addEventListener(
        DESKTOP_RUNTIME_UPDATED_EVENT,
        handleRuntimeUpdated
      );
      pollTimer = window.setInterval(() => {
        if (hasDesktopProfileBootstrapPayload()) {
          finish();
        }
      }, DESKTOP_PROFILE_BOOTSTRAP_POLL_INTERVAL_MS);
      timeoutTimer = window.setTimeout(
        finish,
        DESKTOP_PROFILE_BOOTSTRAP_WAIT_TIMEOUT_MS
      );

      if (hasDesktopProfileBootstrapPayload()) {
        finish();
      }
    });
  }

  await desktopProfileBootstrapWaitPromise;
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

export async function getAllFollowRecords(
  options: GetAllFollowRecordsOptions = {}
): Promise<Record<string, FollowRecord>> {
  if (typeof window === 'undefined') {
    return {};
  }

  if (shouldUseRemoteUserDataStorage()) {
    if (isProfileApiAuthPending()) {
      return {};
    }

    await waitForDesktopProfileBootstrapReady();
    await ensureDesktopLocalProfileStoreHydrated();
    const cachedData = cacheManager.getCachedFollowRecords();

    if (cachedData) {
      return cachedData;
    }

    if (!followRecordsReadPromise) {
      const readMutationVersion = followRecordsMutationVersion;
      followRecordsReadPromise = fetchFromApi<Record<string, FollowRecord>>(
        USER_DATA_API_PATHS.follows,
        PROFILE_API_NO_REDIRECT_OPTIONS
      )
        .then((freshData) => {
          if (readMutationVersion === followRecordsMutationVersion) {
            cacheManager.cacheFollowRecords(freshData);
          }
          return freshData;
        })
        .catch((err) => {
          if (wasRedirectedToLogin(err) || isUnauthorizedRequestError(err)) {
            return {};
          }

          if (options.suppressGlobalError) {
            console.warn('后台读取追更记录失败:', err);
            return {};
          }

          if (isDesktopLocalProfileRuntime()) {
            console.warn('桌面追更记录暂时不可用，已跳过首次提示:', err);
            return {};
          }

          console.error('获取追更记录失败:', err);
          triggerGlobalError('获取追更记录失败');
          return {};
        })
        .finally(() => {
          followRecordsReadPromise = null;
        });
    }

    return followRecordsReadPromise;
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
  const allFollowRecords = await getAllFollowRecords({
    // Passive badge/status lookups should not surface a blocking global toast.
    suppressGlobalError: true,
  });
  return allFollowRecords[key] || null;
}

export async function saveFollowRecord(
  source: string,
  id: string,
  follow: FollowRecord
): Promise<void> {
  const key = generateStorageKey(source, id);

  if (shouldUseRemoteUserDataStorage()) {
    await waitForDesktopProfileBootstrapReady();
    await ensureDesktopLocalProfileStoreHydrated();
    followRecordsMutationVersion += 1;
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
    const allFollows = await getAllFollowRecords({
      suppressGlobalError: true,
    });
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
    await waitForDesktopProfileBootstrapReady();
    await ensureDesktopLocalProfileStoreHydrated();
    followRecordsMutationVersion += 1;
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
    const allFollows = await getAllFollowRecords({
      suppressGlobalError: true,
    });
    delete allFollows[key];
    writeLocalFollowRecords(allFollows);
    dispatchFollowRecordsUpdated(allFollows);
  } catch (err) {
    console.error('删除追更记录失败:', err);
    triggerGlobalError('删除追更记录失败');
    throw err;
  }
}
