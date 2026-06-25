export type ProfileMode = 'single-user-local' | 'shared-multi-user';

export type ProfileRuntimeKind =
  | 'web-local'
  | 'web-remote'
  | 'desktop-local'
  | 'desktop-profile-sync';

export interface PlayRecord {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
  save_time: number;
  search_title?: string;
  playback_mode?: 'online' | 'offline';
  offline_content_id?: string;
  is_adult?: boolean;
}

export interface Favorite {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  total_episodes: number;
  save_time: number;
  search_title?: string;
  playback_mode?: 'online' | 'offline';
  offline_content_id?: string;
  is_adult?: boolean;
  origin?: 'vod' | 'live';
}

export const PROFILE_SESSION_API_PATHS = {
  logout: '/logout',
} as const;

export const PROFILE_SYNC_USER_DATA_DOMAINS = [
  'playrecords',
  'favorites',
  'follows',
  'searchhistory',
  'skipconfigs',
] as const;

export type ProfileSyncUserDataDomain =
  (typeof PROFILE_SYNC_USER_DATA_DOMAINS)[number];

export const PROFILE_USER_DATA_API_PATHS = {
  playRecords: '/playrecords',
  searchHistory: '/searchhistory',
  favorites: '/favorites',
  follows: '/follows',
  skipConfigs: '/skipconfigs',
} as const;

export type ProfileCacheUpdateEvent =
  | 'playRecordsUpdated'
  | 'favoritesUpdated'
  | 'followRecordsUpdated'
  | 'searchHistoryUpdated'
  | 'skipConfigsUpdated';

export interface ResolvedProfileRuntime {
  appTarget: 'web' | 'desktop';
  runtimeKind: ProfileRuntimeKind;
  syncEnabled: boolean;
  storageType: string;
  profileMode: ProfileMode;
  usesRemoteUserData: boolean;
}
