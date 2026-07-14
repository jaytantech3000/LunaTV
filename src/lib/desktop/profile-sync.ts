import {
  clearAuthInfoInBrowser,
  getAuthInfoFromBrowserCookie,
  setAuthInfoInBrowser,
} from '@/lib/auth';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { apiFetch } from '@/lib/transport/api-client';

export type DesktopProfileSyncErrorKind =
  | 'not-configured'
  | 'invalid-base-url'
  | 'unreachable'
  | 'unauthorized'
  | 'protocol-incompatible'
  | 'upstream-failure';

export interface DesktopProfileSyncStatus {
  enabled: boolean;
  reachable: boolean;
  authenticated: boolean;
  username?: string | null;
  role?: 'owner' | 'admin' | 'user' | string | null;
  storageType?: string | null;
  profileMode?: 'single-user-local' | 'shared-multi-user' | string | null;
  error?: string | null;
  errorKind?: DesktopProfileSyncErrorKind | null;
  syncDomains?: readonly string[] | null;
  pendingOutboxCount?: number;
  reauthRequired?: boolean;
  lastOutboxError?: string | null;
  nextOutboxAttemptAt?: number | null;
}

export interface DesktopProfileSyncStatusState {
  status: DesktopProfileSyncStatus | null | undefined;
  error: string;
}

export type DesktopProfileSyncConflictStrategy = 'web-first' | 'local-first';

export interface DesktopProfileSyncLocalAccountSummary {
  username: string;
  playRecordCount: number;
  favoriteCount: number;
  followCount: number;
  searchHistoryCount: number;
  skipConfigCount: number;
}

export interface DesktopProfileSyncOnboardingPlanItem {
  localUsername: string;
  remoteUsername: string;
  requiresAccountCreation: boolean;
  summary: DesktopProfileSyncLocalAccountSummary;
}

export interface DesktopProfileSyncOnboardingPlan {
  currentLocalUsername: string;
  currentRemoteUsername: string;
  items: DesktopProfileSyncOnboardingPlanItem[];
}

export interface DesktopProfileSyncDownloadPreview {
  hasDownloads: boolean;
  currentOwnerUsername: string | null;
  targetUsername: string | null;
  taskCount: number;
  libraryCount: number;
}

export interface DesktopProfileSyncOnboardingPreviewRequest {
  remoteBaseUrl?: string;
  username: string;
  password: string;
  currentLocalUsername: string;
}

export interface DesktopProfileSyncOnboardingPreviewResponse {
  remoteBaseUrl: string;
  currentRemoteUsername: string;
  currentRemoteRole: string;
  plan: DesktopProfileSyncOnboardingPlan;
  downloadPreview: DesktopProfileSyncDownloadPreview;
  warnings: string[];
}

export interface DesktopProfileSyncMergedSummary {
  playRecordCount: number;
  favoriteCount: number;
  followCount: number;
  searchHistoryCount: number;
  skipConfigCount: number;
}

export interface DesktopProfileSyncMigratedAccount {
  localUsername: string;
  remoteUsername: string;
  localSummary: DesktopProfileSyncLocalAccountSummary;
  mergedSummary: DesktopProfileSyncMergedSummary;
}

export interface DesktopProfileSyncCreatedAccount {
  username: string;
  initialPassword: string;
}

export interface DesktopProfileSyncDownloadRebindResult {
  didRebind: boolean;
  previousOwnerUsername: string | null;
  nextOwnerUsername: string | null;
  taskCount: number;
  libraryCount: number;
  resourceIndexCount: number;
}

export interface DesktopProfileSyncOnboardingExecuteRequest
  extends DesktopProfileSyncOnboardingPreviewRequest {
  strategy: DesktopProfileSyncConflictStrategy;
  syncDomains?: readonly string[];
}

export interface DesktopProfileSyncOnboardingExecuteResponse {
  remoteBaseUrl: string;
  currentRemoteUsername: string;
  currentRemoteRole: string;
  createdAccounts: DesktopProfileSyncCreatedAccount[];
  migratedAccounts: DesktopProfileSyncMigratedAccount[];
  downloadRebind: DesktopProfileSyncDownloadRebindResult;
  warnings: string[];
}

export interface DesktopProfileSyncManualSyncRequest {
  syncDomains: readonly string[];
  strategy: DesktopProfileSyncConflictStrategy;
}

export interface DesktopProfileSyncManualSyncResponse
  extends DesktopProfileSyncStatus {
  lastSyncError?: string | null;
}

export type DesktopProfileSyncState =
  | 'disabled'
  | 'offline'
  | 'auth-expired'
  | 'degraded'
  | 'connected'
  | 'ready';

export interface ApplyDesktopProfileSyncStatusOptions {
  preserveStoredCredentials?: boolean;
}

function normalizeRole(
  role?: DesktopProfileSyncStatus['role']
): 'owner' | 'admin' | 'user' {
  if (role === 'owner' || role === 'admin') {
    return role;
  }

  return 'user';
}

function hasStoredDesktopProfileSyncCredentials(
  _authInfo: ReturnType<typeof getAuthInfoFromBrowserCookie>
): boolean {
  return false;
}

