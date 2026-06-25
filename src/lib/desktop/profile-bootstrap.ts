import { AppRuntimeConfig, getRuntimeConfig } from '@/lib/runtime-config';
import { apiFetch } from '@/lib/transport/api-client';

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

export async function getDesktopProfileBootstrap(): Promise<DesktopProfileBootstrapPayload | null> {
  if (getRuntimeConfig().APP_TARGET !== 'desktop') {
    return null;
  }

  const response = await apiFetch('/profile/bootstrap', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to load profile bootstrap: ${response.status}`);
  }

  return (await response.json()) as DesktopProfileBootstrapPayload;
}

export function applyDesktopProfileBootstrap(
  payload: DesktopProfileBootstrapPayload
): AppRuntimeConfig {
  applyDesktopRuntimePublicConfig(payload.runtime);
  return applyDesktopProfileSyncStatus(payload.profileSync);
}
