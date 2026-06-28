import type { MusicTrackEntity } from '../domain/entities';
import {
  clearAllMusicFavorites,
  clearAllMusicPlayRecords,
  clearAllMusicRecentTracks,
  getAllMusicFavorites,
  getAllMusicPlayRecords,
  getMusicRecentTracks,
  saveMusicFavorite,
  saveMusicPlayRecord,
  saveMusicRecentTrack,
  subscribeToMusicProfileUpdates,
} from '../services/music-profile';

const TRACK_A: MusicTrackEntity = {
  id: 'netease-track-1',
  source: 'netease',
  title: '霓虹夜航',
  artists: ['Luna Drive'],
  album: 'Midnight Circuits',
  coverUrl: 'https://example.com/a.jpg',
  durationMs: 188000,
  stream: '',
  playable: true,
};

const TRACK_B: MusicTrackEntity = {
  id: 'netease-track-2',
  source: 'netease',
  title: '晴空慢板',
  artists: ['北岸信号'],
  album: 'Blue Afternoon',
  coverUrl: 'https://example.com/b.jpg',
  durationMs: 214000,
  stream: '',
  playable: true,
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

    await saveMusicFavorite(TRACK_A, 1000);

    expect(await getAllMusicFavorites()).toEqual({
      'netease+netease-track-1': expect.objectContaining({
        track: expect.objectContaining({
          id: TRACK_A.id,
          source: TRACK_A.source,
          title: TRACK_A.title,
        }),
        savedAt: 1000,
      }),
    });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        'netease+netease-track-1': expect.objectContaining({
          track: expect.objectContaining({
            id: TRACK_A.id,
          }),
        }),
      })
    );

    unsubscribe();
  });

  it('deduplicates recent tracks and keeps the latest play at the front', async () => {
    await saveMusicRecentTrack(TRACK_A, 1000);
    await saveMusicRecentTrack(TRACK_B, 2000);
    await saveMusicRecentTrack(TRACK_A, 3000);

    const recentTracks = await getMusicRecentTracks();

    expect(recentTracks).toHaveLength(2);
    expect(recentTracks.map((track) => track.track.id)).toEqual([
      TRACK_A.id,
      TRACK_B.id,
    ]);
    expect(recentTracks[0]).toEqual(
      expect.objectContaining({
        track: expect.objectContaining({
          id: TRACK_A.id,
        }),
        playedAt: 3000,
      })
    );
  });

  it('stores playback snapshots without coupling to transient stream state', async () => {
    await saveMusicPlayRecord(TRACK_A, {
      playedAt: 4000,
      playTimeMs: 42000,
      durationMs: 188000,
      completed: false,
    });

    expect(await getAllMusicPlayRecords()).toEqual({
      'netease+netease-track-1': expect.objectContaining({
        track: expect.objectContaining({
          id: TRACK_A.id,
          stream: '',
        }),
        playTimeMs: 42000,
        durationMs: 188000,
        completed: false,
        playedAt: 4000,
      }),
    });
  });

  it('clears favorites, recent tracks, and play records independently', async () => {
    await saveMusicFavorite(TRACK_A, 1000);
    await saveMusicRecentTrack(TRACK_B, 2000);
    await saveMusicPlayRecord(TRACK_A, {
      playedAt: 3000,
      playTimeMs: 42000,
      durationMs: 188000,
      completed: false,
    });

    await clearAllMusicFavorites();
    await clearAllMusicRecentTracks();
    await clearAllMusicPlayRecords();

    expect(await getAllMusicFavorites()).toEqual({});
    expect(await getMusicRecentTracks()).toEqual([]);
    expect(await getAllMusicPlayRecords()).toEqual({});
  });
});
