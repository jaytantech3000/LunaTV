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
  // Desktop profile data always lives in the local SQLite store. Profile sync is
  // a background replication concern, not a different request/auth runtime.
  const storageType = baseStorageType;
  const profileMode = config.PROFILE_MODE || deriveProfileMode(storageType);
  const runtimeKind =
    appTarget === 'desktop'
      ? 'desktop-local'
      : storageType !== 'localstorage'
      ? 'web-remote'
      : 'web-local';
  const usesRemoteUserData = runtimeKind === 'web-remote';

  return {
    appTarget,
    runtimeKind,
    syncEnabled,
    syncStorageType: syncEnabled
      ? normalizeStorageType(config.PROFILE_SYNC_STORAGE_TYPE)
      : undefined,
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

export function shouldUseProfileApiStorage(config?: AppRuntimeConfig): boolean {
  const runtime = resolveProfileRuntime(config);
  return runtime.runtimeKind === 'desktop-local' || runtime.usesRemoteUserData;
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
