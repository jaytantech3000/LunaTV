import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import { useDownloadStore } from '@/stores/downloadStore';

import { clearDownloadCache } from './cache';
import { downloadClient } from './client';
import { clearDesktopDownloadEngineSnapshotCache } from './desktop-engine-sync';
import {
  clearDesktopDownloadEngineTasks,
  clearDesktopDownloadStoreSnapshot,
} from './desktop-runtime';
import { clearResourceIndexes } from './resource-index';

export function getCurrentDownloadOwner(): string | null {
  return getAuthInfoFromBrowserCookie()?.username?.trim() || null;
}

export async function purgeOfflineDownloads(): Promise<void> {
  downloadClient.abortAll();

  await Promise.allSettled([
    clearDownloadCache(),
    clearResourceIndexes(),
    clearDesktopDownloadEngineTasks(),
    clearDesktopDownloadStoreSnapshot(),
  ]);
  clearDesktopDownloadEngineSnapshotCache();
  useDownloadStore.getState().resetDownloads();
  await useDownloadStore.persist.clearStorage();
}

export async function syncDownloadOwner(): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  const currentOwner = getCurrentDownloadOwner();
  const { ownerUsername, setOwnerUsername } = useDownloadStore.getState();

  if (!currentOwner) {
    if (ownerUsername) {
      await purgeOfflineDownloads();
    }
    return;
  }

  if (!ownerUsername) {
    setOwnerUsername(currentOwner);
    return;
  }

  if (ownerUsername !== currentOwner) {
    await purgeOfflineDownloads();
    useDownloadStore.getState().setOwnerUsername(currentOwner);
  }
}
