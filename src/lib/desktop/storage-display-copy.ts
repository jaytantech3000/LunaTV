import { ResolvedProfileRuntime } from '@/lib/profile/contracts';

const REMOTE_PROVIDER_LABELS: Record<string, string> = {
  redis: 'Redis',
  upstash: 'Upstash',
};

function resolveRemoteProviderLabel(storageType: string): string {
  const normalizedStorageType = storageType.trim();
  return (
    REMOTE_PROVIDER_LABELS[normalizedStorageType.toLowerCase()] ||
    normalizedStorageType
  );
}

export function getProfileStorageDisplayCopy(
  runtime: ResolvedProfileRuntime
): string {
  switch (runtime.runtimeKind) {
    case 'desktop-local':
      return '本地 SQLite';
    case 'desktop-profile-sync': {
      const remoteProvider = resolveRemoteProviderLabel(runtime.storageType);
      return remoteProvider
        ? `本地 SQLite · 远端同步：${remoteProvider}`
        : '本地 SQLite · 远端同步';
    }
    case 'web-local':
      return '本地浏览器';
    case 'web-remote': {
      const remoteProvider = resolveRemoteProviderLabel(runtime.storageType);
      return remoteProvider ? `${remoteProvider} 远端存储` : '远端存储';
    }
  }
}
