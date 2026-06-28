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
import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';

import {
  clearMusicSearchHistory,
  deleteMusicSearchHistoryEntry,
  getMusicSearchHistory,
  saveMusicSearchHistoryEntry,
} from '../services/music-search-history';

const mockedShouldUseProfileApiStorage =
  shouldUseProfileApiStorage as jest.MockedFunction<
    typeof shouldUseProfileApiStorage
  >;
const mockedDeleteRemoteProfileResource =
  deleteRemoteProfileResource as jest.MockedFunction<
    typeof deleteRemoteProfileResource
  >;
const mockedFetchRemoteProfileJson =
  fetchRemoteProfileJson as jest.MockedFunction<typeof fetchRemoteProfileJson>;
const mockedPostRemoteProfilePayload =
  postRemoteProfilePayload as jest.MockedFunction<
    typeof postRemoteProfilePayload
  >;

function setDesktopAuthCookie(username = 'desktop-owner') {
  document.cookie = `auth=${encodeURIComponent(
    JSON.stringify({
      username,
      sessionMode: 'desktop-local',
    })
  )}; path=/`;
}

describe('music search history desktop adapter', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    jest.clearAllMocks();
    mockedShouldUseProfileApiStorage.mockReturnValue(false);
    mockedFetchRemoteProfileJson.mockResolvedValue([]);
    mockedPostRemoteProfilePayload.mockResolvedValue({ ok: true } as Response);
    mockedDeleteRemoteProfileResource.mockResolvedValue({
      ok: true,
    } as Response);
  });

  it('uses the desktop music profile api for music search history', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();
    mockedFetchRemoteProfileJson.mockResolvedValue(['Demo Query']);

    await saveMusicSearchHistoryEntry('Demo Query');

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/music/profile/search-history',
      {
        query: 'Demo Query',
      },
      {
        redirectOnUnauthorized: false,
      }
    );
    await expect(getMusicSearchHistory()).resolves.toEqual(['Demo Query']);
    expect(mockedFetchRemoteProfileJson).toHaveBeenCalledWith(
      '/music/profile/search-history',
      {
        redirectOnUnauthorized: false,
      }
    );

    await deleteMusicSearchHistoryEntry('Demo Query');

    expect(mockedDeleteRemoteProfileResource).toHaveBeenNthCalledWith(
      1,
      '/music/profile/search-history',
      {
        query: 'Demo Query',
      },
      {
        redirectOnUnauthorized: false,
      }
    );

    await clearMusicSearchHistory();

    expect(mockedDeleteRemoteProfileResource).toHaveBeenNthCalledWith(
      2,
      '/music/profile/search-history',
      undefined,
      {
        redirectOnUnauthorized: false,
      }
    );
  });

  it('migrates legacy desktop music search history before reading from the api', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();
    localStorage.setItem(
      'moontv_music_search_history',
      JSON.stringify(['Legacy Query', 'Older Query'])
    );

    let searchHistoryFetchCount = 0;
    mockedFetchRemoteProfileJson.mockImplementation(async (path) => {
      if (path === '/music/profile/search-history') {
        searchHistoryFetchCount += 1;
        return searchHistoryFetchCount === 1
          ? []
          : ['Legacy Query', 'Older Query'];
      }

      return [];
    });

    await expect(getMusicSearchHistory()).resolves.toEqual([
      'Legacy Query',
      'Older Query',
    ]);

    expect(mockedPostRemoteProfilePayload).toHaveBeenNthCalledWith(
      1,
      '/music/profile/search-history',
      {
        query: 'Older Query',
      },
      {
        redirectOnUnauthorized: false,
      }
    );
    expect(mockedPostRemoteProfilePayload).toHaveBeenNthCalledWith(
      2,
      '/music/profile/search-history',
      {
        query: 'Legacy Query',
      },
      {
        redirectOnUnauthorized: false,
      }
    );
    expect(
      JSON.parse(localStorage.getItem('moontv_music_search_history') || '[]')
    ).toEqual(['Legacy Query', 'Older Query']);
  });

  it('short-circuits remote music search history while auth is pending', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    localStorage.setItem(
      'moontv_music_search_history',
      JSON.stringify(['Pending Query'])
    );

    await saveMusicSearchHistoryEntry('Fresh Query');

    await expect(getMusicSearchHistory()).resolves.toEqual([
      'Fresh Query',
      'Pending Query',
    ]);
    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();
    expect(mockedPostRemoteProfilePayload).not.toHaveBeenCalled();
  });
});
