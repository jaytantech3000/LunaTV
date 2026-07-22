const redisClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  del: jest.fn(),
  eval: jest.fn(),
  get: jest.fn(),
  hDel: jest.fn(),
  hGet: jest.fn(),
  hGetAll: jest.fn(),
  hSet: jest.fn(),
  isOpen: true,
  lPush: jest.fn(),
  lRange: jest.fn(),
  lRem: jest.fn(),
  lTrim: jest.fn(),
  on: jest.fn(),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => redisClient),
}));

import type { AdminConfig } from './admin.types';
import {
  type ProfileSyncCommitRequest,
  ProfileSyncAtomicCommitUnavailableError,
} from './profile-sync/merge-storage';
import { BaseRedisStorage } from './redis-base.db';
import type { PlayRecord } from './types';

interface ProfileSyncStorage {
  getAdminSettingsRevision(): Promise<string>;
  commitProfileSyncMerge(
    request: ProfileSyncCommitRequest
  ): Promise<{ revision: string } | null>;
  setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void>;
  setAdminConfig(config: AdminConfig): Promise<void>;
}

class TestRedisStorage extends BaseRedisStorage {}

function createStorage(): ProfileSyncStorage {
  return new TestRedisStorage(
    { url: 'redis://example.test', clientName: 'Test Redis' },
    Symbol('test-redis-client')
  ) as unknown as ProfileSyncStorage;
}