export function resolveDesktopProfileSyncState(
  status: DesktopProfileSyncStatus | null | undefined
): DesktopProfileSyncState {
  if (!status?.enabled) {
    return 'disabled';
  }

  if (!status.reachable) {
    return 'offline';
  }

  if (status.errorKind === 'unauthorized') {
    return 'auth-expired';
  }

  if (status.errorKind) {
    return 'degraded';
  }

  return status.authenticated ? 'ready' : 'connected';
}

export async function getDesktopProfileSyncStatus(): Promise<DesktopProfileSyncStatus | null> {
  if (getRuntimeConfig().APP_TARGET !== 'desktop') {
    return null;
  }

  const response = await apiFetch('/profile-sync/status', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to load profile sync status: ${response.status}`);
  }

  return (await response.json()) as DesktopProfileSyncStatus;
}

async function readDesktopProfileSyncJsonResponse<T>(
  response: Response
): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }

  let errorMessage = `Profile sync request failed: ${response.status}`;

  try {
    const payload = (await response.clone().json()) as {
      error?: string;
    };
    if (typeof payload.error === 'string' && payload.error.trim()) {
      errorMessage = payload.error.trim();
    }
  } catch {
    try {
      const fallbackText = (await response.text()).trim();
      if (fallbackText) {
        errorMessage = fallbackText;
      }
    } catch {
      // Ignore secondary parse failures and keep the status fallback.
    }
  }

  throw new Error(errorMessage);
}

export async function previewDesktopProfileSyncOnboarding(
  payload: DesktopProfileSyncOnboardingPreviewRequest
): Promise<DesktopProfileSyncOnboardingPreviewResponse> {
  const response = await apiFetch('/admin/profile-sync/onboarding/preview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  return readDesktopProfileSyncJsonResponse<DesktopProfileSyncOnboardingPreviewResponse>(
    response
  );
}

export async function executeDesktopProfileSyncOnboarding(
  payload: DesktopProfileSyncOnboardingExecuteRequest
): Promise<DesktopProfileSyncOnboardingExecuteResponse> {
  const response = await apiFetch('/admin/profile-sync/onboarding/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  return readDesktopProfileSyncJsonResponse<DesktopProfileSyncOnboardingExecuteResponse>(
    response
  );
}

export async function syncDesktopProfileNow(
  payload: DesktopProfileSyncManualSyncRequest
): Promise<DesktopProfileSyncManualSyncResponse> {
  const response = await apiFetch('/profile-sync/sync-now', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  return readDesktopProfileSyncJsonResponse<DesktopProfileSyncManualSyncResponse>(
    response
  );
}

export async function restoreDesktopProfileSyncSession(): Promise<boolean> {
  return false;
}

export function describeDesktopProfileSyncStatusReadError(
  error: unknown
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message;
  }

  return '未能从本地服务读取 profile sync 状态。';
}

export async function readDesktopProfileSyncStatusState(): Promise<DesktopProfileSyncStatusState> {
  try {
    return {
      status: await getDesktopProfileSyncStatus(),
      error: '',
    };
  } catch (error) {
    return {
      status: undefined,
      error: describeDesktopProfileSyncStatusReadError(error),
    };
  }
}

export function applyDesktopProfileSyncStatus(
  status: DesktopProfileSyncStatus,
  options: ApplyDesktopProfileSyncStatusOptions = {}
) {
  const currentAuthInfo = getAuthInfoFromBrowserCookie();
  const currentConfig = getRuntimeConfig();
  const nextConfig = {
    ...currentConfig,
    PROFILE_SYNC_ENABLED: status.enabled,
    PROFILE_SYNC_STORAGE_TYPE: status.enabled
      ? status.storageType ?? currentConfig.PROFILE_SYNC_STORAGE_TYPE
      : undefined,
    PROFILE_SYNC_PROFILE_MODE: status.enabled
      ? (status.profileMode as
          | 'single-user-local'
          | 'shared-multi-user'
          | undefined) ?? currentConfig.PROFILE_SYNC_PROFILE_MODE
      : undefined,
  };

  if (typeof window === 'undefined') {
    return nextConfig;
  }

  window.RUNTIME_CONFIG = nextConfig;

  if (status.enabled) {
    if (status.authenticated && status.username?.trim()) {
      const password =
        currentAuthInfo?.sessionMode === 'desktop-profile-sync' &&
        currentAuthInfo.username?.trim() === status.username.trim()
          ? currentAuthInfo.password
          : undefined;
      setAuthInfoInBrowser({
        username: status.username.trim(),
        role: normalizeRole(status.role),
        password,
        sessionMode: 'desktop-profile-sync',
      });
    } else if (
      !(
        options.preserveStoredCredentials === true &&
        hasStoredDesktopProfileSyncCredentials(currentAuthInfo) &&
        status.errorKind !== 'unauthorized'
      )
    ) {
      clearAuthInfoInBrowser();
    }
  } else if (
    getAuthInfoFromBrowserCookie()?.sessionMode === 'desktop-profile-sync'
  ) {
    clearAuthInfoInBrowser();
  }

  return window.RUNTIME_CONFIG;
}
