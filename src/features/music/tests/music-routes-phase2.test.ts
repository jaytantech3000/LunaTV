import { NextRequest } from 'next/server';

const originalFetch = global.fetch;
let forwardedRangeHeader: string | null = null;
let forwardedSessionCookieHeader: string | null = null;

interface MusicRouteModule {
  GET: (request?: NextRequest) => Promise<Response> | Response;
  POST?: (request: NextRequest) => Promise<Response> | Response;
}

async function importMusicRoute(modulePath: string): Promise<MusicRouteModule> {
  return (await import(modulePath)) as MusicRouteModule;
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

function createTextResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    ...init,
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

describe('rebuilt music api routes', () => {
  beforeEach(() => {
    forwardedRangeHeader = null;
    forwardedSessionCookieHeader = null;
    let fmTrashCallCount = 0;
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl =
          input instanceof Request
            ? new URL(input.url)
            : new URL(String(input));

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
                  fmTrashCallCount > 0
                    ? 'FM Refresh Track'
                    : 'FM Session Track',
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
                  name: 'Searchable Track',
                  fee: 0,
                  duration: 205000,
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

        if (requestUrl.pathname === '/api/playlist/detail') {
          return createJsonResponse({
            code: 200,
            result: {
              id: 19723756,
              name: '官方榜单详情',
              coverImgUrl: 'https://cdn.music.test/toplist.jpg',
              description: 'Toplist Detail',
              trackCount: 1,
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

        if (requestUrl.pathname === '/api/song/lyric') {
          return createJsonResponse({
            code: 200,
            lrc: {
              lyric: '[00:01.00]第一句\n[00:02.50]第二句',
            },
          });
        }

        if (requestUrl.pathname === '/song/media/outer/url') {
          return new Response(null, {
            status: 302,
            headers: {
              Location: 'https://stream.music.test/audio.mp3',
            },
          });
        }

        if (
          requestUrl.host === 'stream.music.test' &&
          requestUrl.pathname === '/audio.mp3'
        ) {
          forwardedRangeHeader = readHeader(input, init, 'range');

          return createTextResponse('PING', {
            status: forwardedRangeHeader ? 206 : 200,
            headers: {
              'Content-Type': 'audio/mpeg',
              'Content-Length': '4',
              'Content-Range': 'bytes 0-3/4',
              'Accept-Ranges': 'bytes',
            },
          });
        }

        throw new Error(`Unhandled fetch: ${requestUrl.toString()}`);
      }
    ) as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns enabled music sources from the rebuilt route', async () => {
    const { GET: getMusicSources } = await importMusicRoute(
      '@/app/api/music/sources/route'
    );

    const response = await getMusicSources();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual([
      expect.objectContaining({
        key: 'netease',
        enabled: true,
      }),
    ]);
  });

  it('returns netease home payload from the rebuilt route', async () => {
    const { GET: getMusicHome } = await importMusicRoute(
      '@/app/api/music/home/route'
    );

    const response = await getMusicHome(
      new NextRequest('http://localhost/api/music/home?source=netease')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.source).toBe('netease');
    expect(payload.sections.length).toBeGreaterThan(0);
    expect(
      payload.sections.map((section: { title: string }) => section.title)
    ).toEqual(expect.arrayContaining(['精选专辑']));
  });

  it('returns daily recommendations and fm when a netease session cookie exists', async () => {
    const { GET: getMusicHome } = await importMusicRoute(
      '@/app/api/music/home/route'
    );
    const encodedSessionCookie = encodeURIComponent(
      JSON.stringify({
        source: 'netease',
        cookieHeader: 'MUSIC_U=mock-session',
      })
    );

    const response = await getMusicHome(
      new NextRequest('http://localhost/api/music/home?source=netease', {
        headers: {
          cookie: `lunatv_music_netease_session=${encodedSessionCookie}`,
        },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(forwardedSessionCookieHeader).toContain('MUSIC_U=mock-session');
    expect(payload.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: '每日推荐',
          tab: 'daily',
        }),
        expect.objectContaining({
          title: '私人 FM',
          tab: 'fm',
        }),
      ])
    );
  });

  it('returns personal fm tracks from the rebuilt route', async () => {
    const { GET: getMusicFm } = await importMusicRoute(
      '@/app/api/music/fm/route'
    );
    const encodedSessionCookie = encodeURIComponent(
      JSON.stringify({
        source: 'netease',
        cookieHeader: 'MUSIC_U=mock-session',
      })
    );

    const response = await getMusicFm(
      new NextRequest('http://localhost/api/music/fm?source=netease', {
        headers: {
          cookie: `lunatv_music_netease_session=${encodedSessionCookie}`,
        },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(forwardedSessionCookieHeader).toContain('MUSIC_U=mock-session');
    expect(payload).toEqual([
      expect.objectContaining({
        id: '9301',
        title: 'FM Session Track',
      }),
    ]);
  });

  it('posts fm trash feedback and returns replacement tracks', async () => {
    const { POST: postMusicFm } = await importMusicRoute(
      '@/app/api/music/fm/route'
    );

    if (!postMusicFm) {
      throw new Error('music fm POST route is unavailable');
    }

    const encodedSessionCookie = encodeURIComponent(
      JSON.stringify({
        source: 'netease',
        cookieHeader: 'MUSIC_U=mock-session',
      })
    );

    const response = await postMusicFm(
      new NextRequest('http://localhost/api/music/fm?source=netease', {
        method: 'POST',
        headers: {
          cookie: `lunatv_music_netease_session=${encodedSessionCookie}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'trash',
          trackId: '9301',
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(forwardedSessionCookieHeader).toContain('MUSIC_U=mock-session');
    expect(payload).toEqual([
      expect.objectContaining({
        id: '9302',
        title: 'FM Refresh Track',
      }),
    ]);
  });

  it('returns search payload from the rebuilt route', async () => {
    const { GET: getMusicSearch } = await importMusicRoute(
      '@/app/api/music/search/route'
    );

    const response = await getMusicSearch(
      new NextRequest(
        'http://localhost/api/music/search?source=netease&q=hello&page=1'
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.query).toBe('hello');
    expect(payload.tracks[0].title).toBe('Searchable Track');
    expect(payload.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '302',
          kind: 'playlist',
        }),
        expect.objectContaining({
          id: '3190201',
          kind: 'album',
          title: 'Search Album Result',
        }),
      ])
    );
  });

  it('returns artist hits from the rebuilt search route', async () => {
    const { GET: getMusicSearch } = await importMusicRoute(
      '@/app/api/music/search/route'
    );

    const response = await getMusicSearch(
      new NextRequest(
        'http://localhost/api/music/search?source=netease&q=jay&page=1'
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
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

  it('returns collection payload from the rebuilt route', async () => {
    const { GET: getMusicCollection } = await importMusicRoute(
      '@/app/api/music/collection/route'
    );

    const response = await getMusicCollection(
      new NextRequest(
        'http://localhost/api/music/collection?source=netease&id=19723756'
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary.id).toBe('19723756');
    expect(payload.tracks[0].title).toBe('Playable Track');
  });

  it('returns album collection payload from the rebuilt route', async () => {
    const { GET: getMusicCollection } = await importMusicRoute(
      '@/app/api/music/collection/route'
    );

    const response = await getMusicCollection(
      new NextRequest(
        'http://localhost/api/music/collection?source=netease&id=3190201&kind=album'
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary.id).toBe('3190201');
    expect(payload.summary.kind).toBe('album');
    expect(payload.summary.title).toBe('最新专辑详情');
    expect(payload.tracks[0].title).toBe('Hello');
  });

  it('returns artist toplist collection payload from the rebuilt route', async () => {
    const { GET: getMusicCollection } = await importMusicRoute(
      '@/app/api/music/collection/route'
    );

    const response = await getMusicCollection(
      new NextRequest(
        'http://localhost/api/music/collection?source=netease&id=6452&kind=artist-toplist'
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual(
      expect.objectContaining({
        id: '6452',
        kind: 'artist-toplist',
        title: '周杰伦',
      })
    );
    expect(payload.tracks[0].title).toBe('布拉格广场');
    expect(payload.relatedCollections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'album',
          title: '即兴曲',
        }),
      ])
    );
  });

  it('returns a proxied track payload from the rebuilt route', async () => {
    const { GET: getMusicTrack } = await importMusicRoute(
      '@/app/api/music/track/route'
    );

    const response = await getMusicTrack(
      new NextRequest('http://localhost/api/music/track?source=netease&id=9001')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.track.id).toBe('9001');
    expect(payload.streamUrl).toContain('/api/music/stream');
  });

  it('returns lyric payload from the rebuilt route', async () => {
    const { GET: getMusicLyric } = await importMusicRoute(
      '@/app/api/music/lyric/route'
    );

    const response = await getMusicLyric(
      new NextRequest('http://localhost/api/music/lyric?source=netease&id=9001')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.trackId).toBe('9001');
    expect(payload.lines[0]).toEqual({
      text: '第一句',
      timeMs: 1000,
    });
  });

  it('proxies audio stream from the rebuilt route', async () => {
    const { GET: getMusicStream } = await importMusicRoute(
      '@/app/api/music/stream/route'
    );
    const request = new NextRequest(
      'http://localhost/api/music/stream?source=netease&id=9001&quality=high',
      {
        headers: {
          range: 'bytes=0-3',
        },
      }
    );

    const response = await getMusicStream(request);

    expect(forwardedRangeHeader).toBe('bytes=0-3');
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    await expect(response.text()).resolves.toBe('PING');
  });

  it('rejects unsupported live music sources', async () => {
    const { GET: getMusicHome } = await importMusicRoute(
      '@/app/api/music/home/route'
    );

    const response = await getMusicHome(
      new NextRequest('http://localhost/api/music/home?source=jamendo')
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Unsupported music source');
  });

  it('rejects missing track ids', async () => {
    const { GET: getMusicTrack } = await importMusicRoute(
      '@/app/api/music/track/route'
    );

    const response = await getMusicTrack(
      new NextRequest('http://localhost/api/music/track?source=netease')
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('缺少曲目 id');
  });
});
