jest.useFakeTimers();

const mockDispatchProfileCacheUpdate = jest.fn<void, [string, unknown]>();
const mockSubscribeToProfileCacheUpdates = jest.fn<
  () => void,
  [string, (data: unknown) => void]
>(() => () => undefined);
const mockEnsureDesktopLocalProfileStoreHydrated = jest.fn<Promise<void>, []>();
const mockFetchRemoteProfileJson = jest.fn<Promise<unknown>, [string]>();
const mockShouldUseProfileApiStorage = jest.fn<boolean, []>(() => false);
const mockDispatchSearchHistoryUpdated = jest.fn<void, [string[]]>();
const mockGetCacheStatus = jest.fn<
  {
    hasPlayRecords: boolean;
    hasFavorites: boolean;
    hasFollowRecords: boolean;
    hasSearchHistory: boolean;
    hasSkipConfigs: boolean;
  },
  []
>(() => ({
  hasPlayRecords: false,
  hasFavorites: false,
  hasFollowRecords: false,
  hasSearchHistory: false,
  hasSkipConfigs: false,
}));
const mockCachePlayRecords = jest.fn<void, [unknown]>();
const mockCacheFavorites = jest.fn<void, [unknown]>();
const mockCacheFollowRecords = jest.fn<void, [unknown]>();
const mockCacheSearchHistory = jest.fn<void, [string[]]>();
const mockCacheSkipConfigs = jest.fn<void, [unknown]>();
const mockClearExpiredCaches = jest.fn<void, []>();
const mockClearUserCache = jest.fn<void, []>();

jest.mock('@/lib/profile/cache', () => ({
  dispatchProfileCacheUpdate: (
    ...args: Parameters<typeof mockDispatchProfileCacheUpdate>
  ) => mockDispatchProfileCacheUpdate(...args),
  subscribeToProfileCacheUpdates: (
    ...args: Parameters<typeof mockSubscribeToProfileCacheUpdates>
  ) => mockSubscribeToProfileCacheUpdates(...args),
}));

jest.mock('@/lib/profile/desktop-local-migration', () => ({
  ensureDesktopLocalProfileStoreHydrated: (
    ...args: Parameters<typeof mockEnsureDesktopLocalProfileStoreHydrated>
  ) => mockEnsureDesktopLocalProfileStoreHydrated(...args),
}));

jest.mock('@/lib/profile/hybrid-cache', () => ({
  cacheManager: {
    cachePlayRecords: (...args: Parameters<typeof mockCachePlayRecords>) =>
      mockCachePlayRecords(...args),
    cacheFavorites: (...args: Parameters<typeof mockCacheFavorites>) =>
      mockCacheFavorites(...args),
    cacheFollowRecords: (...args: Parameters<typeof mockCacheFollowRecords>) =>
      mockCacheFollowRecords(...args),
    cacheSearchHistory: (...args: Parameters<typeof mockCacheSearchHistory>) =>
      mockCacheSearchHistory(...args),
    cacheSkipConfigs: (...args: Parameters<typeof mockCacheSkipConfigs>) =>
      mockCacheSkipConfigs(...args),
    clearExpiredCaches: (...args: Parameters<typeof mockClearExpiredCaches>) =>
      mockClearExpiredCaches(...args),
    clearUserCache: (...args: Parameters<typeof mockClearUserCache>) =>
      mockClearUserCache(...args),
  },
  getCacheStatus: (...args: Parameters<typeof mockGetCacheStatus>) =>
    mockGetCacheStatus(...args),
}));

jest.mock('@/lib/profile/remote-adapter', () => ({
  deleteRemoteProfileResource: jest.fn(),
  fetchRemoteProfileJson: (
    ...args: Parameters<typeof mockFetchRemoteProfileJson>
  ) => mockFetchRemoteProfileJson(...args),
  isUnauthorizedRemoteProfileRequestError: jest.fn(() => false),
  postRemoteProfilePayload: jest.fn(),
  wasRemoteProfileRequestRedirectedToLogin: jest.fn(() => false),
}));

jest.mock('@/lib/profile/runtime', () => ({
  isDesktopLocalProfileRuntime: jest.fn(() => false),
  shouldUseProfileApiStorage: (
    ...args: Parameters<typeof mockShouldUseProfileApiStorage>
  ) => mockShouldUseProfileApiStorage(...args),
}));

