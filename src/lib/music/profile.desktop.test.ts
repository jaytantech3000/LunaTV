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
  deleteMusicFavorite,
  getAllMusicFavorites,
  getAllMusicPlayRecords,
  getMusicRecentTracks,
  saveMusicFavorite,
  saveMusicPlayRecord,
} from '@/lib/music/profile';
import { type MusicPlatformKey, type PlayerQueueItem } from '@/lib/music/types';
import {
  deleteRemoteProfileResource,
  fetchRemoteProfileJson,
  postRemoteProfilePayload,
} from '@/lib/profile/remote-adapter';
import {
  isDesktopLocalProfileRuntime,
  shouldUseProfileApiStorage,
} from '@/lib/profile/runtime';

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

function buildMusicProfileKey(
  source: MusicPlatformKey,
  trackId: string
): string {
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
      ...trackA,
      savedAt: 1234,
    };
    mockedFetchRemoteProfileJson.mockResolvedValue({
      [buildMusicProfileKey(trackA.source, trackA.trackId)]: favoriteRecord,
    });

    await saveMusicFavorite(trackA, 1234);

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/music/profile/favorites',
      {
        key: buildMusicProfileKey(trackA.source, trackA.trackId),
        favorite: favoriteRecord,
      }
    );
    await expect(getAllMusicFavorites()).resolves.toEqual({
      [buildMusicProfileKey(trackA.source, trackA.trackId)]:
        expect.objectContaining({
          title: trackA.title,
          savedAt: 1234,
        }),
    });

    await deleteMusicFavorite(trackA.source, trackA.trackId);

    expect(mockedDeleteRemoteProfileResource).toHaveBeenCalledWith(
      '/music/profile/favorites',
      {
        key: buildMusicProfileKey(trackA.source, trackA.trackId),
      }
    );
  });

  it('migrates legacy desktop music recent tracks before reading from the api', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();

    const legacyTrack = {
      ...trackA,
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
        trackId: trackA.trackId,
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
      ...trackA,
      playedAt: 5566,
      playTimeSec: 42,
      durationSec: 188,
      completed: false,
    };
    mockedFetchRemoteProfileJson.mockResolvedValue({
      [buildMusicProfileKey(trackA.source, trackA.trackId)]: playRecord,
    });

    await saveMusicPlayRecord(trackA, {
      playedAt: 5566,
      playTimeSec: 42,
      durationSec: 188,
      completed: false,
    });

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/music/profile/play-records',
      {
        key: buildMusicProfileKey(trackA.source, trackA.trackId),
        record: playRecord,
      }
    );
    await expect(getAllMusicPlayRecords()).resolves.toEqual({
      [buildMusicProfileKey(trackA.source, trackA.trackId)]:
        expect.objectContaining({
          playTimeSec: 42,
          durationSec: 188,
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
