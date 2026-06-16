/* eslint-disable no-console */

'use client';

import { getVersionFileUrl } from '@/lib/release-urls';
import { compareSemver } from '@/lib/semver';
import { CURRENT_VERSION } from '@/lib/version';

// 版本检查结果枚举
export enum UpdateStatus {
  HAS_UPDATE = 'has_update', // 有新版本
  NO_UPDATE = 'no_update', // 无新版本
  FETCH_FAILED = 'fetch_failed', // 获取失败
}

const VERSION_CHECK_URLS = [getVersionFileUrl()];

/**
 * 检查是否有新版本可用
 * @returns Promise<UpdateStatus> - 返回版本检查状态
 */
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
    console.error('版本检查失败:', error);
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

/**
 * 从指定URL获取版本信息
 * @param url - 版本信息URL
 * @returns Promise<string | null> - 版本字符串或null
 */
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
    console.warn(`从 ${url} 获取版本信息失败:`, error);
    return null;
  }
}

/**
 * 比较版本号
 * @param remoteVersion - 远程版本号
 * @returns UpdateStatus - 返回版本比较结果
 */
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
    console.error('版本号比较失败:', error);
    return remoteVersion !== currentVersion
      ? UpdateStatus.HAS_UPDATE
      : UpdateStatus.NO_UPDATE;
  }
}
