import { AppRuntimeConfig, getRuntimeConfig } from '@/lib/runtime-config';
import { apiFetch } from '@/lib/transport/api-client';

import { ensureDesktopAuthSession } from './auth-session';
import {
  type ApplyDesktopProfileSyncStatusOptions,
  applyDesktopProfileSyncStatus,
  DesktopProfileSyncStatus,
  restoreDesktopProfileSyncSession,
} from './profile-sync';
import {
  applyDesktopRuntimePublicConfig,
  DesktopRuntimePublicConfigPayload,
} from './runtime-config';
import {
  DesktopAuthStatus,
  isDesktopTauriRuntimeAvailable,
  startLocalService,
} from './tauri-client';

export interface DesktopProfileBootstrapPayload {
  appTarget: 'desktop' | string;
  runtime: DesktopRuntimePublicConfigPayload;
  profileSync: DesktopProfileSyncStatus;
  localAuth: DesktopAuthStatus;
}

declare global {
  interface Window {
    __DESKTOP_PROFILE_BOOTSTRAP__?: DesktopProfileBootstrapPayload;
  }
}

export type DesktopProfileBootstrapLocalAuthMode =
  | 'strict'
  | 'best-effort'
  | 'none';

export interface LoadedDesktopProfileBootstrapState {
  payload: DesktopProfileBootstrapPayload;
  localAuth: DesktopAuthStatus;
}

function isRecoverableDesktopBootstrapError(error: unknown): boolean {
  if (!isDesktopTauriRuntimeAvailable()) {
    return false;
  }

  if (error instanceof TypeError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return /failed to fetch|load failed|network/i.test(error.message);
}

async function fetchDesktopProfileBootstrapPayload(): Promise<DesktopProfileBootstrapPayload> {
  const response = await apiFetch('/profile/bootstrap', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to load profile bootstrap: ${response.status}`);
  }

  return (await response.json()) as DesktopProfileBootstrapPayload;
}

function readCachedDesktopProfileBootstrap(): DesktopProfileBootstrapPayload | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.__DESKTOP_PROFILE_BOOTSTRAP__ || null;
}

function cacheDesktopProfileBootstrap(
  payload: DesktopProfileBootstrapPayload
): DesktopProfileBootstrapPayload {
  if (typeof window !== 'undefined') {
    window.__DESKTOP_PROFILE_BOOTSTRAP__ = payload;
  }

  return payload;
}

function hasStoredDesktopProfileSyncCredentials(): boolean {
  return false;
}

export async function getDesktopProfileBootstrap(
  options: {
    preferCachedPayload?: boolean;
  } = {}
): Promise<DesktopProfileBootstrapPayload | null> {
  if (getRuntimeConfig().APP_TARGET !== 'desktop') {
    return null;
  }

  if (options.preferCachedPayload) {
    const cachedPayload = readCachedDesktopProfileBootstrap();
    if (cachedPayload) {
      return cachedPayload;
    }
  }

  try {
    return cacheDesktopProfileBootstrap(
      await fetchDesktopProfileBootstrapPayload()
    );
  } catch (error) {
    if (!isRecoverableDesktopBootstrapError(error)) {
      throw error;
    }

    await startLocalService();
    return cacheDesktopProfileBootstrap(
      await fetchDesktopProfileBootstrapPayload()
    );
  }
}

export function applyDesktopProfileBootstrap(
  payload: DesktopProfileBootstrapPayload,
  options: ApplyDesktopProfileSyncStatusOptions = {}
): AppRuntimeConfig {
  cacheDesktopProfileBootstrap(payload);
  applyDesktopRuntimePublicConfig(payload.runtime);
  if (options.preserveStoredCredentials) {
    return applyDesktopProfileSyncStatus(payload.profileSync, options);
  }

  return applyDesktopProfileSyncStatus(payload.profileSync);
}

async function restoreDesktopProfileSyncBootstrapIfNeeded(
  payload: DesktopProfileBootstrapPayload
): Promise<{
  payload: DesktopProfileBootstrapPayload;
  profileSyncOptions: ApplyDesktopProfileSyncStatusOptions;
}> {
  if (!payload.profileSync.enabled || payload.profileSync.authenticated) {
    return {
      payload,
      profileSyncOptions: {},
    };
  }

  const restored = await restoreDesktopProfileSyncSession();
  const shouldPreserveStoredCredentials =
    hasStoredDesktopProfileSyncCredentials();

  if (!restored) {
    return {
      payload,
      profileSyncOptions: shouldPreserveStoredCredentials
        ? {
            preserveStoredCredentials: true,
          }
        : {},
    };
  }

  try {
    return {
      payload: cacheDesktopProfileBootstrap(
        await fetchDesktopProfileBootstrapPayload()
      ),
      profileSyncOptions: {},
    };
  } catch {
    return {
      payload,
      profileSyncOptions: shouldPreserveStoredCredentials
        ? {
            preserveStoredCredentials: true,
          }
        : {},
    };
  }
}

export async function loadDesktopProfileBootstrapState(
  options: {
    localAuthMode?: DesktopProfileBootstrapLocalAuthMode;
    preferCachedPayload?: boolean;
  } = {}
): Promise<LoadedDesktopProfileBootstrapState | null> {
  const initialPayload = await getDesktopProfileBootstrap({
    preferCachedPayload: options.preferCachedPayload,
  });
  if (!initialPayload) {
    return null;
  }

  const { payload, profileSyncOptions } =
    await restoreDesktopProfileSyncBootstrapIfNeeded(initialPayload);

  applyDesktopProfileBootstrap(payload, profileSyncOptions);

  if (payload.profileSync.enabled || options.localAuthMode === 'none') {
    return {
      payload,
      localAuth: payload.localAuth,
    };
  }

  try {
    return {
      payload,
      localAuth: (await ensureDesktopAuthSession()) ?? payload.localAuth,
    };
  } catch (error) {
    if (options.localAuthMode === 'best-effort') {
      return {
        payload,
        localAuth: payload.localAuth,
      };
    }

    throw error;
  }
}
