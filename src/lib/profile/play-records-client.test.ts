jest.mock('@/lib/profile/runtime', () => ({
  shouldUseRemoteProfileStorage: jest.fn(() => false),
}));

import {
  clearAllPlayRecords,
  deletePlayRecord,
  getAllPlayRecords,
  getCachedPlayRecordsSnapshot,
  savePlayRecord,
} from '@/lib/profile/play-records-client';

describe('play records client', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads, writes, and clears play records in local mode', async () => {
    await savePlayRecord('demo', '1', {
      title: 'Demo',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      index: 1,
      total_episodes: 12,
      play_time: 30,
      total_time: 60,
      save_time: 1,
    });

    expect(getCachedPlayRecordsSnapshot()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Demo',
      }),
    });
    expect(await getAllPlayRecords()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Demo',
      }),
    });

    await deletePlayRecord('demo', '1');

    expect(await getAllPlayRecords()).toEqual({});

    await savePlayRecord('demo', '1', {
      title: 'Demo',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      index: 2,
      total_episodes: 12,
      play_time: 40,
      total_time: 60,
      save_time: 2,
    });

    await clearAllPlayRecords();

    expect(getCachedPlayRecordsSnapshot()).toEqual({});
    expect(await getAllPlayRecords()).toEqual({});
  });
});
