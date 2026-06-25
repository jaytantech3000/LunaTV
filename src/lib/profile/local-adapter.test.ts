import {
  clearLocalFavorites,
  clearLocalFollowRecords,
  clearLocalPlayRecords,
  clearLocalSearchHistoryValues,
  clearLocalSkipConfigs,
  readLocalFavorites,
  readLocalFollowRecords,
  readLocalPlayRecords,
  readLocalSearchHistoryValues,
  readLocalSkipConfigs,
  writeLocalFavorites,
  writeLocalFollowRecords,
  writeLocalPlayRecords,
  writeLocalSearchHistoryValues,
  writeLocalSkipConfigs,
} from '@/lib/profile/local-adapter';

describe('profile local adapter helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads and writes play record snapshots', () => {
    writeLocalPlayRecords({
      'demo+1': {
        title: 'Demo',
        source_name: 'Demo Source',
        year: '2026',
        cover: 'cover.jpg',
        index: 1,
        total_episodes: 12,
        play_time: 30,
        total_time: 60,
        save_time: 1,
      },
    });

    expect(readLocalPlayRecords()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Demo',
      }),
    });

    clearLocalPlayRecords();
    expect(readLocalPlayRecords()).toEqual({});
  });

  it('reads and writes favorites, follows, search history, and skip configs', () => {
    writeLocalFavorites({
      'demo+1': {
        title: 'Demo',
        source_name: 'Demo Source',
        year: '2026',
        cover: 'cover.jpg',
        total_episodes: 12,
        save_time: 1,
      },
    });
    writeLocalFollowRecords({
      'demo+1': {
        title: 'Demo',
        source_name: 'Demo Source',
        year: '2026',
        cover: 'cover.jpg',
        followed_at: 1,
        followed_episode_count: 1,
        acknowledged_episode_count: 1,
        latest_episode_count: 1,
        last_checked_at: 1,
      },
    });
    writeLocalSearchHistoryValues(['demo::movie']);
    writeLocalSkipConfigs({
      'demo+1': {
        enable: true,
        intro_time: 12,
        outro_time: 34,
      },
    });

    expect(readLocalFavorites()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Demo',
      }),
    });
    expect(readLocalFollowRecords()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Demo',
      }),
    });
    expect(readLocalSearchHistoryValues()).toEqual(['demo::movie']);
    expect(readLocalSkipConfigs()).toEqual({
      'demo+1': {
        enable: true,
        intro_time: 12,
        outro_time: 34,
      },
    });

    clearLocalFavorites();
    clearLocalFollowRecords();
    clearLocalSearchHistoryValues();
    clearLocalSkipConfigs();

    expect(readLocalFavorites()).toEqual({});
    expect(readLocalFollowRecords()).toEqual({});
    expect(readLocalSearchHistoryValues()).toEqual([]);
    expect(readLocalSkipConfigs()).toEqual({});
  });
});
