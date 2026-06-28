jest.mock('../services/music-collection-profile', () => ({
  buildMusicCollectionProfileKey: jest.fn(
    (source: string, id: string) => `${source}+${id}`
  ),
  clearMusicCollections: jest.fn(),
  deleteMusicCollection: jest.fn(),
  getMusicSavedCollections: jest.fn(),
  saveMusicCollection: jest.fn(),
}));

jest.mock('../services/music-profile', () => ({
  buildMusicProfileKey: jest.fn((source: string, id: string) => `${source}+${id}`),
  clearAllMusicFavorites: jest.fn(),
  clearAllMusicPlayRecords: jest.fn(),
  clearAllMusicRecentTracks: jest.fn(),
  deleteMusicFavorite: jest.fn(),
  getAllMusicFavorites: jest.fn(),
  getAllMusicPlayRecords: jest.fn(),
  getMusicRecentTracks: jest.fn(),
  saveMusicFavorite: jest.fn(),
  saveMusicRecentTrack: jest.fn(),
}));

jest.mock(
  '../services/music-liked-tracks',
  () => ({
    likeMusicTrack: jest.fn(),
    listMusicLikedTracks: jest.fn(),
    unlikeMusicTrack: jest.fn(),
  })
);

jest.mock('../services/music-recent-tracks', () => ({
  listMusicRecentTracks: jest.fn(),
  reportMusicTrackPlayed: jest.fn(),
}));

jest.mock(
  '../services/music-account-playlists',
  () => ({
    subscribeMusicAccountPlaylist: jest.fn(),
    unsubscribeMusicAccountPlaylist: jest.fn(),
  })
);

import {
  clearMusicCollections,
  getMusicSavedCollections,
  saveMusicCollection,
} from '../services/music-collection-profile';
import {
  buildMusicProfileKey,
  deleteMusicFavorite,
  getAllMusicFavorites,
  getAllMusicPlayRecords,
  getMusicRecentTracks,
  saveMusicRecentTrack,
  saveMusicFavorite,
} from '../services/music-profile';
import {
  likeMusicTrack,
  listMusicLikedTracks,
  unlikeMusicTrack,
} from '../services/music-liked-tracks';
import {
  listMusicRecentTracks,
  reportMusicTrackPlayed,
} from '../services/music-recent-tracks';
import {
  subscribeMusicAccountPlaylist,
  unsubscribeMusicAccountPlaylist,
} from '../services/music-account-playlists';
import { useMusicAccountStore } from '../state/music-account-store';
import { useMusicLibraryStore } from '../state/music-library-store';
import type {
  MusicCollectionSummaryEntity,
  MusicTrackEntity,
} from '../domain/entities';
import type { SavedMusicCollectionRecord } from '../services/music-collection-profile';
import type {
  MusicFavoriteRecord,
  MusicPlayRecord,
  MusicRecentTrackRecord,
} from '../services/music-profile';

const mockedBuildMusicProfileKey =
  buildMusicProfileKey as jest.MockedFunction<typeof buildMusicProfileKey>;
const mockedDeleteMusicFavorite =
  deleteMusicFavorite as jest.MockedFunction<typeof deleteMusicFavorite>;
const mockedClearMusicCollections =
  clearMusicCollections as jest.MockedFunction<typeof clearMusicCollections>;
const mockedGetAllMusicFavorites =
  getAllMusicFavorites as jest.MockedFunction<typeof getAllMusicFavorites>;
const mockedGetAllMusicPlayRecords =
  getAllMusicPlayRecords as jest.MockedFunction<typeof getAllMusicPlayRecords>;
const mockedGetMusicLikedTracks =
  listMusicLikedTracks as jest.MockedFunction<typeof listMusicLikedTracks>;
const mockedGetMusicRecentTracks =
  getMusicRecentTracks as jest.MockedFunction<typeof getMusicRecentTracks>;
const mockedListMusicRecentTracks =
  listMusicRecentTracks as jest.MockedFunction<typeof listMusicRecentTracks>;
const mockedGetMusicSavedCollections =
  getMusicSavedCollections as jest.MockedFunction<typeof getMusicSavedCollections>;
const mockedLikeMusicTrack =
  likeMusicTrack as jest.MockedFunction<typeof likeMusicTrack>;
const mockedReportMusicTrackPlayed =
  reportMusicTrackPlayed as jest.MockedFunction<typeof reportMusicTrackPlayed>;
const mockedSaveMusicCollection =
  saveMusicCollection as jest.MockedFunction<typeof saveMusicCollection>;
