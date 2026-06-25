import { AppRuntimeConfig, getRuntimeConfig } from '@/lib/runtime-config';
import { apiFetch } from '@/lib/transport/api-client';

import { ensureDesktopAuthSession } from './auth-session';
import {
  applyDesktopProfileSyncStatus,
  DesktopProfileSyncStatus,
} from './profile-sync';
import {
  applyDesktopRuntimePublicConfig,
  DesktopRuntimePublicConfigPayload,
} from './runtime-config';
import { DesktopAuthStatus } from './tauri-client';

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

  const response = await apiFetch('/profile/bootstrap', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to load profile bootstrap: ${response.status}`);
  }

  return cacheDesktopProfileBootstrap(
    (await response.json()) as DesktopProfileBootstrapPayload
  );
}

export function applyDesktopProfileBootstrap(
  payload: DesktopProfileBootstrapPayload
): AppRuntimeConfig {
  cacheDesktopProfileBootstrap(payload);
  applyDesktopRuntimePublicConfig(payload.runtime);
  return applyDesktopProfileSyncStatus(payload.profileSync);
}

export async function loadDesktopProfileBootstrapState(
  options: {
    localAuthMode?: DesktopProfileBootstrapLocalAuthMode;
    preferCachedPayload?: boolean;
  } = {}
): Promise<LoadedDesktopProfileBootstrapState | null> {
  const payload = await getDesktopProfileBootstrap({
    preferCachedPayload: options.preferCachedPayload,
  });
  if (!payload) {
    return null;
  }

  applyDesktopProfileBootstrap(payload);

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
