import type { AdminConfig } from '@/lib/admin.types';

import type {
  DesktopProfileDomain,
  DesktopProfileSnapshot,
} from './desktop-merge';

export const PROFILE_SYNC_INITIAL_REVISION = '0';
export const PROFILE_SYNC_ADMIN_SETTINGS_INITIAL_REVISION = '0';
export const PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE =
  'PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE';

export class ProfileSyncAtomicCommitUnavailableError extends Error {
  readonly code = PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE;

  constructor() {
    super(PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE);
    this.name = 'ProfileSyncAtomicCommitUnavailableError';
  }
}

export interface ProfileSyncAdminSettingsCommit {
  expectedRevision: string;
  config: AdminConfig;
}

export interface ProfileSyncCommitRequest {
  username: string;
  expectedRevision: string;
  domains: readonly DesktopProfileDomain[];
  mergedSnapshot: DesktopProfileSnapshot;
  adminSettings?: ProfileSyncAdminSettingsCommit;
}

export interface ProfileSyncCommitResult {
  revision: string;
}