const mockedSaveMusicFavorite =
  saveMusicFavorite as jest.MockedFunction<typeof saveMusicFavorite>;
const mockedSaveMusicRecentTrack =
  saveMusicRecentTrack as jest.MockedFunction<typeof saveMusicRecentTrack>;
const mockedSubscribeMusicAccountPlaylist =
  subscribeMusicAccountPlaylist as jest.MockedFunction<
    typeof subscribeMusicAccountPlaylist
  >;
const mockedUnlikeMusicTrack =
  unlikeMusicTrack as jest.MockedFunction<typeof unlikeMusicTrack>;
const mockedUnsubscribeMusicAccountPlaylist =
  unsubscribeMusicAccountPlaylist as jest.MockedFunction<
    typeof unsubscribeMusicAccountPlaylist
  >;

const LOCAL_PLAYLIST_SUMMARY: MusicCollectionSummaryEntity = {
  id: '501',
  source: 'netease',
  kind: 'playlist',
  title: 'Local Playlist',
};

const REMOTE_PLAYLIST_SUMMARY: MusicCollectionSummaryEntity = {
  id: '502',
  source: 'netease',
  kind: 'playlist',
  title: 'Remote Playlist',
  accountPlaylistRole: 'subscribed',
};

const LOCAL_RANK_SUMMARY: MusicCollectionSummaryEntity = {
  id: '19723756',
  source: 'netease',
  kind: 'rank',
  title: 'Official Toplist',
};

const LOCAL_TRACK: MusicTrackEntity = {
  id: '9101',
  source: 'netease',
  title: 'Local Saved Track',
  artists: ['Local Artist'],
  album: 'Local Album',
  coverUrl: 'https://cdn.music.test/local-track.jpg',
  durationMs: 180000,
  stream: '',
  playable: true,
};

const REMOTE_TRACK: MusicTrackEntity = {
  id: '9201',
  source: 'netease',
  title: 'Remote Liked Track',
  artists: ['Remote Artist'],
  album: 'Remote Album',
  coverUrl: 'https://cdn.music.test/remote-track.jpg',
  durationMs: 204000,
  stream: '',
  playable: true,
};

const SECOND_REMOTE_TRACK: MusicTrackEntity = {
  id: '9202',
  source: 'netease',
  title: 'Fresh Remote Track',
  artists: ['Fresh Artist'],
  album: 'Fresh Album',
  coverUrl: 'https://cdn.music.test/fresh-track.jpg',
  durationMs: 212000,
  stream: '',
  playable: true,
};

function createFavoriteRecord(
  track: MusicTrackEntity,
  savedAt: number
): MusicFavoriteRecord {
  return {
    track,
    savedAt,
  };
}

function createRecentTrackRecord(
  track: MusicTrackEntity,
  playedAt: number
): MusicRecentTrackRecord {
  return {
    track,
    playedAt,
  };
}

function createPlayRecord(
  track: MusicTrackEntity,
  playedAt: number,
  playTimeMs: number,
  durationMs = track.durationMs,
  completed = false
): MusicPlayRecord {
  return {
    track,
    playedAt,
    playTimeMs,
    durationMs,
    completed,
  };
}

function createSavedCollectionRecord(
  summary: MusicCollectionSummaryEntity,
  savedAt: number
): SavedMusicCollectionRecord {
  return {
    summary,
    savedAt,
  };
}

function setSignedOutMusicAccount(): void {
  useMusicAccountStore.setState({
    source: 'netease',
    account: {
      source: 'netease',
      authenticated: false,
      profile: null,
      playlists: [],
    },
    loading: false,
    submitting: false,
    error: null,
    qrState: {
      status: 'idle',
      key: null,
      qrUrl: null,
      qrImageDataUrl: null,
      message: null,
    },
  });
}

