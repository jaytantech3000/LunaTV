import { getAuthInfoFromBrowserCookie } from '@/lib/auth';

import { useDownloadStore } from '@/stores/downloadStore';

import { clearDownloadCache } from './cache';
import { clearDesktopDownloadStoreSnapshot } from './desktop-runtime';
import { downloadManager } from './manager';
import { clearResourceIndexes } from './resource-index';

export function getCurrentDownloadOwner(): string | null {
  return getAuthInfoFromBrowserCookie()?.username?.trim() || null;
}

export async function purgeOfflineDownloads(): Promise<void> {
  downloadManager.abortAll();

  await Promise.allSettled([
    clearDownloadCache(),
    clearResourceIndexes(),
    clearDesktopDownloadStoreSnapshot(),
  ]);
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
