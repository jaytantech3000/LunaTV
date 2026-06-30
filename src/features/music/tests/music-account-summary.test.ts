import { buildMusicAccountSummary } from '../services/music-account-summary';

describe('music account summary', () => {
  beforeEach(() => {
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
      STORAGE_TYPE: 'localstorage',
      PROFILE_MODE: 'single-user-local',
      PROFILE_SYNC_ENABLED: true,
      PROFILE_SYNC_STORAGE_TYPE: 'redis',
      PROFILE_SYNC_PROFILE_MODE: 'shared-multi-user',
    };
  });

  afterEach(() => {
    delete window.RUNTIME_CONFIG;
  });

  it('surfaces reachable sync failures as attention-needed state', () => {
    const summary = buildMusicAccountSummary({
      authInfo: {
        username: 'cloud-owner',
        sessionMode: 'desktop-profile-sync',
      },
      bootstrapState: {
        payload: {
          appTarget: 'desktop',
          runtime: {
            profileSyncEnabled: true,
          },
          profileSync: {
            enabled: true,
            reachable: true,
            authenticated: false,
            username: 'cloud-owner',
            role: 'owner',
            storageType: 'redis',
            profileMode: 'shared-multi-user',
            error: 'unexpected profile sync response',
            errorKind: 'protocol-incompatible',
            syncDomains: ['playrecords', 'favorites'],
          },
          localAuth: {
            username: 'desktop-owner',
            passwordRequired: false,
            multiUser: true,
            ownerPasswordConfigured: true,
          },
        },
        localAuth: {
          username: 'desktop-owner',
          passwordRequired: false,
          multiUser: true,
          ownerPasswordConfigured: true,
        },
      },
    });

    expect(summary.statusLabel).toBe('Sync needs attention');
  });
});
