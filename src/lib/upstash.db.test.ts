/* eslint-disable @typescript-eslint/no-var-requires -- Each test must reload the module after installing its isolated Upstash client mock. */

import type { AdminConfig } from './admin.types';
import type {
  ProfileSyncAdminSettingsCommit,
  ProfileSyncCommitRequest,
} from './profile-sync/merge-storage';
import type { Favorite, FollowRecord, PlayRecord } from './types';

describe('UpstashRedisStorage profile sync commits', () => {
  const evalMock = jest.fn();
  const getMock = jest.fn();
  const setMock = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    evalMock.mockReset();
    getMock.mockReset();
    setMock.mockReset();
    (
      globalThis as typeof globalThis & {
        __MOONTV_UPSTASH_REDIS_CLIENT__?: {
          eval: jest.Mock;
          get: jest.Mock;
          set: jest.Mock;
        };
      }
    ).__MOONTV_UPSTASH_REDIS_CLIENT__ = {
      eval: evalMock,
      get: getMock,
      set: setMock,
    };
  });

  afterEach(() => {
    delete (
      globalThis as typeof globalThis & {
        __MOONTV_UPSTASH_REDIS_CLIENT__?: unknown;
      }
    ).__MOONTV_UPSTASH_REDIS_CLIENT__;
  });

  it('uses EVAL with string revisions and returns null on a CAS conflict', async () => {
    evalMock.mockResolvedValueOnce(null);
    const { UpstashRedisStorage } = require('./upstash.db');
    const storage = new UpstashRedisStorage();
    const request = mergeRequest();

    await expect(storage.commitProfileSyncMerge(request)).resolves.toBeNull();
    expect(evalMock).toHaveBeenCalledTimes(1);
    const [, keys, args] = evalMock.mock.calls[0];
    expect(keys).toEqual([
      'u:alice:pr',
      'u:alice:fav',
      'u:alice:follow',
      'u:alice:sh',
      'u:alice:skip',
      'u:alice:profile-revision',
    ]);
    expect(args).toEqual([
      '7',
      JSON.stringify(request.domains),
      JSON.stringify(request.mergedSnapshot.playRecords),
      JSON.stringify(request.mergedSnapshot.favorites),
      JSON.stringify(request.mergedSnapshot.follows),
      JSON.stringify(request.mergedSnapshot.searchHistory),
      JSON.stringify(request.mergedSnapshot.skipConfigs),
    ]);
  });

  it('routes ordinary profile mutations through EVAL so each mutation advances the revision', async () => {
    evalMock.mockResolvedValue('8');
    const { UpstashRedisStorage } = require('./upstash.db');
    const storage = new UpstashRedisStorage();

    await storage.setPlayRecord('alice', 'source+1', playRecord());
    await storage.setFavorite('alice', 'source+1', favorite());
    await storage.setFollowRecord('alice', 'source+1', followRecord());
    await storage.addSearchHistory('alice', 'Demo');
    await storage.setSkipConfig('alice', 'source', '1', {
      enable: true,
      intro_time: 1,
      outro_time: 2,
    });

    expect(evalMock).toHaveBeenCalledTimes(5);
    expect(evalMock.mock.calls.map(([, keys]) => keys)).toEqual([
      ['u:alice:pr', 'u:alice:profile-revision'],
      ['u:alice:fav', 'u:alice:profile-revision'],
      ['u:alice:follow', 'u:alice:profile-revision'],
      ['u:alice:sh', 'u:alice:profile-revision'],
      ['u:alice:skip', 'u:alice:profile-revision'],
    ]);
    expect(evalMock.mock.calls[1][2]).toEqual([
      'hset',
      'source+1',
      JSON.stringify(favorite()),
    ]);
  });

  it('reads the missing global admin settings revision as decimal zero', async () => {
    getMock.mockResolvedValue(null);
    const { UpstashRedisStorage } = require('./upstash.db');
    const storage = new UpstashRedisStorage();

    await expect(storage.getAdminSettingsRevision()).resolves.toBe('0');
    expect(getMock).toHaveBeenCalledWith('admin:config-revision');
  });

  it('submits profile and admin settings CAS in one EVAL without fallback writes', async () => {
    evalMock.mockResolvedValueOnce(null);
    const { UpstashRedisStorage } = require('./upstash.db');
    const storage = new UpstashRedisStorage();
    const adminSettings = adminSettingsCommit();
    const request: ProfileSyncCommitRequest = {
      ...mergeRequest(),
      adminSettings,
    };

    await expect(storage.commitProfileSyncMerge(request)).resolves.toBeNull();
    expect(evalMock).toHaveBeenCalledTimes(1);
    const [, keys, args] = evalMock.mock.calls[0];
    expect(keys).toEqual([
      'u:alice:pr',
      'u:alice:fav',
      'u:alice:follow',
      'u:alice:sh',
      'u:alice:skip',
      'u:alice:profile-revision',
      'admin:config',
      'admin:config-revision',
    ]);
    expect(args).toEqual([
      '7',
      JSON.stringify(request.domains),
      JSON.stringify(request.mergedSnapshot.playRecords),
      JSON.stringify(request.mergedSnapshot.favorites),
      JSON.stringify(request.mergedSnapshot.follows),
      JSON.stringify(request.mergedSnapshot.searchHistory),
      JSON.stringify(request.mergedSnapshot.skipConfigs),
      '19',
      JSON.stringify(adminSettings.config),
    ]);
  });

  it('surfaces a recognizable error when a clustered EVAL cannot atomically include admin settings', async () => {
    evalMock.mockRejectedValueOnce(
      new Error('CROSSSLOT Keys in request do not hash to the same slot')
    );
    const { UpstashRedisStorage } = require('./upstash.db');
    const {
      ProfileSyncAtomicCommitUnavailableError,
    } = require('./profile-sync/merge-storage');
    const storage = new UpstashRedisStorage();

    await expect(
      storage.commitProfileSyncMerge({
        ...mergeRequest(),
        adminSettings: adminSettingsCommit(),
      })
    ).rejects.toThrow(ProfileSyncAtomicCommitUnavailableError);
    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a recognizable error when a clustered EVAL cannot atomically commit profile domains', async () => {
    evalMock.mockRejectedValueOnce(
      new Error('CROSSSLOT Keys in request do not hash to the same slot')
    );
    const { UpstashRedisStorage } = require('./upstash.db');
    const {
      ProfileSyncAtomicCommitUnavailableError,
    } = require('./profile-sync/merge-storage');
    const storage = new UpstashRedisStorage();

    await expect(
      storage.commitProfileSyncMerge(mergeRequest())
    ).rejects.toThrow(ProfileSyncAtomicCommitUnavailableError);
  });

  it('updates the admin config and its revision in one EVAL', async () => {
    evalMock.mockResolvedValueOnce('20');
    const { UpstashRedisStorage } = require('./upstash.db');
    const storage = new UpstashRedisStorage();
    const config = fullAdminConfig();

    await storage.setAdminConfig(config);

    expect(setMock).not.toHaveBeenCalled();
    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      ['admin:config', 'admin:config-revision'],
      [JSON.stringify(config)]
    );
  });
});

