jest.mock('@/lib/profile/runtime', () => ({
  isDesktopLocalProfileRuntime: jest.fn(() => false),
  shouldUseProfileApiStorage: jest.fn(() => false),
}));

import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';

import {
  clearMusicSearchHistory,
  deleteMusicSearchHistoryEntry,
  getMusicSearchHistory,
  MUSIC_SEARCH_HISTORY_LIMIT,
  saveMusicSearchHistoryEntry,
  subscribeToMusicSearchHistoryUpdates,
} from '../services/music-search-history';

const mockedShouldUseProfileApiStorage =
  shouldUseProfileApiStorage as jest.MockedFunction<
    typeof shouldUseProfileApiStorage
  >;

describe('music search history', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockedShouldUseProfileApiStorage.mockReturnValue(false);
  });

  it('persists deduped music search history and dispatches updates', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToMusicSearchHistoryUpdates(listener);

    await saveMusicSearchHistoryEntry(' Hello ');
    await saveMusicSearchHistoryEntry('World');
    await saveMusicSearchHistoryEntry('Hello');

    expect(await getMusicSearchHistory()).toEqual(['Hello', 'World']);
    expect(listener).toHaveBeenLastCalledWith(['Hello', 'World']);

    unsubscribe();
  });

  it('limits, deletes, and clears local music search history', async () => {
    for (let index = 0; index < MUSIC_SEARCH_HISTORY_LIMIT + 2; index += 1) {
      await saveMusicSearchHistoryEntry(`Query ${index}`);
    }

    const limitedHistory = await getMusicSearchHistory();

    expect(limitedHistory).toHaveLength(MUSIC_SEARCH_HISTORY_LIMIT);
    expect(limitedHistory[0]).toBe(`Query ${MUSIC_SEARCH_HISTORY_LIMIT + 1}`);
    expect(limitedHistory.at(-1)).toBe('Query 2');

    await deleteMusicSearchHistoryEntry('Query 10');
    expect(await getMusicSearchHistory()).not.toContain('Query 10');

    await clearMusicSearchHistory();
    expect(await getMusicSearchHistory()).toEqual([]);
  });
});
