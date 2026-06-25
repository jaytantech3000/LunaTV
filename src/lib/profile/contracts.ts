export type ProfileMode = 'single-user-local' | 'shared-multi-user';

export type ProfileRuntimeKind =
  | 'web-local'
  | 'web-remote'
  | 'desktop-local'
  | 'desktop-profile-sync';

export interface ResolvedProfileRuntime {
  appTarget: 'web' | 'desktop';
  runtimeKind: ProfileRuntimeKind;
  syncEnabled: boolean;
  storageType: string;
  profileMode: ProfileMode;
  usesRemoteUserData: boolean;
}
