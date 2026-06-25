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
import { isDesktopLocalProfileRuntime } from '@/lib/profile/runtime';
import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
} from '@/lib/profile/search-history-client';

const mockedIsDesktopLocalProfileRuntime =
  isDesktopLocalProfileRuntime as jest.MockedFunction<
    typeof isDesktopLocalProfileRuntime
  >;
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

describe('search history client', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    jest.clearAllMocks();
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(false);
    mockedShouldUseProfileApiStorage.mockReturnValue(false);
    mockedFetchRemoteProfileJson.mockResolvedValue([]);
    mockedPostRemoteProfilePayload.mockResolvedValue({ ok: true } as Response);
    mockedDeleteRemoteProfileResource.mockResolvedValue({
      ok: true,
    } as Response);
  });

  it('reads, writes, and clears search history in web local fallback mode', async () => {
    await addSearchHistory(' Demo Query ');

    expect(await getSearchHistory()).toEqual([
      expect.objectContaining({
        keyword: 'Demo Query',
        rawValue: 'Demo Query',
      }),
    ]);

    await deleteSearchHistory('Demo Query');
    expect(await getSearchHistory()).toEqual([]);

    await addSearchHistory('Legacy Query', 'legacy');
    await clearSearchHistory();

    expect(await getSearchHistory()).toEqual([]);
    expect(mockedPostRemoteProfilePayload).not.toHaveBeenCalled();
  });

  it('uses the local service API in desktop local mode', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();
    mockedFetchRemoteProfileJson.mockResolvedValue(['Demo Query']);

    await addSearchHistory('Demo Query');

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/searchhistory',
      {
        keyword: 'Demo Query',
      },
      {
        redirectOnUnauthorized: false,
      }
    );
    await expect(getSearchHistory()).resolves.toEqual([
      expect.objectContaining({
        keyword: 'Demo Query',
        rawValue: 'Demo Query',
      }),
    ]);
    expect(mockedFetchRemoteProfileJson).toHaveBeenCalledWith(
      '/searchhistory',
      {
        redirectOnUnauthorized: false,
      }
    );

    await deleteSearchHistory('Demo Query');

    expect(mockedDeleteRemoteProfileResource).toHaveBeenNthCalledWith(
      1,
      '/searchhistory',
      {
        keyword: 'Demo Query',
      },
      {
        redirectOnUnauthorized: false,
      }
    );

    await clearSearchHistory();

    expect(mockedDeleteRemoteProfileResource).toHaveBeenNthCalledWith(
      2,
      '/searchhistory',
      undefined,
      {
        redirectOnUnauthorized: false,
      }
    );
  });

  it('migrates legacy desktop local search history before reading from the API', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();
    localStorage.setItem(
      'moontv_search_history',
      JSON.stringify(['Legacy Query', 'Older Query'])
    );

    let searchHistoryFetchCount = 0;
    mockedFetchRemoteProfileJson.mockImplementation(async (path) => {
      if (path === '/searchhistory') {
        searchHistoryFetchCount += 1;
        return searchHistoryFetchCount === 1
          ? []
          : ['Legacy Query', 'Older Query'];
      }

      return {};
    });

    await expect(getSearchHistory()).resolves.toEqual([
      expect.objectContaining({
        keyword: 'Legacy Query',
        rawValue: 'Legacy Query',
      }),
      expect.objectContaining({
        keyword: 'Older Query',
        rawValue: 'Older Query',
      }),
    ]);

    expect(mockedPostRemoteProfilePayload).toHaveBeenNthCalledWith(
      1,
      '/searchhistory',
      {
        keyword: 'Older Query',
      },
      {
        redirectOnUnauthorized: false,
      }
    );
    expect(mockedPostRemoteProfilePayload).toHaveBeenNthCalledWith(
      2,
      '/searchhistory',
      {
        keyword: 'Legacy Query',
      },
      {
        redirectOnUnauthorized: false,
      }
    );
    expect(localStorage.getItem('moontv_search_history')).toBeNull();
  });
});
