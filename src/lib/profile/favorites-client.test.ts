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
  clearAllFavorites,
  deleteFavorite,
  getAllFavorites,
  isFavorited,
  saveFavorite,
} from '@/lib/profile/favorites-client';
import {
  deleteRemoteProfileResource,
  fetchRemoteProfileJson,
  postRemoteProfilePayload,
} from '@/lib/profile/remote-adapter';
import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';
import { isDesktopLocalProfileRuntime } from '@/lib/profile/runtime';

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

function setDesktopAuthCookie(username = 'admin') {
  document.cookie = `auth-info=${encodeURIComponent(
    JSON.stringify({
      username,
      sessionMode: 'desktop-local',
    })
  )}; path=/`;
}

describe('favorites client', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    document.cookie =
      'auth-info=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    jest.clearAllMocks();
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(false);
    mockedShouldUseProfileApiStorage.mockReturnValue(false);
    mockedFetchRemoteProfileJson.mockResolvedValue({});
    mockedPostRemoteProfilePayload.mockResolvedValue({ ok: true } as Response);
    mockedDeleteRemoteProfileResource.mockResolvedValue({
      ok: true,
    } as Response);
  });

  it('reads, writes, checks, and clears favorites in web local fallback mode', async () => {
    await saveFavorite('demo', '1', {
      title: 'Demo',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      total_episodes: 12,
      save_time: 1,
    });

    expect(await getAllFavorites()).toEqual({
      'demo+1': expect.objectContaining({
        title: 'Demo',
      }),
    });
    await expect(isFavorited('demo', '1')).resolves.toBe(true);

    await deleteFavorite('demo', '1');

    await expect(isFavorited('demo', '1')).resolves.toBe(false);

    await saveFavorite('demo', '1', {
      title: 'Demo',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      total_episodes: 12,
      save_time: 2,
    });
    await clearAllFavorites();

    expect(await getAllFavorites()).toEqual({});
    expect(mockedPostRemoteProfilePayload).not.toHaveBeenCalled();
  });

  it('uses the local service API in desktop local mode', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();

    const remoteFavorite = {
      title: 'Remote Favorite',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      total_episodes: 12,
      save_time: 1,
    };
    mockedFetchRemoteProfileJson.mockResolvedValue({
      'demo+1': remoteFavorite,
    });

    await saveFavorite('demo', '1', remoteFavorite);

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith('/favorites', {
      key: 'demo+1',
      favorite: remoteFavorite,
    });
    await expect(getAllFavorites()).resolves.toEqual({
      'demo+1': expect.objectContaining({
        title: 'Remote Favorite',
      }),
    });
    await expect(isFavorited('demo', '1')).resolves.toBe(true);
    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();

    await clearAllFavorites();

    expect(mockedDeleteRemoteProfileResource).toHaveBeenLastCalledWith(
      '/favorites'
    );
    await expect(getAllFavorites()).resolves.toEqual({});
  });

  it('skips favorite api reads while desktop local auth is still pending', async () => {
    mockedIsDesktopLocalProfileRuntime.mockReturnValue(true);
    mockedShouldUseProfileApiStorage.mockReturnValue(true);

    await expect(getAllFavorites()).resolves.toEqual({});
    await expect(isFavorited('demo', '1')).resolves.toBe(false);
    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();
  });

  it('shares an in-flight cold favorites read', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie('remote-owner');

    let resolveFetch:
      | ((favorites: Record<string, unknown>) => void)
      | undefined;
    mockedFetchRemoteProfileJson.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const firstRead = getAllFavorites();
    const secondRead = getAllFavorites();

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(mockedFetchRemoteProfileJson).toHaveBeenCalledTimes(1);

    resolveFetch?.({});

    await expect(Promise.all([firstRead, secondRead])).resolves.toEqual([
      {},
      {},
    ]);
  });

  it('does not let an older favorites read overwrite a mutation snapshot', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie('remote-owner');
    const favorite = {
      title: 'Newer Favorite',
      source_name: 'Demo Source',
      year: '2026',
      cover: 'cover.jpg',
      total_episodes: 12,
      save_time: 2,
    };
    let resolveFetch:
      | ((favorites: Record<string, unknown>) => void)
      | undefined;
    mockedFetchRemoteProfileJson.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const readPromise = getAllFavorites();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await saveFavorite('demo', '1', favorite);

    resolveFetch?.({});
    await expect(readPromise).resolves.toEqual({});
    await expect(isFavorited('demo', '1')).resolves.toBe(true);
  });
});
