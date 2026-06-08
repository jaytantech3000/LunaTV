export type AppStorageType = 'localstorage' | 'redis' | 'upstash' | 'kvrocks';

export type ProfileMode = 'single-user-local' | 'shared-multi-user';

export function getConfiguredStorageType(): AppStorageType {
  const storageType = (process.env.NEXT_PUBLIC_STORAGE_TYPE ||
    process.env.STORAGE_TYPE ||
    'localstorage') as AppStorageType;

  return storageType;
}

export function getProfileMode(
  storageType: AppStorageType = getConfiguredStorageType()
): ProfileMode {
  return storageType === 'localstorage'
    ? 'single-user-local'
    : 'shared-multi-user';
}

export function isSingleUserLocalMode(
  storageType: AppStorageType = getConfiguredStorageType()
): boolean {
  return getProfileMode(storageType) === 'single-user-local';
}