jest.mock('@/lib/profile/search-history-client', () => ({
  addSearchHistory: jest.fn(),
  clearSearchHistory: jest.fn(),
  deleteSearchHistory: jest.fn(),
  dispatchSearchHistoryUpdated: (
    ...args: Parameters<typeof mockDispatchSearchHistoryUpdated>
  ) => mockDispatchSearchHistoryUpdated(...args),
  getSearchHistory: jest.fn(),
}));

import { refreshAllCache } from '@/lib/profile/client';

describe('profile client cache refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShouldUseProfileApiStorage.mockReturnValue(false);
    mockEnsureDesktopLocalProfileStoreHydrated.mockResolvedValue(undefined);
    mockFetchRemoteProfileJson.mockReset();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('skips the api refresh path when profile api storage is disabled', async () => {
    await refreshAllCache();

    expect(mockShouldUseProfileApiStorage).toHaveBeenCalledTimes(1);
    expect(mockEnsureDesktopLocalProfileStoreHydrated).not.toHaveBeenCalled();
    expect(mockFetchRemoteProfileJson).not.toHaveBeenCalled();
    expect(mockCachePlayRecords).not.toHaveBeenCalled();
    expect(mockCacheFavorites).not.toHaveBeenCalled();
    expect(mockCacheFollowRecords).not.toHaveBeenCalled();
    expect(mockCacheSearchHistory).not.toHaveBeenCalled();
    expect(mockCacheSkipConfigs).not.toHaveBeenCalled();
    expect(mockDispatchProfileCacheUpdate).not.toHaveBeenCalled();
    expect(mockDispatchSearchHistoryUpdated).not.toHaveBeenCalled();
  });

  it('hydrates the local store and refreshes all profile domains through the api path', async () => {
    mockShouldUseProfileApiStorage.mockReturnValue(true);

    const playRecords = {
      'demo+1': {
        title: 'Demo',
      },
    };
    const favorites = {
      'demo+1': {
        title: 'Favorite Demo',
      },
    };
    const follows = {
      'demo+1': {
        title: 'Follow Demo',
      },
    };
    const searchHistory = ['demo::movie'];
    const skipConfigs = {
      'demo+1': {
        enable: true,
      },
    };

    mockFetchRemoteProfileJson
      .mockResolvedValueOnce(playRecords)
      .mockResolvedValueOnce(favorites)
      .mockResolvedValueOnce(follows)
      .mockResolvedValueOnce(searchHistory)
      .mockResolvedValueOnce(skipConfigs);

    await refreshAllCache();

    expect(mockEnsureDesktopLocalProfileStoreHydrated).toHaveBeenCalledTimes(1);
    expect(
      mockEnsureDesktopLocalProfileStoreHydrated.mock.invocationCallOrder[0]
    ).toBeLessThan(mockFetchRemoteProfileJson.mock.invocationCallOrder[0]);
    expect(mockFetchRemoteProfileJson.mock.calls).toEqual([
      ['/playrecords'],
      ['/favorites'],
      ['/follows'],
      ['/searchhistory'],
      ['/skipconfigs'],
    ]);

    expect(mockCachePlayRecords).toHaveBeenCalledWith(playRecords);
    expect(mockCacheFavorites).toHaveBeenCalledWith(favorites);
    expect(mockCacheFollowRecords).toHaveBeenCalledWith(follows);
    expect(mockCacheSearchHistory).toHaveBeenCalledWith(searchHistory);
    expect(mockCacheSkipConfigs).toHaveBeenCalledWith(skipConfigs);

    expect(mockDispatchProfileCacheUpdate).toHaveBeenCalledWith(
      'playRecordsUpdated',
      playRecords
    );
    expect(mockDispatchProfileCacheUpdate).toHaveBeenCalledWith(
      'favoritesUpdated',
      favorites
    );
    expect(mockDispatchProfileCacheUpdate).toHaveBeenCalledWith(
      'followRecordsUpdated',
      follows
    );
    expect(mockDispatchProfileCacheUpdate).toHaveBeenCalledWith(
      'skipConfigsUpdated',
      skipConfigs
    );
    expect(mockDispatchSearchHistoryUpdated).toHaveBeenCalledWith(
      searchHistory
    );
  });
});
