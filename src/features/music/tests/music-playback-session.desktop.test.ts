jest.mock('@/lib/profile/runtime', () => ({
  shouldUseProfileApiStorage: jest.fn(() => false),
}));

jest.mock('@/lib/profile/remote-adapter', () => ({
  fetchRemoteProfileJson: jest.fn(),
  postRemoteProfilePayload: jest.fn(),
}));

import {
  fetchRemoteProfileJson,
  postRemoteProfilePayload,
} from '@/lib/profile/remote-adapter';
import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';

import {
  getMusicPlaybackSession,
  saveMusicPlaybackSession,
} from '../services/music-playback-session';

const mockedShouldUseProfileApiStorage =
  shouldUseProfileApiStorage as jest.MockedFunction<
    typeof shouldUseProfileApiStorage
  >;
const mockedFetchRemoteProfileJson =
  fetchRemoteProfileJson as jest.MockedFunction<typeof fetchRemoteProfileJson>;
const mockedPostRemoteProfilePayload =
  postRemoteProfilePayload as jest.MockedFunction<
    typeof postRemoteProfilePayload
  >;

describe('music playback session desktop adapter', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    jest.clearAllMocks();
    mockedShouldUseProfileApiStorage.mockReturnValue(false);
    mockedFetchRemoteProfileJson.mockResolvedValue({});
    mockedPostRemoteProfilePayload.mockResolvedValue({ ok: true } as Response);
  });

  it('uses the desktop music profile api for playback session snapshots', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    document.cookie = `auth=${encodeURIComponent(
      JSON.stringify({
        username: 'desktop-owner',
        sessionMode: 'desktop-local',
      })
    )}; path=/`;
    mockedFetchRemoteProfileJson.mockResolvedValue({
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
            stream: '',
            playable: true,
          },
        },
      ],
      currentTrackId: '9001',
      positionMs: 42000,
      durationMs: 215000,
      savedAt: 123,
    });

    await saveMusicPlaybackSession({
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
      positionMs: 24000,
      durationMs: 215000,
      savedAt: 1,
    });

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/music/profile/playback-session',
      {
        session: {
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
                stream: '',
                playable: true,
              },
            },
          ],
          currentTrackId: '9001',
          positionMs: 24000,
          durationMs: 215000,
          savedAt: 1,
        },
      },
      {
        redirectOnUnauthorized: false,
      }
    );

    await expect(getMusicPlaybackSession()).resolves.toEqual({
      queue: [
        expect.objectContaining({
          track: expect.objectContaining({
            id: '9001',
          }),
        }),
      ],
      currentTrackId: '9001',
      positionMs: 42000,
      durationMs: 215000,
      savedAt: 123,
    });
    expect(mockedFetchRemoteProfileJson).toHaveBeenCalledWith(
      '/music/profile/playback-session',
      {
        redirectOnUnauthorized: false,
      }
    );
  });

  it('short-circuits remote playback sessions while auth is pending', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);

    await saveMusicPlaybackSession({
      queue: [],
      currentTrackId: null,
      positionMs: 0,
      durationMs: 0,
      savedAt: 0,
    });

    await expect(getMusicPlaybackSession()).resolves.toEqual({
      queue: [],
      currentTrackId: null,
      positionMs: 0,
      durationMs: 0,
      savedAt: 0,
    });
    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();
    expect(mockedPostRemoteProfilePayload).not.toHaveBeenCalled();
  });
});
