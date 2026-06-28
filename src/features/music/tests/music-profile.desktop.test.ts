jest.mock('@/lib/profile/runtime', () => ({
  isDesktopLocalProfileRuntime: jest.fn(() => false),
  shouldUseProfileApiStorage: jest.fn(() => false),
}));

jest.mock('@/lib/profile/remote-adapter', () => ({
  deleteRemoteProfileResource: jest.fn(),
  fetchRemoteProfileJson: jest.fn(),
  isUnauthorizedRemoteProfileRequestError: jest.fn(() => false),
  postRemoteProfilePayload: jest.fn(),
  wasRemoteProfileRequestRedirectedToLogin: jest.fn(() => false),
}));

import {
  deleteRemoteProfileResource,
  fetchRemoteProfileJson,
  postRemoteProfilePayload,
} from '@/lib/profile/remote-adapter';
import {
  isDesktopLocalProfileRuntime,
  shouldUseProfileApiStorage,
} from '@/lib/profile/runtime';

import type { MusicTrackEntity } from '../domain/entities';
import {
  deleteMusicFavorite,
  getAllMusicFavorites,
  getAllMusicPlayRecords,
  getMusicRecentTracks,
  saveMusicFavorite,
  saveMusicPlayRecord,
} from '../services/music-profile';

const mockedDeleteRemoteProfileResource =
  deleteRemoteProfileResource as jest.MockedFunction<
    typeof deleteRemoteProfileResource
  >;
const mockedFetchRemoteProfileJson =
  fetchRemoteProfileJson as jest.MockedFunction<typeof fetchRemoteProfileJson>;
const mockedIsDesktopLocalProfileRuntime =
  isDesktopLocalProfileRuntime as jest.MockedFunction<
    typeof isDesktopLocalProfileRuntime
  >;
const mockedShouldUseProfileApiStorage =
  shouldUseProfileApiStorage as jest.MockedFunction<
    typeof shouldUseProfileApiStorage
  >;
const mockedPostRemoteProfilePayload =
  postRemoteProfilePayload as jest.MockedFunction<
    typeof postRemoteProfilePayload
  >;

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

function setDesktopAuthCookie(
  username = 'desktop-owner',
  sessionMode = 'desktop-local'
) {
  document.cookie = `auth=${encodeURIComponent(
    JSON.stringify({
      username,
      sessionMode,
    })
  )}; path=/`;
}

function buildMusicProfileKey(source: string, trackId: string): string {
  return `${source}+${trackId}`;
}

describe('music profile desktop adapter', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    jest.clearAllMocks();
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(false);
    mockedShouldUseProfileApiStorage.mockReturnValue(false);
    mockedFetchRemoteProfileJson.mockResolvedValue({});
    mockedPostRemoteProfilePayload.mockResolvedValue({ ok: true } as Response);
    mockedDeleteRemoteProfileResource.mockResolvedValue({
      ok: true,
    } as Response);
  });

  it('uses the local service api for desktop music favorites', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();

    const favoriteRecord = {
      track: TRACK_A,
      savedAt: 1234,
    };
    mockedFetchRemoteProfileJson.mockResolvedValue({
      [buildMusicProfileKey(TRACK_A.source, TRACK_A.id)]: favoriteRecord,
    });

    await saveMusicFavorite(TRACK_A, 1234);

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/music/profile/favorites',
      {
        key: buildMusicProfileKey(TRACK_A.source, TRACK_A.id),
        favorite: favoriteRecord,
      }
    );
    await expect(getAllMusicFavorites()).resolves.toEqual({
      [buildMusicProfileKey(TRACK_A.source, TRACK_A.id)]:
        expect.objectContaining({
          track: expect.objectContaining({
            id: TRACK_A.id,
            title: TRACK_A.title,
          }),
          savedAt: 1234,
        }),
    });

    await deleteMusicFavorite(TRACK_A.source, TRACK_A.id);

    expect(mockedDeleteRemoteProfileResource).toHaveBeenCalledWith(
      '/music/profile/favorites',
      {
        key: buildMusicProfileKey(TRACK_A.source, TRACK_A.id),
      }
    );
  });

  it('migrates legacy desktop music recent tracks before reading from the api', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();

    const legacyTrack = {
      track: TRACK_A,
      playedAt: 2233,
    };
    localStorage.setItem(
      'moontv_music_recent_tracks',
      JSON.stringify([legacyTrack])
    );

    let fetchCount = 0;
    mockedFetchRemoteProfileJson.mockImplementation(async (path) => {
      if (path === '/music/profile/recent-tracks') {
        fetchCount += 1;
        return fetchCount === 1 ? [] : [legacyTrack];
      }

      return {};
    });

    await expect(getMusicRecentTracks()).resolves.toEqual([
      expect.objectContaining({
        track: expect.objectContaining({
          id: TRACK_A.id,
        }),
        playedAt: 2233,
      }),
    ]);

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/music/profile/recent-tracks',
      {
        track: legacyTrack,
      },
      {
        redirectOnUnauthorized: false,
      }
    );
  });

  it('uses the local service api for desktop music play records', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();

    const playRecord = {
      track: TRACK_A,
      playedAt: 5566,
      playTimeMs: 42000,
      durationMs: 188000,
      completed: false,
    };
    mockedFetchRemoteProfileJson.mockResolvedValue({
      [buildMusicProfileKey(TRACK_A.source, TRACK_A.id)]: playRecord,
    });

    await saveMusicPlayRecord(TRACK_A, {
      playedAt: 5566,
      playTimeMs: 42000,
      durationMs: 188000,
      completed: false,
    });

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/music/profile/play-records',
      {
        key: buildMusicProfileKey(TRACK_A.source, TRACK_A.id),
        record: playRecord,
      }
    );
    await expect(getAllMusicPlayRecords()).resolves.toEqual({
      [buildMusicProfileKey(TRACK_A.source, TRACK_A.id)]:
        expect.objectContaining({
          playTimeMs: 42000,
          durationMs: 188000,
        }),
    });
  });

  it('skips desktop music api reads while auth is still pending', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);

    await expect(getAllMusicFavorites()).resolves.toEqual({});
    await expect(getMusicRecentTracks()).resolves.toEqual([]);
    await expect(getAllMusicPlayRecords()).resolves.toEqual({});

    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();
  });
});
