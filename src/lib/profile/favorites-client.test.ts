jest.mock('@/lib/profile/runtime', () => ({
  shouldUseRemoteProfileStorage: jest.fn(() => false),
}));

import {
  clearAllFavorites,
  deleteFavorite,
  getAllFavorites,
  isFavorited,
  saveFavorite,
} from '@/lib/profile/favorites-client';

describe('favorites client', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads, writes, checks, and clears favorites in local mode', async () => {
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
  });
});
