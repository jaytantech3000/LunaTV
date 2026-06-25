export type ProfileMode = 'single-user-local' | 'shared-multi-user';

export type ProfileRuntimeKind =
  | 'web-local'
  | 'web-remote'
  | 'desktop-local'
  | 'desktop-profile-sync';

export const PROFILE_SESSION_API_PATHS = {
  logout: '/logout',
} as const;

export const PROFILE_USER_DATA_API_PATHS = {
  playRecords: '/playrecords',
  searchHistory: '/searchhistory',
  favorites: '/favorites',
  follows: '/follows',
  skipConfigs: '/skipconfigs',
} as const;

export interface ResolvedProfileRuntime {
  appTarget: 'web' | 'desktop';
  runtimeKind: ProfileRuntimeKind;
  syncEnabled: boolean;
  storageType: string;
  profileMode: ProfileMode;
  usesRemoteUserData: boolean;
}
