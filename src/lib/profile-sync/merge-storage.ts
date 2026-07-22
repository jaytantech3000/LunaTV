import type { AdminSettingsSyncSnapshot } from '@/lib/admin-settings-sync';

import type {
  DesktopProfileDomain,
  DesktopProfileSnapshot,
} from './desktop-merge';

export const PROFILE_SYNC_INITIAL_REVISION = '0';
export const PROFILE_SYNC_ADMIN_SETTINGS_INITIAL_REVISION = '0';

export interface ProfileSyncAdminSettingsCommit {
  expectedRevision: string;
  snapshot: AdminSettingsSyncSnapshot;
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
