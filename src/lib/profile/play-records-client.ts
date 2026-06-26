/* eslint-disable no-console */
import { DESKTOP_RUNTIME_UPDATED_EVENT } from '@/lib/desktop/runtime-config';

import { dispatchProfileCacheUpdate } from './cache';
import {
  type PlayRecord,
  PROFILE_USER_DATA_API_PATHS as USER_DATA_API_PATHS,
} from './contracts';
import { ensureDesktopLocalProfileStoreHydrated } from './desktop-local-migration';
import { cacheManager } from './hybrid-cache';
import {
  clearLocalPlayRecords,
  readLocalPlayRecords,
  writeLocalPlayRecords,
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

const DESKTOP_PROFILE_BOOTSTRAP_WAIT_TIMEOUT_MS = 12000;
const DESKTOP_PROFILE_BOOTSTRAP_POLL_INTERVAL_MS = 200;

let desktopProfileBootstrapWaitPromise: Promise<void> | null = null;

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

function dispatchPlayRecordsUpdated(records: Record<string, PlayRecord>): void {
  dispatchProfileCacheUpdate('playRecordsUpdated', records);
}

async function handlePlayRecordOperationFailure(error: unknown): Promise<void> {
  if (wasRedirectedToLogin(error) || isUnauthorizedRequestError(error)) {
    return;
  }

  console.error('数据库操作失败 (playRecords):', error);
  triggerGlobalError('数据库操作失败');

  try {
    const freshData = await fetchFromApi<Record<string, PlayRecord>>(
      USER_DATA_API_PATHS.playRecords
    );
    cacheManager.cachePlayRecords(freshData);
    dispatchPlayRecordsUpdated(freshData);
  } catch (refreshErr) {
    if (
      wasRedirectedToLogin(refreshErr) ||
      isUnauthorizedRequestError(refreshErr)
    ) {
      return;
    }

    console.error('刷新playRecords缓存失败:', refreshErr);
    triggerGlobalError('刷新playRecords缓存失败');
  }
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

export async function getAllPlayRecords(): Promise<Record<string, PlayRecord>> {
  if (typeof window === 'undefined') {
    return {};
  }

  if (shouldUseRemoteUserDataStorage()) {
    if (isProfileApiAuthPending()) {
      return {};
    }

    await waitForDesktopProfileBootstrapReady();
    await ensureDesktopLocalProfileStoreHydrated();
    const cachedData = cacheManager.getCachedPlayRecords();

    if (cachedData) {
      fetchFromApi<Record<string, PlayRecord>>(
        USER_DATA_API_PATHS.playRecords,
        PROFILE_API_NO_REDIRECT_OPTIONS
      )
        .then((freshData) => {
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cachePlayRecords(freshData);
            dispatchPlayRecordsUpdated(freshData);
          }
        })
        .catch((err) => {
          if (wasRedirectedToLogin(err) || isUnauthorizedRequestError(err)) {
            return;
          }

          console.warn('后台同步播放记录失败:', err);
          triggerGlobalError('后台同步播放记录失败');
        });

      return cachedData;
    }

    try {
      const freshData = await fetchFromApi<Record<string, PlayRecord>>(
        USER_DATA_API_PATHS.playRecords,
        PROFILE_API_NO_REDIRECT_OPTIONS
      );
      cacheManager.cachePlayRecords(freshData);
      return freshData;
    } catch (err) {
      if (wasRedirectedToLogin(err) || isUnauthorizedRequestError(err)) {
        return {};
      }

      console.error('获取播放记录失败:', err);
      triggerGlobalError('获取播放记录失败');
      return {};
    }
  }

  try {
    return readLocalPlayRecords();
  } catch (err) {
    console.error('读取播放记录失败:', err);
    triggerGlobalError('读取播放记录失败');
    return {};
  }
}

export async function savePlayRecord(
  source: string,
  id: string,
  record: PlayRecord
): Promise<void> {
  const key = generateStorageKey(source, id);

  if (shouldUseRemoteUserDataStorage()) {
    await waitForDesktopProfileBootstrapReady();
    await ensureDesktopLocalProfileStoreHydrated();
    const cachedRecords = cacheManager.getCachedPlayRecords() || {};
    cachedRecords[key] = record;
    cacheManager.cachePlayRecords(cachedRecords);
    dispatchPlayRecordsUpdated(cachedRecords);

    try {
      await postRemoteProfilePayload(USER_DATA_API_PATHS.playRecords, {
        key,
        record,
      });
    } catch (err) {
      await handlePlayRecordOperationFailure(err);
      triggerGlobalError('保存播放记录失败');
      throw err;
    }
    return;
  }

  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存播放记录到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllPlayRecords();
    allRecords[key] = record;
    writeLocalPlayRecords(allRecords);
    dispatchPlayRecordsUpdated(allRecords);
  } catch (err) {
    console.error('保存播放记录失败:', err);
    triggerGlobalError('保存播放记录失败');
    throw err;
  }
}

export async function deletePlayRecord(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  if (shouldUseRemoteUserDataStorage()) {
    await waitForDesktopProfileBootstrapReady();
    await ensureDesktopLocalProfileStoreHydrated();
    const cachedRecords = cacheManager.getCachedPlayRecords() || {};
    delete cachedRecords[key];
    cacheManager.cachePlayRecords(cachedRecords);
    dispatchPlayRecordsUpdated(cachedRecords);

    try {
      await deleteRemoteProfileResource(USER_DATA_API_PATHS.playRecords, {
        key,
      });
    } catch (err) {
      await handlePlayRecordOperationFailure(err);
      triggerGlobalError('删除播放记录失败');
      throw err;
    }
    return;
  }

  if (typeof window === 'undefined') {
    console.warn('无法在服务端删除播放记录到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllPlayRecords();
    delete allRecords[key];
    writeLocalPlayRecords(allRecords);
    dispatchPlayRecordsUpdated(allRecords);
  } catch (err) {
    console.error('删除播放记录失败:', err);
    triggerGlobalError('删除播放记录失败');
    throw err;
  }
}

export async function clearAllPlayRecords(): Promise<void> {
  if (shouldUseRemoteUserDataStorage()) {
    await waitForDesktopProfileBootstrapReady();
    await ensureDesktopLocalProfileStoreHydrated();
    cacheManager.cachePlayRecords({});
    dispatchPlayRecordsUpdated({});

    try {
      await deleteRemoteProfileResource(USER_DATA_API_PATHS.playRecords);
    } catch (err) {
      await handlePlayRecordOperationFailure(err);
      triggerGlobalError('清空播放记录失败');
      throw err;
    }
    return;
  }

  if (typeof window === 'undefined') {
    return;
  }

  clearLocalPlayRecords();
  dispatchPlayRecordsUpdated({});
}
