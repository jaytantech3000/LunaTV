import { NextRequest } from 'next/server';

interface MusicProfileRouteModule {
  DELETE: (request: NextRequest) => Promise<Response> | Response;
  GET: (request: NextRequest) => Promise<Response> | Response;
  POST: (request: NextRequest) => Promise<Response> | Response;
}

async function importMusicProfileRoute(
  modulePath: string
): Promise<MusicProfileRouteModule> {
  return (await import(modulePath)) as MusicProfileRouteModule;
}

const mockRequireProfileContextFromRequest = jest.fn();
const mockGetAllMusicFavorites = jest.fn();
const mockSaveMusicFavoriteRecord = jest.fn();
const mockDeleteMusicFavoriteRecord = jest.fn();
const mockGetMusicRecentTrackRecords = jest.fn();
const mockSaveMusicRecentTrackRecords = jest.fn();
const mockDeleteAllMusicRecentTrackRecords = jest.fn();
const mockGetAllMusicPlayRecords = jest.fn();
const mockSaveMusicPlayRecord = jest.fn();
const mockDeleteMusicPlayRecord = jest.fn();
const mockDeleteAllMusicPlayRecords = jest.fn();
const mockGetMusicSavedCollections = jest.fn();
const mockSaveMusicCollectionRecord = jest.fn();
const mockDeleteMusicCollectionRecord = jest.fn();
const mockDeleteAllMusicCollectionRecords = jest.fn();
const mockGetMusicSearchHistory = jest.fn();
const mockAddMusicSearchHistory = jest.fn();
const mockDeleteMusicSearchHistory = jest.fn();
const mockGetMusicPreferences = jest.fn();
const mockSaveMusicPreferences = jest.fn();
const mockGetMusicPlaybackSession = jest.fn();
const mockSaveMusicPlaybackSession = jest.fn();

jest.mock('@/lib/server/profile-context', () => ({
  requireProfileContextFromRequest: (...args: unknown[]) =>
    mockRequireProfileContextFromRequest(...args),
}));

jest.mock('@/lib/core/profile/music-user-data-service', () => ({
  getAllMusicFavorites: (...args: unknown[]) =>
    mockGetAllMusicFavorites(...args),
  saveMusicFavoriteRecord: (...args: unknown[]) =>
    mockSaveMusicFavoriteRecord(...args),
  deleteMusicFavoriteRecord: (...args: unknown[]) =>
    mockDeleteMusicFavoriteRecord(...args),
  getMusicRecentTrackRecords: (...args: unknown[]) =>
    mockGetMusicRecentTrackRecords(...args),
  saveMusicRecentTrackRecords: (...args: unknown[]) =>
    mockSaveMusicRecentTrackRecords(...args),
  deleteAllMusicRecentTrackRecords: (...args: unknown[]) =>
    mockDeleteAllMusicRecentTrackRecords(...args),
  getAllMusicPlayRecords: (...args: unknown[]) =>
    mockGetAllMusicPlayRecords(...args),
  saveMusicPlayRecord: (...args: unknown[]) => mockSaveMusicPlayRecord(...args),
  deleteMusicPlayRecord: (...args: unknown[]) =>
    mockDeleteMusicPlayRecord(...args),
  deleteAllMusicPlayRecords: (...args: unknown[]) =>
    mockDeleteAllMusicPlayRecords(...args),
  getMusicSavedCollections: (...args: unknown[]) =>
    mockGetMusicSavedCollections(...args),
  saveMusicCollectionRecord: (...args: unknown[]) =>
    mockSaveMusicCollectionRecord(...args),
  deleteMusicCollectionRecord: (...args: unknown[]) =>
    mockDeleteMusicCollectionRecord(...args),
  deleteAllMusicCollectionRecords: (...args: unknown[]) =>
    mockDeleteAllMusicCollectionRecords(...args),
  getMusicSearchHistory: (...args: unknown[]) =>
    mockGetMusicSearchHistory(...args),
  addMusicSearchHistory: (...args: unknown[]) =>
    mockAddMusicSearchHistory(...args),
  deleteMusicSearchHistory: (...args: unknown[]) =>
    mockDeleteMusicSearchHistory(...args),
  getMusicPreferences: (...args: unknown[]) => mockGetMusicPreferences(...args),
  saveMusicPreferences: (...args: unknown[]) =>
    mockSaveMusicPreferences(...args),
  getMusicPlaybackSession: (...args: unknown[]) =>
    mockGetMusicPlaybackSession(...args),
  saveMusicPlaybackSession: (...args: unknown[]) =>
    mockSaveMusicPlaybackSession(...args),
}));

