import type { ProfileSyncCommitRequest } from './profile-sync/merge-storage';

describe('UpstashRedisStorage profile sync commits', () => {
  const evalMock = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    evalMock.mockReset();
    (
      globalThis as typeof globalThis & {
        __MOONTV_UPSTASH_REDIS_CLIENT__?: { eval: jest.Mock };
      }
    ).__MOONTV_UPSTASH_REDIS_CLIENT__ = { eval: evalMock };
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
    const { UpstashRedisStorage } = await import('./upstash.db');
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
    const { UpstashRedisStorage } = await import('./upstash.db');
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

function playRecord() {
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
  };
}

function favorite() {
  return {
    title: 'Demo',
    source_name: 'source',
    year: '2026',
    cover: '',
    total_episodes: 1,
    save_time: 1,
  };
}

function followRecord() {
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
  };
}