function createMergedAdminConfig(): AdminConfig {
  return {
    ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
    ConfigFile: '{"auth":{"username":"owner"}}',
    SiteConfig: {
      SiteName: 'LunaTV',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 3600,
      DoubanProxyType: 'custom',
      DoubanProxy: '',
      DoubanImageProxyType: 'custom',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
      FluidSearch: false,
      EnableWebLive: true,
    },
    UserConfig: { Users: [{ username: 'owner', role: 'owner' }] },
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

describe('BaseRedisStorage profile sync commit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when the atomic commit CAS does not match', async () => {
    redisClient.eval.mockResolvedValue(null);
    const storage = createStorage();

    await expect(
      storage.commitProfileSyncMerge({
        username: 'alice',
        expectedRevision: '7',
        domains: ['playRecords'],
        mergedSnapshot: {
          playRecords: {},
          favorites: {},
          follows: {},
          searchHistory: [],
          skipConfigs: {},
        },
      })
    ).resolves.toBeNull();

    expect(redisClient.eval).toHaveBeenCalledTimes(1);
    expect(redisClient.hSet).not.toHaveBeenCalled();
    expect(redisClient.del).not.toHaveBeenCalled();
  });

  it('returns the revision from one selected-domain atomic commit', async () => {
    redisClient.eval.mockResolvedValue('8');
    const storage = createStorage();

    await expect(
      storage.commitProfileSyncMerge({
        username: 'alice',
        expectedRevision: '7',
        domains: ['favorites'],
        mergedSnapshot: {
          playRecords: {},
          favorites: {},
          follows: {},
          searchHistory: [],
          skipConfigs: {},
        },
      })
    ).resolves.toEqual({ revision: '8' });

    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('currentRevision'),
      expect.objectContaining({
        keys: [
          'u:alice:profile-sync-revision',
          'u:alice:pr',
          'u:alice:fav',
          'u:alice:follow',
          'u:alice:sh',
          'u:alice:skip',
        ],
        arguments: [
          '7',
          '["favorites"]',
          expect.stringContaining('"favorites"'),
        ],
      })
    );
  });

  it('increments the profile revision in the same Lua call as a play-record write', async () => {
    redisClient.eval.mockResolvedValue('8');
    const storage = createStorage();

    await storage.setPlayRecord('alice', 'demo+1', {
      title: 'Demo',
      source_name: 'Demo',
      cover: '',
      year: '2026',
      index: 1,
      total_episodes: 12,
      play_time: 30,
      total_time: 60,
      save_time: 1,
      search_title: 'Demo',
    });

    expect(redisClient.eval).toHaveBeenCalledTimes(1);
    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        keys: ['u:alice:pr', 'u:alice:profile-sync-revision'],
        arguments: [
          'hash-set',
          'demo+1',
          expect.stringContaining('"title":"Demo"'),
        ],
      })
    );
    expect(redisClient.hSet).not.toHaveBeenCalled();
  });

  it('returns the initial string when the admin settings revision is missing', async () => {
    redisClient.get.mockResolvedValue(null);
    const storage = createStorage();

    await expect(storage.getAdminSettingsRevision()).resolves.toBe('0');
    expect(redisClient.get).toHaveBeenCalledWith('admin:config-revision');
  });

  it('increments the admin settings revision in the same Lua call as a config write', async () => {
    redisClient.eval.mockResolvedValue('13');
    const storage = createStorage();
    const config = createMergedAdminConfig();

    await storage.setAdminConfig(config);

    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR', KEYS[2])"),
      {
        keys: ['admin:config', 'admin:config-revision'],
        arguments: [JSON.stringify(config)],
      }
    );
    expect(redisClient.hSet).not.toHaveBeenCalled();
    expect(redisClient.del).not.toHaveBeenCalled();
  });

  it('commits the full merged admin config in one CAS script', async () => {
    redisClient.eval.mockResolvedValue('8');
    const storage = createStorage();
    const config = createMergedAdminConfig();

    await expect(
      storage.commitProfileSyncMerge({
        username: 'alice',
        expectedRevision: '7',
        domains: ['favorites'],
        mergedSnapshot: {
          playRecords: {},
          favorites: {},
          follows: {},
          searchHistory: [],
          skipConfigs: {},
        },
        adminSettings: {
          expectedRevision: '12',
          config,
        },
      } as unknown as ProfileSyncCommitRequest)
    ).resolves.toEqual({ revision: '8' });

    expect(redisClient.eval).toHaveBeenCalledTimes(1);
    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('currentAdminRevision'),
      expect.objectContaining({
        keys: [
          'u:alice:profile-sync-revision',
          'u:alice:pr',
          'u:alice:fav',
          'u:alice:follow',
          'u:alice:sh',
          'u:alice:skip',
          'admin:config',
          'admin:config-revision',
        ],
        arguments: [
          '7',
          '["favorites"]',
          expect.stringContaining('"favorites"'),
          '1',
          '12',
          expect.stringContaining('"SiteName":"LunaTV"'),
        ],
      })
    );
    const [, evalOptions] = redisClient.eval.mock.calls[0] as [
      string,
      { arguments: string[] }
    ];
    expect(evalOptions.arguments[5]).toContain('"UserConfig"');
    expect(evalOptions.arguments[5]).toContain('"ConfigFile"');
    expect(redisClient.hSet).not.toHaveBeenCalled();
    expect(redisClient.del).not.toHaveBeenCalled();
  });

  it('surfaces cross-slot commit failures without falling back to separate writes', async () => {
    redisClient.eval.mockRejectedValue(
      new Error('CROSSSLOT Keys in request do not hash to the same slot')
    );
    const storage = createStorage();

    await expect(
      storage.commitProfileSyncMerge({
        username: 'alice',
        expectedRevision: '7',
        domains: ['favorites'],
        mergedSnapshot: {
          playRecords: {},
          favorites: {},
          follows: {},
          searchHistory: [],
          skipConfigs: {},
        },
      })
    ).rejects.toThrow('PROFILE_SYNC_CROSS_SLOT_ATOMIC_COMMIT_UNAVAILABLE');

    await expect(
      storage.commitProfileSyncMerge({
        username: 'alice',
        expectedRevision: '7',
        domains: ['favorites'],
        mergedSnapshot: {
          playRecords: {},
          favorites: {},
          follows: {},
          searchHistory: [],
          skipConfigs: {},
        },
      })
    ).rejects.toBeInstanceOf(ProfileSyncAtomicCommitUnavailableError);

    expect(redisClient.hSet).not.toHaveBeenCalled();
    expect(redisClient.del).not.toHaveBeenCalled();
  });

  it('surfaces admin config cross-slot failures as the typed atomic error', async () => {
    redisClient.eval.mockRejectedValue(
      new Error('CROSSSLOT Keys in request do not hash to the same slot')
    );
    const storage = createStorage();

    await expect(
      storage.setAdminConfig(createMergedAdminConfig())
    ).rejects.toBeInstanceOf(ProfileSyncAtomicCommitUnavailableError);
    expect(redisClient.hSet).not.toHaveBeenCalled();
    expect(redisClient.del).not.toHaveBeenCalled();
  });
});
