jest.mock('@/lib/profile/runtime', () => ({
  shouldUseRemoteProfileStorage: jest.fn(() => false),
}));

import {
  deleteFollowRecord,
  getAllFollowRecords,
  getCachedFollowRecordsSnapshot,
  getFollowRecord,
  saveFollowRecord,
} from '@/lib/profile/follow-records-client';

describe('follow records client', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads, writes, and deletes follow records in local mode', async () => {
    await saveFollowRecord('demo', '1', {
      title: 'Demo',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      followed_at: 1,
      followed_episode_count: 1,
      acknowledged_episode_count: 1,
      latest_episode_count: 2,
      last_checked_at: 3,
    });

    expect(getCachedFollowRecordsSnapshot()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Demo',
      }),
    });
    expect(await getFollowRecord('demo', '1')).toEqual(
      expect.objectContaining({
        title: 'Demo',
      })
    );
    expect(await getAllFollowRecords()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Demo',
      }),
    });

    await deleteFollowRecord('demo', '1');

    expect(getCachedFollowRecordsSnapshot()).toEqual({});
    expect(await getFollowRecord('demo', '1')).toBeNull();
    expect(await getAllFollowRecords()).toEqual({});
  });
});
