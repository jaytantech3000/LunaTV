import type {
  Favorite,
  FollowRecord,
  PlayRecord,
  SkipConfig,
} from '@/lib/types';

import {
  mergeDesktopProfileSnapshot,
  mergeSearchHistory,
  summarizeDesktopProfileSnapshot,
} from './desktop-merge';

function buildPlayRecord(title: string, saveTime: number): PlayRecord {
  return {
    title,
    source_name: 'Demo',
    cover: 'cover.jpg',
    year: '2026',
    index: 1,
    total_episodes: 12,
    play_time: 30,
    total_time: 60,
    save_time: saveTime,
    search_title: title,
  };
}

function buildFavorite(title: string, saveTime: number): Favorite {
  return {
    title,
    source_name: 'Demo',
    total_episodes: 12,
    year: '2026',
    cover: 'cover.jpg',
    save_time: saveTime,
    search_title: title,
  };
}

function buildFollow(title: string, followedAt: number): FollowRecord {
  return {
    title,
    source_name: 'Demo',
    year: '2026',
    cover: 'cover.jpg',
    search_title: title,
    followed_at: followedAt,
    followed_episode_count: 2,
    acknowledged_episode_count: 2,
    latest_episode_count: 3,
    last_checked_at: followedAt,
  };
}

function buildSkipConfig(intro: number): SkipConfig {
  return {
    enable: true,
    intro_time: intro,
    outro_time: intro + 10,
  };
}

describe('desktop profile sync merge helpers', () => {
  it('uses local values on keyed conflicts when strategy is local-first', () => {
    const merged = mergeDesktopProfileSnapshot(
      {
        playRecords: {
          'same+1': buildPlayRecord('remote-play', 1),
          'remote-only+1': buildPlayRecord('remote-only-play', 2),
        },
        favorites: {
          'same+1': buildFavorite('remote-favorite', 3),
        },
        follows: {
          'same+1': buildFollow('remote-follow', 4),
        },
        searchHistory: ['remote-shared', 'remote-only'],
        skipConfigs: {
          'same+1': buildSkipConfig(5),
        },
      },
      {
        playRecords: {
          'same+1': buildPlayRecord('local-play', 11),
          'local-only+1': buildPlayRecord('local-only-play', 12),
        },
        favorites: {
          'same+1': buildFavorite('local-favorite', 13),
        },
        follows: {
          'same+1': buildFollow('local-follow', 14),
        },
        searchHistory: ['remote-shared', 'local-only'],
        skipConfigs: {
          'same+1': buildSkipConfig(15),
        },
      },
      'local-first'
    );

    expect(merged.playRecords['same+1'].title).toBe('local-play');
    expect(merged.playRecords['remote-only+1'].title).toBe('remote-only-play');
    expect(merged.playRecords['local-only+1'].title).toBe('local-only-play');
    expect(merged.favorites['same+1'].title).toBe('local-favorite');
    expect(merged.follows['same+1'].title).toBe('local-follow');
    expect(merged.skipConfigs['same+1'].intro_time).toBe(15);
    expect(merged.searchHistory).toEqual([
      'remote-shared',
      'local-only',
      'remote-only',
    ]);
  });

  it('keeps remote values on keyed conflicts when strategy is web-first', () => {
    const merged = mergeDesktopProfileSnapshot(
      {
        playRecords: {
          'same+1': buildPlayRecord('remote-play', 1),
        },
        favorites: {
          'same+1': buildFavorite('remote-favorite', 3),
        },
        follows: {
          'same+1': buildFollow('remote-follow', 4),
        },
        searchHistory: ['remote-shared', 'remote-only'],
        skipConfigs: {
          'same+1': buildSkipConfig(5),
        },
      },
      {
        playRecords: {
          'same+1': buildPlayRecord('local-play', 11),
          'local-only+1': buildPlayRecord('local-only-play', 12),
        },
        favorites: {
          'same+1': buildFavorite('local-favorite', 13),
        },
        follows: {
          'same+1': buildFollow('local-follow', 14),
        },
        searchHistory: ['remote-shared', 'local-only'],
        skipConfigs: {
          'same+1': buildSkipConfig(15),
        },
      },
      'web-first'
    );

    expect(merged.playRecords['same+1'].title).toBe('remote-play');
    expect(merged.playRecords['local-only+1'].title).toBe('local-only-play');
    expect(merged.favorites['same+1'].title).toBe('remote-favorite');
    expect(merged.follows['same+1'].title).toBe('remote-follow');
    expect(merged.skipConfigs['same+1'].intro_time).toBe(5);
    expect(merged.searchHistory).toEqual([
      'remote-shared',
      'remote-only',
      'local-only',
    ]);
  });

  it('dedupes search history, trims blanks, and enforces the limit', () => {
    expect(
      mergeSearchHistory(
        [' remote-one ', 'shared', 'remote-two'],
        ['shared', 'local-one', 'remote-two', ' ', ''],
        'local-first',
        3
      )
    ).toEqual(['shared', 'local-one', 'remote-two']);
  });

  it('summarizes snapshot counts for preview and completion copy', () => {
    expect(
      summarizeDesktopProfileSnapshot({
        playRecords: {
          'play+1': buildPlayRecord('play', 1),
        },
        favorites: {
          'favorite+1': buildFavorite('favorite', 2),
        },
        follows: {
          'follow+1': buildFollow('follow', 3),
        },
        searchHistory: ['demo'],
        skipConfigs: {
          'skip+1': buildSkipConfig(4),
        },
      })
    ).toEqual({
      playRecordCount: 1,
      favoriteCount: 1,
      followCount: 1,
      searchHistoryCount: 1,
      skipConfigCount: 1,
    });
  });
});
