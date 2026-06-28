const originalFetch = global.fetch;
let forwardedSessionCookieHeader: string | null = null;

interface NeteaseRepositoryModule {
  createNeteaseRepository: () => {
    discoveryRepository: {
      getHomeView: (
        source: 'netease',
        options?: {
          sessionCookie?: string | null;
        }
      ) => Promise<{
        source: 'netease';
        spotlight: Array<{ playable: boolean }>;
        sections: Array<{
          title: string;
          tab: 'rank' | 'playlist' | 'album' | 'hot' | 'daily' | 'fm';
          collections?: Array<{
            id: string;
            kind: 'playlist' | 'rank' | 'album';
          }>;
          tracks?: Array<{
            id: string;
            title: string;
          }>;
        }>;
      }>;
      search: (
        source: 'netease',
        query: string,
        page?: number
      ) => Promise<{
        query: string;
        collections: Array<{
          id: string;
          kind: 'playlist' | 'album' | 'artist-toplist';
          title: string;
        }>;
      }>;
      getPersonalFm: (
        source: 'netease',
        options?: {
          sessionCookie?: string | null;
        }
      ) => Promise<
        Array<{
          id: string;
          title: string;
        }>
      >;
      trashPersonalFmTrack: (
        source: 'netease',
        trackId: string,
        options?: {
          sessionCookie?: string | null;
        }
      ) => Promise<
        Array<{
          id: string;
          title: string;
        }>
      >;
    };
    collectionRepository: {
      getCollection: (
        source: 'netease',
        id: string,
        kind?: 'playlist' | 'rank' | 'album' | 'artist-toplist'
      ) => Promise<{
        summary: {
          id: string;
          kind: 'playlist' | 'rank' | 'album' | 'artist-toplist';
          title: string;
        };
        tracks: Array<{
          title: string;
        }>;
        relatedCollections?: Array<{
          kind: 'playlist' | 'rank' | 'album' | 'artist-toplist';
          title: string;
        }>;
      }>;
    };
    trackRepository: {
      getTrackPlayback: (
        source: 'netease',
        id: string,
        quality: 'standard'
      ) => Promise<{
        track: {
          id: string;
          title: string;
        };
        streamUrl: string;
      }>;
    };
  };
}

async function importNeteaseRepository(): Promise<NeteaseRepositoryModule> {
  const modulePath = '../services/providers/netease/repository';
  return (await import(modulePath)) as NeteaseRepositoryModule;
}

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init?.headers || {}),
    },
    status: init?.status || 200,
  });
}

function readHeader(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  name: string
): string | null {
  if (input instanceof Request) {
    const requestHeader = input.headers.get(name);

    if (requestHeader) {
      return requestHeader;
    }
  }

  const headerSource = init?.headers;

  if (!headerSource) {
    return null;
  }

  if (headerSource instanceof Headers) {
    return headerSource.get(name);
  }

  if (Array.isArray(headerSource)) {
    const matchedHeader = headerSource.find(
      ([key]) => key.toLowerCase() === name.toLowerCase()
    );

    return matchedHeader ? matchedHeader[1] : null;
  }

  for (const [key, value] of Object.entries(headerSource)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return value;
    }
  }

  return null;
}

