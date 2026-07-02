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

const DESKTOP_DOWNLOAD_OWNERSHIP_HANDOFF_KEY =
  'lunatv:desktop-download-ownership-handoff';
const DESKTOP_DOWNLOAD_OWNERSHIP_HANDOFF_TTL_MS = 10 * 60 * 1000;

interface DesktopDownloadOwnershipHandoff {
  previousOwnerUsername: string;
  nextOwnerUsername: string;
  createdAt: number;
}

function normalizeOwnerUsername(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function clearDesktopDownloadOwnershipHandoff(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.removeItem(DESKTOP_DOWNLOAD_OWNERSHIP_HANDOFF_KEY);
  } catch (_) {
    // Ignore storage failures in restricted contexts.
  }
}

function readDesktopDownloadOwnershipHandoff(): DesktopDownloadOwnershipHandoff | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(
      DESKTOP_DOWNLOAD_OWNERSHIP_HANDOFF_KEY
    );
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(
      rawValue
    ) as Partial<DesktopDownloadOwnershipHandoff>;
    const previousOwnerUsername = normalizeOwnerUsername(
      parsed.previousOwnerUsername
    );
    const nextOwnerUsername = normalizeOwnerUsername(parsed.nextOwnerUsername);
    const createdAt =
      typeof parsed.createdAt === 'number' && Number.isFinite(parsed.createdAt)
        ? parsed.createdAt
        : 0;

    if (
      !previousOwnerUsername ||
      !nextOwnerUsername ||
      !createdAt ||
      Date.now() - createdAt > DESKTOP_DOWNLOAD_OWNERSHIP_HANDOFF_TTL_MS
    ) {
      clearDesktopDownloadOwnershipHandoff();
      return null;
    }

    return {
      previousOwnerUsername,
      nextOwnerUsername,
      createdAt,
    };
  } catch (_) {
    clearDesktopDownloadOwnershipHandoff();
    return null;
  }
}

export function armDesktopDownloadOwnershipHandoff(input: {
  previousOwnerUsername?: string | null;
  nextOwnerUsername?: string | null;
}): void {
  const previousOwnerUsername = normalizeOwnerUsername(
    input.previousOwnerUsername
  );
  const nextOwnerUsername = normalizeOwnerUsername(input.nextOwnerUsername);

  if (
    typeof window === 'undefined' ||
    !previousOwnerUsername ||
    !nextOwnerUsername ||
    previousOwnerUsername === nextOwnerUsername
  ) {
    clearDesktopDownloadOwnershipHandoff();
    return;
  }

  try {
    window.sessionStorage.setItem(
      DESKTOP_DOWNLOAD_OWNERSHIP_HANDOFF_KEY,
      JSON.stringify({
        previousOwnerUsername,
        nextOwnerUsername,
        createdAt: Date.now(),
      } satisfies DesktopDownloadOwnershipHandoff)
    );
  } catch (_) {
    // Ignore storage failures and fall back to the default purge path.
  }
}

function shouldAcceptDesktopDownloadOwnershipHandoff(options: {
  previousOwnerUsername: string;
  nextOwnerUsername: string;
}): boolean {
  const handoff = readDesktopDownloadOwnershipHandoff();
  if (!handoff) {
    return false;
  }

  const matches =
    handoff.previousOwnerUsername === options.previousOwnerUsername &&
    handoff.nextOwnerUsername === options.nextOwnerUsername;

  if (matches) {
    clearDesktopDownloadOwnershipHandoff();
  }

  return matches;
}

export function getCurrentDownloadOwner(): string | null {
  return normalizeOwnerUsername(getAuthInfoFromBrowserCookie()?.username);
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
    if (
      shouldAcceptDesktopDownloadOwnershipHandoff({
        previousOwnerUsername: ownerUsername,
        nextOwnerUsername: currentOwner,
      })
    ) {
      setOwnerUsername(currentOwner);
      return;
    }

    await purgeOfflineDownloads();
    useDownloadStore.getState().setOwnerUsername(currentOwner);
  }
}
