import { getConfiguredStorageType } from '@/lib/runtime/storage-mode';
import { AppRuntimeConfig, getRuntimeConfig } from '@/lib/runtime-config';

import { ProfileMode, ResolvedProfileRuntime } from './contracts';

function normalizeStorageType(storageType?: string): string {
  const nextStorageType = storageType?.trim();
  return nextStorageType || 'localstorage';
}

function deriveProfileMode(storageType: string): ProfileMode {
  return storageType === 'localstorage'
    ? 'single-user-local'
    : 'shared-multi-user';
}

function resolveBaseStorageType(config: AppRuntimeConfig): string {
  return normalizeStorageType(
    config.STORAGE_TYPE || getConfiguredStorageType()
  );
}

export function resolveProfileRuntime(
  config: AppRuntimeConfig = getRuntimeConfig()
): ResolvedProfileRuntime {
  const appTarget = config.APP_TARGET === 'desktop' ? 'desktop' : 'web';
  const baseStorageType = resolveBaseStorageType(config);
  const syncEnabled =
    appTarget === 'desktop' && config.PROFILE_SYNC_ENABLED === true;
  const storageType = syncEnabled
    ? normalizeStorageType(config.PROFILE_SYNC_STORAGE_TYPE || baseStorageType)
    : baseStorageType;
  const profileMode = syncEnabled
    ? config.PROFILE_SYNC_PROFILE_MODE || deriveProfileMode(storageType)
    : config.PROFILE_MODE || deriveProfileMode(storageType);
  const usesRemoteUserData = storageType !== 'localstorage';
  const runtimeKind =
    appTarget === 'desktop'
      ? syncEnabled
        ? 'desktop-profile-sync'
        : 'desktop-local'
      : usesRemoteUserData
      ? 'web-remote'
      : 'web-local';

  return {
    appTarget,
    runtimeKind,
    syncEnabled,
    storageType,
    profileMode,
    usesRemoteUserData,
  };
}

export function shouldUseRemoteProfileStorage(
  config?: AppRuntimeConfig
): boolean {
  return resolveProfileRuntime(config).usesRemoteUserData;
}

export function isDesktopProfileSyncRuntime(
  config?: AppRuntimeConfig
): boolean {
  return resolveProfileRuntime(config).runtimeKind === 'desktop-profile-sync';
}

export function isDesktopLocalProfileRuntime(
  config?: AppRuntimeConfig
): boolean {
  return resolveProfileRuntime(config).runtimeKind === 'desktop-local';
}
