import {
  type AuthCookiePayload,
  getAuthInfoFromBrowserCookie,
} from '@/lib/auth';
import {
  type LoadedDesktopProfileBootstrapState,
  loadDesktopProfileBootstrapState,
} from '@/lib/desktop/profile-bootstrap';
import { resolveDesktopProfileSyncState } from '@/lib/desktop/profile-sync';
import { resolveProfileRuntime } from '@/lib/profile/runtime';

export interface MusicAccountSummary {
  detail: string;
  initials: string;
  modeLabel: string;
  statusLabel: string;
  username: string;
}

function buildInitials(username: string): string {
  const normalized = username.trim();

  if (!normalized) {
    return 'LM';
  }

  if (/[\u4e00-\u9fff]/.test(normalized)) {
    return normalized[0] || 'LM';
  }

  return (
    normalized
      .split(/[\s_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('')
      .slice(0, 2) || normalized.slice(0, 2).toUpperCase()
  );
}

function resolveDesktopLocalSummary(
  authInfo: AuthCookiePayload | null
): MusicAccountSummary {
  const username = authInfo?.username?.trim() || 'Desktop owner';

  return {
    username,
    initials: buildInitials(username),
    statusLabel: 'Stored on this Mac',
    modeLabel: 'Desktop local / localstorage',
    detail: 'Saved tracks, recent plays, and resume state stay on this device.',
  };
}

function resolveRemoteModeLabel(
  profileMode?: string | null,
  storageType?: string | null
): string {
  const normalizedStorageType = storageType?.trim() || 'remote';

  if (profileMode === 'shared-multi-user') {
    return `Remote shared profile / ${normalizedStorageType}`;
  }

  return `Remote single profile / ${normalizedStorageType}`;
}

function resolveDesktopSyncSummary(
  authInfo: AuthCookiePayload | null,
  bootstrapState: LoadedDesktopProfileBootstrapState | null
): MusicAccountSummary {
  const profileSyncStatus = bootstrapState?.payload.profileSync;
  const username =
    profileSyncStatus?.username?.trim() ||
    authInfo?.username?.trim() ||
    'Remote profile';
  const syncState = resolveDesktopProfileSyncState(profileSyncStatus);
  const statusLabel =
    syncState === 'offline'
      ? 'Sync offline'
      : syncState === 'ready'
      ? 'Sync ready'
      : syncState === 'degraded'
      ? 'Sync needs attention'
      : 'Sync sign-in required';

  return {
    username,
    initials: buildInitials(username),
    statusLabel,
    modeLabel: resolveRemoteModeLabel(
      profileSyncStatus?.profileMode,
      profileSyncStatus?.storageType
    ),
    detail:
      'Only library data syncs remotely. Discovery and playback stay local.',
  };
}

function resolveWebSummary(
  authInfo: AuthCookiePayload | null
): MusicAccountSummary {
  const username = authInfo?.username?.trim() || 'Browser preview';

  return {
    username,
    initials: buildInitials(username),
    statusLabel: 'Stored in this browser',
    modeLabel: 'Web local',
    detail:
      'This preview keeps music state in the current browser session only.',
  };
}

export function buildMusicAccountSummary(params: {
  authInfo: AuthCookiePayload | null;
  bootstrapState?: LoadedDesktopProfileBootstrapState | null;
}): MusicAccountSummary {
  const runtime = resolveProfileRuntime();

  if (runtime.appTarget !== 'desktop') {
    return resolveWebSummary(params.authInfo);
  }

  if (runtime.runtimeKind === 'desktop-profile-sync') {
    return resolveDesktopSyncSummary(
      params.authInfo,
      params.bootstrapState || null
    );
  }

  return resolveDesktopLocalSummary(params.authInfo);
}

export async function loadMusicAccountSummary(): Promise<MusicAccountSummary> {
  const authInfo = getAuthInfoFromBrowserCookie();
  const runtime = resolveProfileRuntime();

  if (runtime.appTarget !== 'desktop') {
    return resolveWebSummary(authInfo);
  }

  if (runtime.runtimeKind !== 'desktop-profile-sync') {
    return resolveDesktopLocalSummary(authInfo);
  }

  try {
    const bootstrapState = await loadDesktopProfileBootstrapState({
      localAuthMode: 'best-effort',
      preferCachedPayload: true,
    });

    return buildMusicAccountSummary({
      authInfo,
      bootstrapState,
    });
  } catch {
    return buildMusicAccountSummary({
      authInfo,
      bootstrapState: null,
    });
  }
}