describe('createNeteaseRepository', () => {
  beforeEach(() => {
    forwardedSessionCookieHeader = null;
    let fmTrashCallCount = 0;
    global.fetch = jest.fn(async (input, init) => {
      const requestUrl = new URL(String(input));

      if (requestUrl.pathname === '/api/toplist') {
        return createJsonResponse({
          code: 200,
          list: [
            {
              id: 19723756,
              name: '官方榜单',
              coverImgUrl: 'https://cdn.music.test/toplist.jpg',
              description: 'Toplist',
              trackCount: 10,
              updateFrequency: '每日更新',
            },
          ],
        });
      }

      if (requestUrl.pathname === '/api/personalized/playlist') {
        return createJsonResponse({
          code: 200,
          result: [
            {
              id: 301,
              name: '推荐歌单',
              picUrl: 'https://cdn.music.test/playlist.jpg',
              copywriter: '精选推荐',
              trackCount: 12,
            },
          ],
        });
      }

      if (requestUrl.pathname === '/api/discovery/newAlbum') {
        return createJsonResponse({
          code: 200,
          albums: [
            {
              id: 3190201,
              name: '最新专辑',
              picUrl: 'https://cdn.music.test/new-album.jpg',
              size: 1,
              artist: {
                id: 381949,
                name: 'OMFG',
              },
              artists: [
                {
                  id: 381949,
                  name: 'OMFG',
                },
              ],
            },
          ],
        });
      }

      if (requestUrl.pathname === '/api/v3/discovery/recommend/songs') {
        forwardedSessionCookieHeader = readHeader(input, init, 'cookie');

        return createJsonResponse({
          code: 200,
          data: {
            dailySongs: [
              {
                id: 9201,
                name: 'Daily Session Track',
                fee: 0,
                dt: 187000,
                ar: [{ id: 701, name: 'Daily Artist' }],
                al: {
                  id: 801,
                  name: 'Daily Album',
                  picUrl: 'https://cdn.music.test/daily-track.jpg',
                },
              },
            ],
          },
        });
      }

      if (requestUrl.pathname === '/api/v1/radio/get') {
        forwardedSessionCookieHeader = readHeader(input, init, 'cookie');

        return createJsonResponse({
          code: 200,
          data: [
            {
              id: fmTrashCallCount > 0 ? 9302 : 9301,
              name:
                fmTrashCallCount > 0 ? 'FM Refresh Track' : 'FM Session Track',
              fee: 0,
              duration: fmTrashCallCount > 0 ? 196000 : 193000,
              artists: [
                {
                  id: fmTrashCallCount > 0 ? 703 : 702,
                  name:
                    fmTrashCallCount > 0 ? 'FM Refresh Artist' : 'FM Artist',
                },
              ],
              album: {
                id: fmTrashCallCount > 0 ? 803 : 802,
                name: fmTrashCallCount > 0 ? 'FM Refresh Album' : 'FM Album',
                picUrl:
                  fmTrashCallCount > 0
                    ? 'https://cdn.music.test/fm-refresh.jpg'
                    : 'https://cdn.music.test/fm-track.jpg',
              },
            },
          ],
        });
      }

      if (requestUrl.pathname === '/api/radio/trash/add') {
        fmTrashCallCount += 1;
        forwardedSessionCookieHeader = readHeader(input, init, 'cookie');

        return createJsonResponse({
          code: 200,
        });
      }

      if (requestUrl.pathname === '/api/playlist/detail') {
        return createJsonResponse({
          code: 200,
          result: {
            id: 19723756,
            name: '官方榜单详情',
            coverImgUrl: 'https://cdn.music.test/toplist.jpg',
            description: 'Toplist Detail',
            trackCount: 2,
            updateFrequency: '每日更新',
            creator: {
              nickname: '网易云音乐',
            },
            tracks: [
              {
                id: 9001,
                name: 'Playable Track',
                fee: 0,
                duration: 215000,
                artists: [{ id: 1, name: 'Artist A' }],
                album: {
                  id: 77,
                  name: 'Album A',
                  picUrl: 'https://cdn.music.test/album-a.jpg',
                },
              },
              {
                id: 9002,
                name: 'Paid Track',
                fee: 1,
                duration: 210000,
                artists: [{ id: 2, name: 'Artist B' }],
                album: {
                  id: 78,
                  name: 'Album B',
                  picUrl: 'https://cdn.music.test/album-b.jpg',
                },
              },
            ],
          },
        });
      }

      if (requestUrl.pathname === '/api/v1/album/3190201') {
        return createJsonResponse({
          code: 200,
          album: {
            id: 3190201,
            name: '最新专辑详情',
            picUrl: 'https://cdn.music.test/new-album.jpg',
            description: 'Latest album detail',
            size: 1,
            company: 'OMFG',
            artists: [
              {
                id: 381949,
                name: 'OMFG',
              },
            ],
          },
          songs: [
            {
              id: 33211676,
              name: 'Hello',
              fee: 0,
              duration: 226307,
              artists: [{ id: 381949, name: 'OMFG' }],
              album: {
                id: 3190201,
                name: '最新专辑详情',
                picUrl: 'https://cdn.music.test/new-album.jpg',
              },
            },
          ],
        });
      }

      if (
        requestUrl.pathname === '/api/search/get/web' &&
        requestUrl.searchParams.get('type') === '1'
      ) {
        return createJsonResponse({
          code: 200,
          result: {
            songs: [
              {
                id: 9101,
                name: 'Search Track',
                fee: 0,
                duration: 201000,
                artists: [{ id: 11, name: 'Search Artist' }],
                album: {
                  id: 88,
                  name: 'Search Album',
                  picUrl: 'https://cdn.music.test/search-track.jpg',
                },
              },
            ],
          },
        });
      }

      if (
        requestUrl.pathname === '/api/search/get/web' &&
        requestUrl.searchParams.get('type') === '1000'
      ) {
        return createJsonResponse({
          code: 200,
          result: {
            playlists: [
              {
                id: 302,
                name: 'Search Playlist',
                coverImgUrl: 'https://cdn.music.test/search-playlist.jpg',
                description: 'Search playlist description',
                trackCount: 24,
              },
            ],
          },
        });
      }

      if (
        requestUrl.pathname === '/api/search/get/web' &&
        requestUrl.searchParams.get('type') === '10'
      ) {
        return createJsonResponse({
          code: 200,
          result: {
            albums: [
              {
                id: 3190201,
                name: 'Search Album Result',
                picUrl: 'https://cdn.music.test/search-album.jpg',
                size: 1,
                artist: {
                  id: 381949,
                  name: 'OMFG',
                },
                artists: [
                  {
                    id: 381949,
                    name: 'OMFG',
                  },
                ],
              },
            ],
          },
        });
      }

      if (
        requestUrl.pathname === '/api/search/get/web' &&
        requestUrl.searchParams.get('type') === '100'
      ) {
        return createJsonResponse({
          code: 200,
          result: {
            artists: [
              {
                id: 6452,
                name: '周杰伦',
                picUrl: 'https://cdn.music.test/jay.jpg',
                albumSize: 41,
                musicSize: 568,
              },
            ],
          },
        });
      }

      if (requestUrl.pathname === '/api/artist/top/song') {
        return createJsonResponse({
          code: 200,
          songs: [
            {
              id: 210049,
              name: '布拉格广场',
              fee: 0,
              duration: 290000,
              ar: [
                {
                  id: 721,
                  name: '蔡依林',
                },
                {
                  id: 6452,
                  name: '周杰伦',
                },
              ],
              al: {
                id: 1041457,
                name: '看我72变',
                picUrl: 'https://cdn.music.test/bratislava.jpg',
              },
            },
            {
              id: 186016,
              name: '七里香',
              fee: 0,
              duration: 298000,
              ar: [
                {
                  id: 6452,
                  name: '周杰伦',
                },
              ],
              al: {
                id: 186015,
                name: '七里香',
                picUrl: 'https://cdn.music.test/qilixiang.jpg',
              },
            },
          ],
        });
      }

      if (requestUrl.pathname === '/api/artist/albums/6452') {
        return createJsonResponse({
          code: 200,
          hotAlbums: [
            {
              id: 274336916,
              name: '即兴曲',
              picUrl: 'https://cdn.music.test/jixingqu.jpg',
              size: 7,
              artist: {
                id: 6452,
                name: '周杰伦',
              },
              artists: [
                {
                  id: 6452,
                  name: '周杰伦',
                },
              ],
            },
            {
              id: 274336917,
              name: '范特西',
              picUrl: 'https://cdn.music.test/fantasy.jpg',
              size: 10,
              artist: {
                id: 6452,
                name: '周杰伦',
              },
              artists: [
                {
                  id: 6452,
                  name: '周杰伦',
                },
              ],
            },
          ],
        });
      }

      if (requestUrl.pathname === '/api/song/detail') {
        return createJsonResponse({
          code: 200,
          songs: [
            {
              id: 9001,
              name: 'Playable Track',
              fee: 0,
              duration: 215000,
              artists: [{ id: 1, name: 'Artist A' }],
              album: {
                id: 77,
                name: 'Album A',
                picUrl: 'https://cdn.music.test/album-a.jpg',
              },
            },
          ],
        });
      }

      throw new Error(`Unhandled fetch: ${requestUrl.toString()}`);
    }) as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns live home sections and spotlight tracks', async () => {
    const { createNeteaseRepository } = await importNeteaseRepository();

    const repository = createNeteaseRepository();
    const home = await repository.discoveryRepository.getHomeView('netease');

    expect(home.source).toBe('netease');
    expect(home.sections.length).toBeGreaterThan(0);
    expect(home.spotlight).toHaveLength(1);
    expect(home.spotlight.every((track) => track.playable)).toBe(true);
    expect(
      home.sections.find((section) => section.title === '精选专辑')?.collections
    ).toEqual([
      expect.objectContaining({
        id: '3190201',
        kind: 'album',
      }),
    ]);
    expect(home.sections.map((section) => section.title)).toEqual(
      expect.arrayContaining(['官方榜单', '推荐歌单', '精选专辑'])
    );
  });

  it('adds daily recommendations and fm sections when a netease session cookie exists', async () => {
    const { createNeteaseRepository } = await importNeteaseRepository();

    const repository = createNeteaseRepository();
    const home = await repository.discoveryRepository.getHomeView('netease', {
      sessionCookie: 'MUSIC_U=mock-session',
    });

    expect(forwardedSessionCookieHeader).toContain('MUSIC_U=mock-session');
    expect(home.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: '每日推荐',
          tab: 'daily',
          tracks: [
            expect.objectContaining({
              id: '9201',
              title: 'Daily Session Track',
            }),
          ],
        }),
        expect.objectContaining({
          title: '私人 FM',
          tab: 'fm',
          tracks: [
            expect.objectContaining({
              id: '9301',
              title: 'FM Session Track',
            }),
          ],
        }),
      ])
    );
  });

  it('returns personal fm tracks from the discovery repository', async () => {
    const { createNeteaseRepository } = await importNeteaseRepository();

    const repository = createNeteaseRepository();
    const tracks = await repository.discoveryRepository.getPersonalFm(
      'netease',
      {
        sessionCookie: 'MUSIC_U=mock-session',
      }
    );

    expect(forwardedSessionCookieHeader).toContain('MUSIC_U=mock-session');
    expect(tracks).toEqual([
      expect.objectContaining({
        id: '9301',
        title: 'FM Session Track',
      }),
    ]);
  });

  it('posts personal fm trash feedback before returning replacement tracks', async () => {
    const { createNeteaseRepository } = await importNeteaseRepository();

    const repository = createNeteaseRepository();
    const tracks = await repository.discoveryRepository.trashPersonalFmTrack(
      'netease',
      '9301',
      {
        sessionCookie: 'MUSIC_U=mock-session',
      }
    );

    expect(forwardedSessionCookieHeader).toContain('MUSIC_U=mock-session');
    expect(tracks).toEqual([
      expect.objectContaining({
        id: '9302',
        title: 'FM Refresh Track',
      }),
    ]);
  });

  it('returns album detail payload when opening an album collection', async () => {
    const { createNeteaseRepository } = await importNeteaseRepository();

    const repository = createNeteaseRepository();
    const payload = await repository.collectionRepository.getCollection(
      'netease',
      '3190201',
      'album'
    );

    expect(payload.summary.id).toBe('3190201');
    expect(payload.summary.kind).toBe('album');
    expect(payload.summary.title).toBe('最新专辑详情');
    expect(payload.tracks[0]?.title).toBe('Hello');
  });

  it('returns mixed playlist and album collections in live search results', async () => {
    const { createNeteaseRepository } = await importNeteaseRepository();

    const repository = createNeteaseRepository();
    const payload = await repository.discoveryRepository.search(
      'netease',
      'hello'
    );

    expect(payload.query).toBe('hello');
    expect(payload.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '302',
          kind: 'playlist',
          title: 'Search Playlist',
        }),
        expect.objectContaining({
          id: '3190201',
          kind: 'album',
          title: 'Search Album Result',
        }),
      ])
    );
  });

  it('returns artist hits in live search results', async () => {
    const { createNeteaseRepository } = await importNeteaseRepository();

    const repository = createNeteaseRepository();
    const payload = await repository.discoveryRepository.search(
      'netease',
      'jay'
    );

    expect(payload.query).toBe('jay');
    expect(payload.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '6452',
          kind: 'artist-toplist',
          title: '周杰伦',
        }),
      ])
    );
  });

  it('returns artist toplist collections with top tracks and related albums', async () => {
    const { createNeteaseRepository } = await importNeteaseRepository();

    const repository = createNeteaseRepository();
    const payload = await repository.collectionRepository.getCollection(
      'netease',
      '6452',
      'artist-toplist'
    );

    expect(payload.summary).toEqual(
      expect.objectContaining({
        id: '6452',
        kind: 'artist-toplist',
        title: '周杰伦',
      })
    );
    expect(payload.tracks[0]).toEqual(
      expect.objectContaining({
        title: '布拉格广场',
      })
    );
    expect(payload.relatedCollections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'album',
          title: '即兴曲',
        }),
      ])
    );
  });

  it('returns track playback payload with a proxied stream path', async () => {
    const { createNeteaseRepository } = await importNeteaseRepository();

    const repository = createNeteaseRepository();
    const payload = await repository.trackRepository.getTrackPlayback(
      'netease',
      '9001',
      'standard'
    );

    expect(payload.track.id).toBe('9001');
    expect(payload.track.title).toBe('Playable Track');
    expect(payload.streamUrl).toContain('/api/music/stream');
    expect(payload.streamUrl).toContain('source=netease');
    expect(payload.streamUrl).toContain('id=9001');
  });
});
