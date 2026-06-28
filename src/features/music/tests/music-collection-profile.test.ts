jest.mock('@/lib/profile/runtime', () => ({
  isDesktopLocalProfileRuntime: jest.fn(() => false),
  shouldUseProfileApiStorage: jest.fn(() => false),
}));

import { shouldUseProfileApiStorage } from '@/lib/profile/runtime';

import type { MusicCollectionSummaryEntity } from '../domain/entities';
import {
  buildMusicCollectionProfileKey,
  clearMusicCollections,
  deleteMusicCollection,
  getMusicSavedCollections,
  saveMusicCollection,
  subscribeToMusicCollectionProfileUpdates,
} from '../services/music-collection-profile';

const mockedShouldUseProfileApiStorage =
  shouldUseProfileApiStorage as jest.MockedFunction<
    typeof shouldUseProfileApiStorage
  >;

const COLLECTION_A: MusicCollectionSummaryEntity = {
  id: '19723756',
  source: 'netease',
  kind: 'rank',
  title: '官方榜单详情',
  coverUrl: 'https://cdn.music.test/toplist.jpg',
  description: 'Toplist Detail',
  trackCount: 10,
  accentColor: '#ff5f6d',
};

const COLLECTION_B: MusicCollectionSummaryEntity = {
  id: '302',
  source: 'netease',
  kind: 'playlist',
  title: 'Search Playlist',
  coverUrl: 'https://cdn.music.test/search-playlist.jpg',
  description: 'Search playlist description',
  trackCount: 24,
  accentColor: '#7b61ff',
};

describe('music collection profile', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockedShouldUseProfileApiStorage.mockReturnValue(false);
  });

  it('persists deduped saved collections and dispatches updates', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToMusicCollectionProfileUpdates(listener);

    await saveMusicCollection(COLLECTION_A, 1000);
    await saveMusicCollection(COLLECTION_B, 2000);
    await saveMusicCollection(COLLECTION_A, 3000);

    expect(await getMusicSavedCollections()).toEqual([
      expect.objectContaining({
        summary: expect.objectContaining({
          id: COLLECTION_A.id,
          kind: COLLECTION_A.kind,
        }),
        savedAt: 3000,
      }),
      expect.objectContaining({
        summary: expect.objectContaining({
          id: COLLECTION_B.id,
        }),
        savedAt: 2000,
      }),
    ]);
    expect(listener).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          summary: expect.objectContaining({
            id: COLLECTION_A.id,
          }),
        }),
      ])
    );

    unsubscribe();
  });

  it('deletes saved collections independently by collection key', async () => {
    await saveMusicCollection(COLLECTION_A, 1000);
    await saveMusicCollection(COLLECTION_B, 2000);

    await deleteMusicCollection(COLLECTION_A.source, COLLECTION_A.id);

    expect(await getMusicSavedCollections()).toEqual([
      expect.objectContaining({
        summary: expect.objectContaining({
          id: COLLECTION_B.id,
        }),
      }),
    ]);
    expect(
      buildMusicCollectionProfileKey(COLLECTION_B.source, COLLECTION_B.id)
    ).toBe('netease+302');
  });

  it('clears all saved collections at once', async () => {
    await saveMusicCollection(COLLECTION_A, 1000);
    await saveMusicCollection(COLLECTION_B, 2000);

    await clearMusicCollections();

    expect(await getMusicSavedCollections()).toEqual([]);
  });
});
