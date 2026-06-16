/* eslint-disable no-console */

import { getVersionFileUrl } from '@/lib/release-urls';
import { compareSemver } from '@/lib/semver';
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
    return compareSemver(remoteVersion, currentVersion) > 0
      ? UpdateStatus.HAS_UPDATE
      : UpdateStatus.NO_UPDATE;
  } catch (error) {
    console.error('Version comparison failed:', error);
    return remoteVersion !== currentVersion
      ? UpdateStatus.HAS_UPDATE
      : UpdateStatus.NO_UPDATE;
  }
}