describe('music profile api routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireProfileContextFromRequest.mockResolvedValue({
      username: 'desktop-owner',
      source: 'browser-cookie',
      storageType: 'localstorage',
      profileMode: 'single-user-local',
    });
  });

  it('reads and writes favorite records through the music profile favorites route', async () => {
    const { GET, POST, DELETE } = await importMusicProfileRoute(
      '@/app/api/music/profile/favorites/route'
    );

    mockGetAllMusicFavorites.mockResolvedValue({
      'netease+9001': {
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '',
          playable: true,
        },
        savedAt: 1000,
      },
    });

    const getResponse = await GET(
      new NextRequest('http://localhost/api/music/profile/favorites')
    );
    const getPayload = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getPayload).toEqual({
      'netease+9001': expect.objectContaining({
        savedAt: 1000,
      }),
    });

    const postResponse = await POST(
      new NextRequest('http://localhost/api/music/profile/favorites', {
        method: 'POST',
        body: JSON.stringify({
          key: 'netease+9001',
          favorite: {
            track: {
              id: '9001',
              source: 'netease',
              title: 'Playable Track',
              artists: ['Artist A'],
              album: 'Album A',
              coverUrl: 'https://cdn.music.test/album-a.jpg',
              durationMs: 215000,
              stream: '',
              playable: true,
            },
            savedAt: 1000,
          },
        }),
      })
    );

    expect(postResponse.status).toBe(200);
    expect(mockSaveMusicFavoriteRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'desktop-owner',
      }),
      {
        key: 'netease+9001',
        favorite: expect.objectContaining({
          savedAt: 1000,
        }),
      }
    );

    const deleteResponse = await DELETE(
      new NextRequest(
        'http://localhost/api/music/profile/favorites?key=netease+9001'
      )
    );

    expect(deleteResponse.status).toBe(200);
    expect(mockDeleteMusicFavoriteRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'desktop-owner',
      }),
      'netease+9001'
    );
  });

  it('reads and overwrites recent track records through the music profile recent route', async () => {
    const { GET, POST, DELETE } = await importMusicProfileRoute(
      '@/app/api/music/profile/recent-tracks/route'
    );

    mockGetMusicRecentTrackRecords.mockResolvedValue([
      {
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '',
          playable: true,
        },
        playedAt: 1000,
      },
    ]);

    const getResponse = await GET(
      new NextRequest('http://localhost/api/music/profile/recent-tracks')
    );
    const getPayload = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getPayload).toHaveLength(1);

    const postResponse = await POST(
      new NextRequest('http://localhost/api/music/profile/recent-tracks', {
        method: 'POST',
        body: JSON.stringify({
          track: {
            track: {
              id: '9001',
              source: 'netease',
              title: 'Playable Track',
              artists: ['Artist A'],
              album: 'Album A',
              coverUrl: 'https://cdn.music.test/album-a.jpg',
              durationMs: 215000,
              stream: '',
              playable: true,
            },
            playedAt: 1000,
          },
        }),
      })
    );

    expect(postResponse.status).toBe(200);
    expect(mockSaveMusicRecentTrackRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'desktop-owner',
      }),
      expect.objectContaining({
        track: expect.objectContaining({
          playedAt: 1000,
        }),
      })
    );

    const deleteResponse = await DELETE(
      new NextRequest('http://localhost/api/music/profile/recent-tracks')
    );

    expect(deleteResponse.status).toBe(200);
    expect(mockDeleteAllMusicRecentTrackRecords).toHaveBeenCalled();
  });

  it('reads and writes play records through the music profile play-records route', async () => {
    const { GET, POST, DELETE } = await importMusicProfileRoute(
      '@/app/api/music/profile/play-records/route'
    );

    mockGetAllMusicPlayRecords.mockResolvedValue({
      'netease+9001': {
        track: {
          id: '9001',
          source: 'netease',
          title: 'Playable Track',
          artists: ['Artist A'],
          album: 'Album A',
          coverUrl: 'https://cdn.music.test/album-a.jpg',
          durationMs: 215000,
          stream: '',
          playable: true,
        },
        playedAt: 1000,
        playTimeMs: 64000,
        durationMs: 215000,
        completed: false,
      },
    });

    const getResponse = await GET(
      new NextRequest('http://localhost/api/music/profile/play-records')
    );
    const getPayload = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getPayload).toEqual({
      'netease+9001': expect.objectContaining({
        playTimeMs: 64000,
      }),
    });

    const postResponse = await POST(
      new NextRequest('http://localhost/api/music/profile/play-records', {
        method: 'POST',
        body: JSON.stringify({
          key: 'netease+9001',
          record: {
            track: {
              id: '9001',
              source: 'netease',
              title: 'Playable Track',
              artists: ['Artist A'],
              album: 'Album A',
              coverUrl: 'https://cdn.music.test/album-a.jpg',
              durationMs: 215000,
              stream: '',
              playable: true,
            },
            playedAt: 1000,
            playTimeMs: 64000,
            durationMs: 215000,
            completed: false,
          },
        }),
      })
    );

    expect(postResponse.status).toBe(200);
    expect(mockSaveMusicPlayRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'desktop-owner',
      }),
      {
        key: 'netease+9001',
        record: expect.objectContaining({
          playTimeMs: 64000,
        }),
      }
    );

    const deleteResponse = await DELETE(
      new NextRequest(
        'http://localhost/api/music/profile/play-records?key=netease+9001'
      )
    );

    expect(deleteResponse.status).toBe(200);
    expect(mockDeleteMusicPlayRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'desktop-owner',
      }),
      'netease+9001'
    );
  });

  it('reads and mutates saved collections through the music profile collections route', async () => {
    const { GET, POST, DELETE } = await importMusicProfileRoute(
      '@/app/api/music/profile/collections/route'
    );

    mockGetMusicSavedCollections.mockResolvedValue([
      {
        summary: {
          id: '19723756',
          source: 'netease',
          kind: 'rank',
          title: '官方榜单详情',
          coverUrl: 'https://cdn.music.test/toplist.jpg',
          description: 'Toplist Detail',
          trackCount: 10,
          accentColor: '#ff5f6d',
        },
        savedAt: 1000,
      },
    ]);

    const getResponse = await GET(
      new NextRequest('http://localhost/api/music/profile/collections')
    );
    const getPayload = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getPayload).toEqual([
      expect.objectContaining({
        summary: expect.objectContaining({
          id: '19723756',
        }),
        savedAt: 1000,
      }),
    ]);

    const postResponse = await POST(
      new NextRequest('http://localhost/api/music/profile/collections', {
        method: 'POST',
        body: JSON.stringify({
          key: 'netease+19723756',
          collection: {
            summary: {
              id: '19723756',
              source: 'netease',
              kind: 'rank',
              title: '官方榜单详情',
              coverUrl: 'https://cdn.music.test/toplist.jpg',
              description: 'Toplist Detail',
              trackCount: 10,
              accentColor: '#ff5f6d',
            },
            savedAt: 1000,
          },
        }),
      })
    );

    expect(postResponse.status).toBe(200);
    expect(mockSaveMusicCollectionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'desktop-owner',
      }),
      {
        key: 'netease+19723756',
        collection: expect.objectContaining({
          savedAt: 1000,
        }),
      }
    );

    const deleteResponse = await DELETE(
      new NextRequest(
        'http://localhost/api/music/profile/collections?key=netease+19723756'
      )
    );

    expect(deleteResponse.status).toBe(200);
    expect(mockDeleteMusicCollectionRecord).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        username: 'desktop-owner',
      }),
      'netease+19723756'
    );

    const clearResponse = await DELETE(
      new NextRequest('http://localhost/api/music/profile/collections')
    );

    expect(clearResponse.status).toBe(200);
    expect(mockDeleteAllMusicCollectionRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'desktop-owner',
      })
    );
  });

  it('reads and mutates music search history through the music profile search-history route', async () => {
    const { GET, POST, DELETE } = await importMusicProfileRoute(
      '@/app/api/music/profile/search-history/route'
    );

    mockGetMusicSearchHistory.mockResolvedValue(['hello', 'summer']);

    const getResponse = await GET(
      new NextRequest('http://localhost/api/music/profile/search-history')
    );
    const getPayload = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getPayload).toEqual(['hello', 'summer']);

    const postResponse = await POST(
      new NextRequest('http://localhost/api/music/profile/search-history', {
        method: 'POST',
        body: JSON.stringify({
          query: 'hello',
        }),
      })
    );

    expect(postResponse.status).toBe(200);
    expect(mockAddMusicSearchHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'desktop-owner',
      }),
      'hello'
    );

    const deleteResponse = await DELETE(
      new NextRequest(
        'http://localhost/api/music/profile/search-history?query=hello'
      )
    );

    expect(deleteResponse.status).toBe(200);
    expect(mockDeleteMusicSearchHistory).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        username: 'desktop-owner',
      }),
      'hello'
    );

    const clearResponse = await DELETE(
      new NextRequest('http://localhost/api/music/profile/search-history')
    );

    expect(clearResponse.status).toBe(200);
    expect(mockDeleteMusicSearchHistory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        username: 'desktop-owner',
      }),
      undefined
    );
  });

  it('reads and overwrites music preferences through the music profile preferences route', async () => {
    const { GET, POST } = await importMusicProfileRoute(
      '@/app/api/music/profile/preferences/route'
    );

    mockGetMusicPreferences.mockResolvedValue({
      themeVariant: 'sunset',
      sidebarCollapsed: true,
      preferredPlaybackQuality: 'high',
      lyricsFollowMode: 'manual',
      playMode: 'single-loop',
      volume: 0.42,
      muted: true,
    });

    const getResponse = await GET(
      new NextRequest('http://localhost/api/music/profile/preferences')
    );
    const getPayload = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getPayload).toEqual({
      themeVariant: 'sunset',
      sidebarCollapsed: true,
      preferredPlaybackQuality: 'high',
      lyricsFollowMode: 'manual',
      playMode: 'single-loop',
      volume: 0.42,
      muted: true,
    });

    const postResponse = await POST(
      new NextRequest('http://localhost/api/music/profile/preferences', {
        method: 'POST',
        body: JSON.stringify({
          preferences: {
            themeVariant: 'midnight',
            sidebarCollapsed: false,
            preferredPlaybackQuality: 'standard',
            lyricsFollowMode: 'auto',
            playMode: 'list-loop',
            volume: 0.9,
            muted: false,
          },
        }),
      })
    );

    expect(postResponse.status).toBe(200);
    expect(mockSaveMusicPreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'desktop-owner',
      }),
      {
        themeVariant: 'midnight',
        sidebarCollapsed: false,
        preferredPlaybackQuality: 'standard',
        lyricsFollowMode: 'auto',
        playMode: 'list-loop',
        volume: 0.9,
        muted: false,
      }
    );
  });

  it('reads and overwrites music playback sessions through the playback-session route', async () => {
    const { GET, POST } = await importMusicProfileRoute(
      '@/app/api/music/profile/playback-session/route'
    );

    const payload = {
      queue: [
        {
          queueId: 'q1',
          addedAt: 1,
          fromContext: 'featured',
          track: {
            id: '9001',
            source: 'netease',
            title: 'Playable Track',
            artists: ['Artist A'],
            album: 'Album A',
            coverUrl: 'https://cdn.music.test/a.jpg',
            durationMs: 215000,
            stream: '',
            playable: true,
          },
        },
      ],
      currentTrackId: '9001',
      positionMs: 42000,
      durationMs: 215000,
      savedAt: 123,
    };

    mockGetMusicPlaybackSession.mockResolvedValue(payload);

    const getResponse = await GET(
      new NextRequest('http://localhost/api/music/profile/playback-session')
    );

    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual(payload);

    const postResponse = await POST(
      new NextRequest('http://localhost/api/music/profile/playback-session', {
        method: 'POST',
        body: JSON.stringify({
          session: payload,
        }),
      })
    );

    expect(postResponse.status).toBe(200);
    expect(mockSaveMusicPlaybackSession).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'desktop-owner',
      }),
      payload
    );
  });
});