function setConnectedMusicAccount(
  playlists: MusicCollectionSummaryEntity[] = []
): void {
  useMusicAccountStore.setState({
    source: 'netease',
    account: {
      source: 'netease',
      authenticated: true,
      profile: {
        userId: '42',
        nickname: 'Luna Session',
      },
      playlists,
    },
    loading: false,
    submitting: false,
    error: null,
    qrState: {
      status: 'idle',
      key: null,
      qrUrl: null,
      qrImageDataUrl: null,
      message: null,
    },
  });
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('music library store account-aware favorites', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useMusicLibraryStore.setState({
      hydrated: false,
      loading: false,
      error: null,
      savedCollections: [],
      favoriteTracks: [],
      recentTracks: [],
      resumeTracks: [],
      savedCollectionKeys: [],
      favoriteTrackKeys: [],
    });
    setSignedOutMusicAccount();
    mockedBuildMusicProfileKey.mockImplementation(
      (source: string, id: string) => `${source}+${id}`
    );
    mockedGetMusicSavedCollections.mockResolvedValue([]);
    mockedGetMusicRecentTracks.mockResolvedValue([]);
    mockedGetAllMusicPlayRecords.mockResolvedValue({});
    mockedGetAllMusicFavorites.mockResolvedValue({});
    mockedGetMusicLikedTracks.mockResolvedValue([]);
    mockedLikeMusicTrack.mockResolvedValue([]);
    mockedListMusicRecentTracks.mockResolvedValue([]);
    mockedReportMusicTrackPlayed.mockResolvedValue([]);
    mockedSaveMusicCollection.mockResolvedValue(
      createSavedCollectionRecord(LOCAL_PLAYLIST_SUMMARY, 1000)
    );
    mockedUnlikeMusicTrack.mockResolvedValue([]);
    mockedSubscribeMusicAccountPlaylist.mockResolvedValue([
      REMOTE_PLAYLIST_SUMMARY,
    ]);
    mockedUnsubscribeMusicAccountPlaylist.mockResolvedValue([]);
    mockedSaveMusicRecentTrack.mockResolvedValue([]);
    mockedClearMusicCollections.mockResolvedValue();
  });

  it('hydrates remote liked tracks when the account is connected', async () => {
    setConnectedMusicAccount();
    mockedGetAllMusicFavorites.mockResolvedValue({
      'netease+9101': createFavoriteRecord(LOCAL_TRACK, 1000),
    });
    mockedGetMusicLikedTracks.mockResolvedValue([
      createFavoriteRecord(REMOTE_TRACK, 2000),
    ]);

    await useMusicLibraryStore.getState().hydrateLibrary();

    expect(mockedGetMusicLikedTracks).toHaveBeenCalledTimes(1);
    expect(mockedGetAllMusicFavorites).not.toHaveBeenCalled();
    expect(useMusicLibraryStore.getState().favoriteTracks).toEqual([
      createFavoriteRecord(REMOTE_TRACK, 2000),
    ]);
    expect(useMusicLibraryStore.getState().favoriteTrackKeys).toEqual([
      'netease+9201',
    ]);
  });

  it('hydrates local favorites when no music account is connected', async () => {
    mockedGetAllMusicFavorites.mockResolvedValue({
      'netease+9101': createFavoriteRecord(LOCAL_TRACK, 1000),
    });

    await useMusicLibraryStore.getState().hydrateLibrary();

    expect(mockedGetMusicLikedTracks).not.toHaveBeenCalled();
    expect(useMusicLibraryStore.getState().favoriteTracks).toEqual([
      createFavoriteRecord(LOCAL_TRACK, 1000),
    ]);
    expect(useMusicLibraryStore.getState().favoriteTrackKeys).toEqual([
      'netease+9101',
    ]);
  });

  it('hydrates remote recent tracks while keeping local resume tracks when the account is connected', async () => {
    setConnectedMusicAccount();
    mockedGetMusicRecentTracks.mockResolvedValue([
      createRecentTrackRecord(LOCAL_TRACK, 1000),
    ]);
    mockedListMusicRecentTracks.mockResolvedValue([
      createRecentTrackRecord(REMOTE_TRACK, 2000),
    ]);
    mockedGetAllMusicPlayRecords.mockResolvedValue({
      'netease+9101': createPlayRecord(LOCAL_TRACK, 1500, 42000),
    });

    await useMusicLibraryStore.getState().hydrateLibrary();

    expect(mockedListMusicRecentTracks).toHaveBeenCalledTimes(1);
    expect(useMusicLibraryStore.getState().recentTracks).toEqual([
      createRecentTrackRecord(REMOTE_TRACK, 2000),
    ]);
    expect(useMusicLibraryStore.getState().resumeTracks).toEqual([
      createPlayRecord(LOCAL_TRACK, 1500, 42000),
    ]);
  });

  it('hydrates local recent tracks when no music account is connected', async () => {
    mockedGetMusicRecentTracks.mockResolvedValue([
      createRecentTrackRecord(LOCAL_TRACK, 1000),
    ]);

    await useMusicLibraryStore.getState().hydrateLibrary();

    expect(mockedListMusicRecentTracks).not.toHaveBeenCalled();
    expect(useMusicLibraryStore.getState().recentTracks).toEqual([
      createRecentTrackRecord(LOCAL_TRACK, 1000),
    ]);
  });

  it('uses the remote liked-track mutation result when toggling while connected', async () => {
    setConnectedMusicAccount();
    useMusicLibraryStore.setState({
      hydrated: true,
      loading: false,
      error: null,
      savedCollections: [],
      favoriteTracks: [createFavoriteRecord(REMOTE_TRACK, 2000)],
      recentTracks: [],
      resumeTracks: [],
      savedCollectionKeys: [],
      favoriteTrackKeys: ['netease+9201'],
    });
    mockedLikeMusicTrack.mockResolvedValue([
      createFavoriteRecord(REMOTE_TRACK, 2000),
      createFavoriteRecord(SECOND_REMOTE_TRACK, 1999),
    ]);

    await useMusicLibraryStore.getState().toggleFavoriteTrack(SECOND_REMOTE_TRACK);

    expect(mockedLikeMusicTrack).toHaveBeenCalledWith('9202');
    expect(mockedSaveMusicFavorite).not.toHaveBeenCalled();
    expect(useMusicLibraryStore.getState().favoriteTrackKeys).toEqual([
      'netease+9201',
      'netease+9202',
    ]);
  });

  it('uses the remote recent-track mutation result while connected', async () => {
    setConnectedMusicAccount();
    useMusicLibraryStore.setState({
      hydrated: true,
      loading: false,
      error: null,
      savedCollections: [],
      favoriteTracks: [],
      recentTracks: [createRecentTrackRecord(REMOTE_TRACK, 2000)],
      resumeTracks: [createPlayRecord(LOCAL_TRACK, 1500, 42000)],
      savedCollectionKeys: [],
      favoriteTrackKeys: [],
    });
    mockedReportMusicTrackPlayed.mockResolvedValue([
      createRecentTrackRecord(SECOND_REMOTE_TRACK, 3000),
      createRecentTrackRecord(REMOTE_TRACK, 2000),
    ]);

    await useMusicLibraryStore.getState().reportRecentTrack(SECOND_REMOTE_TRACK);

    expect(mockedReportMusicTrackPlayed).toHaveBeenCalledWith('9202');
    expect(mockedSaveMusicRecentTrack).not.toHaveBeenCalled();
    expect(useMusicLibraryStore.getState().recentTracks).toEqual([
      createRecentTrackRecord(SECOND_REMOTE_TRACK, 3000),
      createRecentTrackRecord(REMOTE_TRACK, 2000),
    ]);
    expect(useMusicLibraryStore.getState().resumeTracks).toEqual([
      createPlayRecord(LOCAL_TRACK, 1500, 42000),
    ]);
  });

  it('uses the local recent-track persistence path while signed out', async () => {
    mockedSaveMusicRecentTrack.mockResolvedValue([
      createRecentTrackRecord(LOCAL_TRACK, 1000),
    ]);

    await useMusicLibraryStore.getState().reportRecentTrack(LOCAL_TRACK);

    expect(mockedSaveMusicRecentTrack).toHaveBeenCalledWith(LOCAL_TRACK);
    expect(mockedReportMusicTrackPlayed).not.toHaveBeenCalled();
    expect(useMusicLibraryStore.getState().recentTracks).toEqual([
      createRecentTrackRecord(LOCAL_TRACK, 1000),
    ]);
  });

  it('keeps the previous favorite state when the remote toggle fails', async () => {
    const previousFavoriteRecord = createFavoriteRecord(REMOTE_TRACK, 2000);
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    setConnectedMusicAccount();
    useMusicLibraryStore.setState({
      hydrated: true,
      loading: false,
      error: null,
      savedCollections: [],
      favoriteTracks: [previousFavoriteRecord],
      recentTracks: [],
      resumeTracks: [],
      savedCollectionKeys: [],
      favoriteTrackKeys: ['netease+9201'],
    });
    mockedUnlikeMusicTrack.mockRejectedValue(
      new Error('cloud mutation failed')
    );

    try {
      await expect(
        useMusicLibraryStore.getState().toggleFavoriteTrack(REMOTE_TRACK)
      ).rejects.toThrow('cloud mutation failed');

      expect(mockedUnlikeMusicTrack).toHaveBeenCalledWith('9201');
      expect(mockedDeleteMusicFavorite).not.toHaveBeenCalled();
      expect(useMusicLibraryStore.getState().favoriteTracks).toEqual([
        previousFavoriteRecord,
      ]);
      expect(useMusicLibraryStore.getState().favoriteTrackKeys).toEqual([
        'netease+9201',
      ]);
      expect(useMusicLibraryStore.getState().error).toBe(
        'cloud mutation failed'
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('rehydrates favorite tracks when the account switches from local to connected', async () => {
    mockedGetAllMusicFavorites.mockResolvedValue({
      'netease+9101': createFavoriteRecord(LOCAL_TRACK, 1000),
    });
    mockedGetMusicLikedTracks.mockResolvedValue([
      createFavoriteRecord(REMOTE_TRACK, 2000),
    ]);

    await useMusicLibraryStore.getState().hydrateLibrary();

    expect(useMusicLibraryStore.getState().favoriteTrackKeys).toEqual([
      'netease+9101',
    ]);

    setConnectedMusicAccount();
    await flushMicrotasks();

    expect(mockedGetMusicLikedTracks).toHaveBeenCalledTimes(1);
    expect(useMusicLibraryStore.getState().favoriteTrackKeys).toEqual([
      'netease+9201',
    ]);
  });

  it('delegates playlist saves to the remote account path while connected', async () => {
    setConnectedMusicAccount([]);
    useMusicLibraryStore.setState({
      hydrated: true,
      loading: false,
      error: null,
      savedCollections: [],
      favoriteTracks: [],
      recentTracks: [],
      resumeTracks: [],
      savedCollectionKeys: [],
      favoriteTrackKeys: [],
    });

    await useMusicLibraryStore
      .getState()
      .toggleSavedCollection(REMOTE_PLAYLIST_SUMMARY);

    expect(mockedSubscribeMusicAccountPlaylist).toHaveBeenCalledWith('502');
    expect(mockedSaveMusicCollection).not.toHaveBeenCalled();
    expect(useMusicAccountStore.getState().account?.playlists).toEqual([
      REMOTE_PLAYLIST_SUMMARY,
    ]);
    expect(useMusicLibraryStore.getState().savedCollectionKeys).toEqual([
      'netease+502',
    ]);
  });

  it('filters local playlist pins during hydrate while the account is connected', async () => {
    setConnectedMusicAccount([REMOTE_PLAYLIST_SUMMARY]);
    mockedGetMusicSavedCollections.mockResolvedValue([
      createSavedCollectionRecord(LOCAL_PLAYLIST_SUMMARY, 2000),
      createSavedCollectionRecord(LOCAL_RANK_SUMMARY, 1000),
    ]);

    await useMusicLibraryStore.getState().hydrateLibrary();

    expect(useMusicLibraryStore.getState().savedCollections).toEqual([
      createSavedCollectionRecord(LOCAL_RANK_SUMMARY, 1000),
    ]);
    expect(useMusicLibraryStore.getState().savedCollectionKeys).toEqual([
      'netease+19723756',
      'netease+502',
    ]);
  });

  it('keeps playlist saves on the local branch while signed out', async () => {
    mockedGetMusicSavedCollections.mockResolvedValue([
      createSavedCollectionRecord(LOCAL_PLAYLIST_SUMMARY, 1000),
    ]);

    await useMusicLibraryStore
      .getState()
      .toggleSavedCollection(LOCAL_PLAYLIST_SUMMARY);

    expect(mockedSaveMusicCollection).toHaveBeenCalledWith(
      LOCAL_PLAYLIST_SUMMARY
    );
    expect(mockedSubscribeMusicAccountPlaylist).not.toHaveBeenCalled();
    expect(useMusicLibraryStore.getState().savedCollectionKeys).toEqual([
      'netease+501',
    ]);
  });

  it('keeps remote account playlists after clearing local saved collections', async () => {
    setConnectedMusicAccount([REMOTE_PLAYLIST_SUMMARY]);
    useMusicLibraryStore.setState({
      hydrated: true,
      loading: false,
      error: null,
      savedCollections: [createSavedCollectionRecord(LOCAL_RANK_SUMMARY, 1000)],
      favoriteTracks: [],
      recentTracks: [],
      resumeTracks: [],
      savedCollectionKeys: ['netease+19723756', 'netease+502'],
      favoriteTrackKeys: [],
    });

    await useMusicLibraryStore.getState().clearSavedCollections();

    expect(mockedClearMusicCollections).toHaveBeenCalledTimes(1);
    expect(useMusicLibraryStore.getState().savedCollections).toEqual([]);
    expect(useMusicLibraryStore.getState().savedCollectionKeys).toEqual([
      'netease+502',
    ]);
    expect(useMusicAccountStore.getState().account?.playlists).toEqual([
      REMOTE_PLAYLIST_SUMMARY,
    ]);
  });
});
