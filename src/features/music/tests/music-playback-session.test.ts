jest.mock('@/lib/profile/runtime', () => ({
  shouldUseProfileApiStorage: jest.fn(() => false),
}));

import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';

import {
  buildMusicPlaybackSessionSnapshot,
  getMusicPlaybackSession,
  saveMusicPlaybackSession,
} from '../services/music-playback-session';

const mockedShouldUseProfileApiStorage =
  shouldUseProfileApiStorage as jest.MockedFunction<
    typeof shouldUseProfileApiStorage
  >;

describe('music playback session', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockedShouldUseProfileApiStorage.mockReturnValue(false);
  });

  it('sanitizes invalid playback session payloads back to empty state', async () => {
    localStorage.setItem(
      'moontv_music_playback_session',
      JSON.stringify({
        queue: [
          {
            queueId: 'bad',
            track: {
              id: '',
              source: 'netease',
            },
          },
        ],
        currentTrackId: 'missing',
        positionMs: -10,
        durationMs: 'oops',
      })
    );

    await expect(getMusicPlaybackSession()).resolves.toEqual({
      queue: [],
      currentTrackId: null,
      positionMs: 0,
      durationMs: 0,
      savedAt: 0,
    });
  });

  it('persists queue snapshots without stream urls', async () => {
    const snapshot = buildMusicPlaybackSessionSnapshot({
      queue: [
        {
          queueId: 'q1',
          addedAt: 1,
          fromContext: 'featured',
          track: {
            id: '9001',
            source: 'netease',
            title: 'Playable Track',
            artists: ['Artist A'],
            album: 'Album A',
            coverUrl: 'https://cdn.music.test/a.jpg',
            durationMs: 215000,
            stream: '/api/music/stream?source=netease&id=9001',
            playable: true,
          },
        },
      ],
      currentTrackId: '9001',
      positionMs: 42000,
      durationMs: 215000,
      savedAt: 1,
    });

    await saveMusicPlaybackSession(snapshot);

    await expect(getMusicPlaybackSession()).resolves.toEqual({
      ...snapshot,
      queue: [
        expect.objectContaining({
          track: expect.objectContaining({
            id: '9001',
            stream: '',
          }),
        }),
      ],
    });
  });
});
