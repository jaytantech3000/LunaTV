/* eslint-disable no-console */

import { getVersionFileUrl } from '@/lib/release-urls';
import { CURRENT_VERSION } from '@/lib/version';

export enum UpdateStatus {
  HAS_UPDATE = 'has_update',
  NO_UPDATE = 'no_update',
  FETCH_FAILED = 'fetch_failed',
}

const VERSION_CHECK_URLS = [getVersionFileUrl()];

export async function checkForUpdates(
  currentVersion = CURRENT_VERSION
): Promise<UpdateStatus> {
  try {
    const remoteVersion = await fetchLatestRemoteVersion();
    if (!remoteVersion) {
      return UpdateStatus.FETCH_FAILED;
    }

    return compareVersions(remoteVersion, currentVersion);
  } catch (error) {
    console.error('Version check failed:', error);
    return UpdateStatus.FETCH_FAILED;
  }
}

export async function fetchLatestRemoteVersion(): Promise<string | null> {
  for (const url of VERSION_CHECK_URLS) {
    const version = await fetchVersionFromUrl(url);
    if (version) {
      return version;
    }
  }

  return null;
}

async function fetchVersionFromUrl(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), 5000);
    const timestamp = Date.now();
    const urlWithTimestamp = url.includes('?')
      ? `${url}&_t=${timestamp}`
      : `${url}?_t=${timestamp}`;

    const response = await fetch(urlWithTimestamp, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Content-Type': 'text/plain',
      },
    });

    globalThis.clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const version = (await response.text()).trim();
    return version || null;
  } catch (error) {
    console.warn(`Failed to fetch remote version from ${url}:`, error);
    return null;
  }
}

export function compareVersions(
  remoteVersion: string,
  currentVersion = CURRENT_VERSION
): UpdateStatus {
  if (remoteVersion === currentVersion) {
    return UpdateStatus.NO_UPDATE;
  }

  try {
    const currentParts = normalizeVersionParts(currentVersion);
    const remoteParts = normalizeVersionParts(remoteVersion);

    for (let index = 0; index < 3; index += 1) {
      if (remoteParts[index] > currentParts[index]) {
        return UpdateStatus.HAS_UPDATE;
      }

      if (remoteParts[index] < currentParts[index]) {
        return UpdateStatus.NO_UPDATE;
      }
    }

    return UpdateStatus.NO_UPDATE;
  } catch (error) {
    console.error('Version comparison failed:', error);
    return remoteVersion !== currentVersion
      ? UpdateStatus.HAS_UPDATE
      : UpdateStatus.NO_UPDATE;
  }
}

function normalizeVersionParts(version: string): number[] {
  const parts = version.split('.').map((part) => {
    const value = Number.parseInt(part, 10);
    if (Number.isNaN(value) || value < 0) {
      throw new Error(`Invalid version: ${version}`);
    }
    return value;
  });

  while (parts.length < 3) {
    parts.push(0);
  }

  return parts.slice(0, 3);
}