function mergeRequest(): ProfileSyncCommitRequest {
  return {
    username: 'alice',
    expectedRevision: '7',
    domains: ['playRecords', 'favorites'],
    mergedSnapshot: {
      playRecords: { 'source+1': playRecord() },
      favorites: { 'source+1': favorite() },
      follows: {},
      searchHistory: [],
      skipConfigs: {},
    },
  };
}

function adminSettingsCommit(): ProfileSyncAdminSettingsCommit {
  return {
    expectedRevision: '19',
    config: fullAdminConfig(),
  };
}

function fullAdminConfig(): AdminConfig {
  return {
    ConfigSubscribtion: {
      URL: 'https://example.test/sub',
      AutoUpdate: true,
      LastCheck: 'now',
    },
    ConfigFile: '{"preserved":true}',
    SiteConfig: {} as AdminConfig['SiteConfig'],
    UserConfig: {} as AdminConfig['UserConfig'],
    SourceConfig: [],
    CustomCategories: [],
    LiveConfig: [],
    AdFilterConfig: { enabled: true },
    PlayerEnhancementConfig: {
      AudioSpikeProtection: false,
      VisualEnhancement: false,
    },
  };
}

function playRecord(): PlayRecord {
  return {
    title: 'Demo',
    source_name: 'source',
    year: '2026',
    cover: '',
    index: 1,
    total_episodes: 1,
    play_time: 1,
    total_time: 1,
    save_time: 1,
    search_title: '',
  };
}

function favorite(): Favorite {
  return {
    title: 'Demo',
    source_name: 'source',
    year: '2026',
    cover: '',
    total_episodes: 1,
    save_time: 1,
    search_title: '',
  };
}

function followRecord(): FollowRecord {
  return {
    title: 'Demo',
    source_name: 'source',
    year: '2026',
    cover: '',
    followed_at: 1,
    followed_episode_count: 1,
    acknowledged_episode_count: 1,
    latest_episode_count: 1,
    last_checked_at: 1,
    search_title: undefined,
  };
}
