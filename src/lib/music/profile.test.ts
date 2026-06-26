'use client';

import {
  getAllMusicFavorites,
  getAllMusicPlayRecords,
  getMusicRecentTracks,
  isMusicFavorited,
  saveMusicFavorite,
  saveMusicPlayRecord,
  saveMusicRecentTrack,
  subscribeToMusicProfileUpdates,
} from './profile';
import type { PlayerQueueItem } from './types';

const trackA: PlayerQueueItem = {
  trackId: 'netease-track-1',
  source: 'netease',
  title: '霓虹夜航',
  artistsText: 'Luna Drive',
  cover: 'https://example.com/a.jpg',
  durationMs: 188000,
  albumTitle: 'Midnight Circuits',
  subtitle: '夜色电子',
};

const trackB: PlayerQueueItem = {
  trackId: 'qq-track-2',
  source: 'qq',
  title: '晴空慢板',
  artistsText: '北岸信号',
  cover: 'https://example.com/b.jpg',
  durationMs: 214000,
  albumTitle: 'Blue Afternoon',
  subtitle: '慢拍律动',
};

describe('music profile sdk', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('persists music favorites independently and dispatches updates', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToMusicProfileUpdates(
      'musicFavoritesUpdated',
      listener
    );

    await saveMusicFavorite(trackA);

    expect(await isMusicFavorited(trackA.source, trackA.trackId)).toBe(true);
    expect(await getAllMusicFavorites()).toEqual({
      'netease+netease-track-1': expect.objectContaining({
        trackId: trackA.trackId,
        source: trackA.source,
        title: trackA.title,
        savedAt: expect.any(Number),
      }),
    });
    expect(localStorage.getItem('moontv_favorites')).toBeNull();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        'netease+netease-track-1': expect.objectContaining({
          trackId: trackA.trackId,
        }),
      })
    );

    unsubscribe();
  });

  it('deduplicates recent tracks and keeps the latest play at the front', async () => {
    await saveMusicRecentTrack(trackA, 1000);
    await saveMusicRecentTrack(trackB, 2000);
    await saveMusicRecentTrack(trackA, 3000);

    const recentTracks = await getMusicRecentTracks();

    expect(recentTracks).toHaveLength(2);
    expect(recentTracks.map((track) => track.trackId)).toEqual([
      trackA.trackId,
      trackB.trackId,
    ]);
    expect(recentTracks[0]).toEqual(
      expect.objectContaining({
        trackId: trackA.trackId,
        playedAt: 3000,
      })
    );
  });

  it('stores playback snapshots without coupling to transient stream data', async () => {
    await saveMusicPlayRecord(trackA, {
      playedAt: 4000,
      playTimeSec: 42,
      durationSec: 188,
      completed: false,
    });

    expect(await getAllMusicPlayRecords()).toEqual({
      'netease+netease-track-1': expect.objectContaining({
        trackId: trackA.trackId,
        source: trackA.source,
        playTimeSec: 42,
        durationSec: 188,
        completed: false,
        playedAt: 4000,
      }),
    });
  });
});
