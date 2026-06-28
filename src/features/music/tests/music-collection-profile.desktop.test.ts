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

import type { MusicCollectionSummaryEntity } from '../domain/entities';
import {
  buildMusicCollectionProfileKey,
  deleteMusicCollection,
  getMusicSavedCollections,
  saveMusicCollection,
} from '../services/music-collection-profile';

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

const COLLECTION: MusicCollectionSummaryEntity = {
  id: '19723756',
  source: 'netease',
  kind: 'rank',
  title: '官方榜单详情',
  coverUrl: 'https://cdn.music.test/toplist.jpg',
  description: 'Toplist Detail',
  trackCount: 10,
  accentColor: '#ff5f6d',
};

function setDesktopAuthCookie(username = 'desktop-owner') {
  document.cookie = `auth=${encodeURIComponent(
    JSON.stringify({
      username,
      sessionMode: 'desktop-local',
    })
  )}; path=/`;
}

describe('music collection profile desktop adapter', () => {
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

  it('uses the desktop music profile api for saved collections', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);
    setDesktopAuthCookie();
    mockedFetchRemoteProfileJson.mockResolvedValue([
      {
        summary: COLLECTION,
        savedAt: 1234,
      },
    ]);

    await saveMusicCollection(COLLECTION, 1234);

    expect(mockedPostRemoteProfilePayload).toHaveBeenCalledWith(
      '/music/profile/collections',
      {
        key: buildMusicCollectionProfileKey(COLLECTION.source, COLLECTION.id),
        collection: {
          summary: COLLECTION,
          savedAt: 1234,
        },
      },
      {
        redirectOnUnauthorized: false,
      }
    );
    await expect(getMusicSavedCollections()).resolves.toEqual([
      expect.objectContaining({
        summary: expect.objectContaining({
          id: COLLECTION.id,
          kind: COLLECTION.kind,
        }),
        savedAt: 1234,
      }),
    ]);

    await deleteMusicCollection(COLLECTION.source, COLLECTION.id);

    expect(mockedDeleteRemoteProfileResource).toHaveBeenCalledWith(
      '/music/profile/collections',
      {
        key: buildMusicCollectionProfileKey(COLLECTION.source, COLLECTION.id),
      },
      {
        redirectOnUnauthorized: false,
      }
    );
  });

  it('keeps saved collections local while desktop auth is pending', async () => {
    mockedShouldUseProfileApiStorage.mockReturnValue(true);

    await saveMusicCollection(COLLECTION, 1234);

    await expect(getMusicSavedCollections()).resolves.toEqual([
      expect.objectContaining({
        summary: expect.objectContaining({
          id: COLLECTION.id,
        }),
      }),
    ]);
    expect(mockedFetchRemoteProfileJson).not.toHaveBeenCalled();
    expect(mockedPostRemoteProfilePayload).not.toHaveBeenCalled();
  });
});
