import { NextRequest } from 'next/server';

const originalFetch = global.fetch;
let forwardedCookieHeader: string | null = null;

interface MusicAccountRouteModule {
  DELETE: (request: NextRequest) => Promise<Response> | Response;
  GET: (request: NextRequest) => Promise<Response> | Response;
  POST: (request: NextRequest) => Promise<Response> | Response;
}

async function importMusicAccountRoute(
  modulePath: string
): Promise<MusicAccountRouteModule> {
  return (await import(modulePath)) as MusicAccountRouteModule;
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

function createStoredMusicAccountCookie(cookieHeader: string): string {
  return `lunatv_music_netease_session=${encodeURIComponent(
    JSON.stringify({
      source: 'netease',
      cookieHeader,
    })
  )}`;
}

describe('rebuilt music account route', () => {
  beforeEach(() => {
    forwardedCookieHeader = null;
    let likedPlaylistTracks = [
      {
        id: 9201,
        name: 'Liked Session Track',
        fee: 0,
        duration: 204000,
        artists: [{ id: 81, name: 'Liked Artist' }],
        album: {
          id: 82,
          name: 'Liked Album',
          picUrl: 'https://cdn.music.test/liked-track.jpg',
        },
      },
    ];
    let recentPlayTracks = [
      {
        id: 9301,
        name: 'Recent Session Track',
        fee: 0,
        duration: 223000,
        artists: [{ id: 91, name: 'Recent Artist' }],
        album: {
          id: 92,
          name: 'Recent Album',
          picUrl: 'https://cdn.music.test/recent-track.jpg',
        },
      },
    ];
    let accountPlaylists = [
      {
        id: 501,
        name: 'Created Playlist',
        coverImgUrl: 'https://cdn.music.test/created-playlist.jpg',
        description: 'Created by Luna User',
        trackCount: 18,
        creator: {
          userId: 42,
          nickname: 'Luna User',
        },
      },
      {
        id: 502,
        name: 'Subscribed Playlist',
        coverImgUrl: 'https://cdn.music.test/subscribed-playlist.jpg',
        description: 'Collected by Luna User',
        trackCount: 24,
        creator: {
          userId: 7,
          nickname: 'Another DJ',
        },
      },
    ];
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl =
          input instanceof Request
            ? new URL(input.url)
            : new URL(String(input));

        if (requestUrl.pathname === '/api/w/nuser/account/get') {
          forwardedCookieHeader = readHeader(input, init, 'cookie');

          if (
            forwardedCookieHeader?.includes('MUSIC_U=mock-session') ||
            forwardedCookieHeader?.includes('MUSIC_U=likes-session')
          ) {
            return createJsonResponse({
              code: 200,
              account: {
                id: forwardedCookieHeader.includes('MUSIC_U=likes-session')
                  ? 84
                  : 42,
              },
              profile: {
                userId: forwardedCookieHeader.includes('MUSIC_U=likes-session')
                  ? 84
                  : 42,
                nickname: forwardedCookieHeader.includes('MUSIC_U=likes-session')
                  ? 'Liked Songs User'
                  : 'Luna User',
                avatarUrl: forwardedCookieHeader.includes('MUSIC_U=likes-session')
                  ? 'https://cdn.music.test/liked-user.jpg'
                  : 'https://cdn.music.test/luna-user.jpg',
                signature: forwardedCookieHeader.includes('MUSIC_U=likes-session')
                  ? 'Keeps the cloud likes in sync'
                  : 'Night shift listener',
              },
            });
          }

          return createJsonResponse({
            code: 200,
            account: null,
            profile: null,
          });
        }

        if (requestUrl.pathname === '/api/user/playlist') {
          forwardedCookieHeader = readHeader(input, init, 'cookie');

          if (forwardedCookieHeader?.includes('MUSIC_U=likes-session')) {
            return createJsonResponse({
              code: 200,
              more: false,
              playlist: [
                {
                  id: 7777,
                  name: '我喜欢的音乐',
                  coverImgUrl: 'https://cdn.music.test/liked-playlist.jpg',
                  description: 'Cloud liked songs',
                  trackCount: likedPlaylistTracks.length,
                  specialType: 5,
                  creator: {
                    userId: 84,
                    nickname: 'Liked Songs User',
                  },
                },
              ],
            });
          }

          return createJsonResponse({
            code: 200,
            more: false,
            playlist: accountPlaylists,
          });
        }

        if (requestUrl.pathname === '/api/playlist/detail') {
          forwardedCookieHeader = readHeader(input, init, 'cookie');

          if (requestUrl.searchParams.get('id') === '7777') {
            return createJsonResponse({
              code: 200,
              result: {
                id: 7777,
                name: '我喜欢的音乐',
                coverImgUrl: 'https://cdn.music.test/liked-playlist.jpg',
                description: 'Cloud liked songs',
                trackCount: likedPlaylistTracks.length,
                updateFrequency: '实时更新',
                creator: {
                  nickname: 'Liked Songs User',
                },
                tracks: likedPlaylistTracks,
              },
            });
          }
        }

        if (requestUrl.pathname === '/api/like') {
          forwardedCookieHeader = readHeader(input, init, 'cookie');

          if (
            requestUrl.searchParams.get('like') === 'true' &&
            requestUrl.searchParams.get('id') === '9202'
          ) {
            likedPlaylistTracks = [
              ...likedPlaylistTracks,
              {
                id: 9202,
                name: 'Freshly Liked Track',
                fee: 0,
                duration: 212000,
                artists: [{ id: 83, name: 'Fresh Artist' }],
                album: {
                  id: 84,
                  name: 'Fresh Album',
                  picUrl: 'https://cdn.music.test/fresh-liked-track.jpg',
                },
              },
            ];
          }

          if (
            requestUrl.searchParams.get('like') === 'false' &&
            requestUrl.searchParams.get('id') === '9201'
          ) {
            likedPlaylistTracks = likedPlaylistTracks.filter(
              (track) => String(track.id) !== '9201'
            );
          }

          return createJsonResponse({
            code: 200,
          });
        }

        if (requestUrl.pathname === '/api/record/recent/song') {
          forwardedCookieHeader = readHeader(input, init, 'cookie');

          return createJsonResponse({
            code: 200,
            data: {
              list: recentPlayTracks.map((track, index) => ({
                resourceId: String(track.id),
                playTime: 1_720_000_000_000 - index,
                data: track,
              })),
            },
          });
        }

        if (requestUrl.pathname === '/api/scrobble') {
          forwardedCookieHeader = readHeader(input, init, 'cookie');

          if (requestUrl.searchParams.get('id') === '9302') {
            recentPlayTracks = [
              {
                id: 9302,
                name: 'Fresh Recent Track',
                fee: 0,
                duration: 206000,
                artists: [{ id: 93, name: 'Fresh Recent Artist' }],
                album: {
                  id: 94,
                  name: 'Fresh Recent Album',
                  picUrl: 'https://cdn.music.test/fresh-recent-track.jpg',
                },
              },
              ...recentPlayTracks,
            ];
          }

          return createJsonResponse({
            code: 200,
          });
        }

        if (requestUrl.pathname === '/api/playlist/subscribe') {
          forwardedCookieHeader = readHeader(input, init, 'cookie');

          if (requestUrl.searchParams.get('id') === '503') {
            accountPlaylists = [
              ...accountPlaylists,
              {
                id: 503,
                name: 'Fresh Collected Playlist',
                coverImgUrl: 'https://cdn.music.test/fresh-collected-playlist.jpg',
                description: 'Collected after sync',
                trackCount: 31,
                creator: {
                  userId: 8,
                  nickname: 'Playlist Curator',
                },
              },
            ];
          }

          return createJsonResponse({
            code: 200,
          });
        }

        if (requestUrl.pathname === '/api/playlist/unsubscribe') {
          forwardedCookieHeader = readHeader(input, init, 'cookie');

          if (requestUrl.searchParams.get('id') === '502') {
            accountPlaylists = accountPlaylists.filter(
              (playlist) => String(playlist.id) !== '502'
            );
          }

          return createJsonResponse({
            code: 200,
          });
        }

        return createJsonResponse(
          {
            error: `Unhandled fetch: ${requestUrl.pathname}`,
          },
          {
            status: 404,
          }
        );
      }
    ) as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns a signed-out account payload when no netease session cookie exists', async () => {
    const { GET } = await importMusicAccountRoute(
      '@/app/api/music/account/route'
    );
    const response = await GET(
      new NextRequest('http://localhost/api/music/account?source=netease')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      source: 'netease',
      authenticated: false,
      profile: null,
      playlists: [],
    });
  });

  it('stores a normalized netease session cookie and returns personal playlists after connect', async () => {
    const { POST } = await importMusicAccountRoute(
      '@/app/api/music/account/route'
    );
    const response = await POST(
      new NextRequest('http://localhost/api/music/account?source=netease', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cookie: 'MUSIC_U=mock-session; __csrf=csrf-token; foo=bar',
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(forwardedCookieHeader).toContain('MUSIC_U=mock-session');
    expect(forwardedCookieHeader).toContain('__csrf=csrf-token');
    expect(forwardedCookieHeader).not.toContain('foo=bar');
    expect(payload).toMatchObject({
      source: 'netease',
      authenticated: true,
      profile: {
        userId: '42',
        nickname: 'Luna User',
      },
    });
    expect(payload.playlists).toHaveLength(2);
    expect(payload.playlists[0]).toMatchObject({
      id: '501',
      kind: 'playlist',
      title: 'Created Playlist',
      accountPlaylistRole: 'owned',
    });
    expect(payload.playlists[1]).toMatchObject({
      id: '502',
      kind: 'playlist',
      title: 'Subscribed Playlist',
      accountPlaylistRole: 'subscribed',
    });
    expect(response.headers.get('set-cookie')).toContain(
      'lunatv_music_netease_session='
    );
  });

  it('clears the stored netease session cookie on disconnect', async () => {
    const { DELETE } = await importMusicAccountRoute(
      '@/app/api/music/account/route'
    );
    const response = await DELETE(
      new NextRequest('http://localhost/api/music/account?source=netease')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      source: 'netease',
      authenticated: false,
      profile: null,
      playlists: [],
    });
    expect(response.headers.get('set-cookie')).toContain(
      'lunatv_music_netease_session='
    );
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('returns the liked-song list for an authenticated music session', async () => {
    const { GET } = await importMusicAccountRoute(
      '@/app/api/music/account/likes/route'
    );
    const response = await GET(
      new NextRequest('http://localhost/api/music/account/likes?source=netease', {
        headers: {
          cookie: createStoredMusicAccountCookie('MUSIC_U=likes-session'),
        },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(forwardedCookieHeader).toContain('MUSIC_U=likes-session');
    expect(payload).toEqual([
      expect.objectContaining({
        id: '9201',
        title: 'Liked Session Track',
      }),
    ]);
  });

  it('returns 401 from the likes route when no music session exists', async () => {
    const { GET } = await importMusicAccountRoute(
      '@/app/api/music/account/likes/route'
    );
    const response = await GET(
      new NextRequest('http://localhost/api/music/account/likes?source=netease')
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({
      error: '未连接网易云账号，无法获取喜欢歌曲',
    });
  });

  it('returns the refreshed liked-song list after liking and unliking through the route', async () => {
    const { DELETE, POST } = await importMusicAccountRoute(
      '@/app/api/music/account/likes/route'
    );
    const likedSessionCookie = createStoredMusicAccountCookie(
      'MUSIC_U=likes-session'
    );
    const likeResponse = await POST(
      new NextRequest('http://localhost/api/music/account/likes?source=netease', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: likedSessionCookie,
        },
        body: JSON.stringify({
          trackId: '9202',
        }),
      })
    );
    const likePayload = await likeResponse.json();

    expect(likeResponse.status).toBe(200);
    expect(likePayload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '9201',
          title: 'Liked Session Track',
        }),
        expect.objectContaining({
          id: '9202',
          title: 'Freshly Liked Track',
        }),
      ])
    );

    const unlikeResponse = await DELETE(
      new NextRequest('http://localhost/api/music/account/likes?source=netease', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          cookie: likedSessionCookie,
        },
        body: JSON.stringify({
          trackId: '9201',
        }),
      })
    );
    const unlikePayload = await unlikeResponse.json();

    expect(unlikeResponse.status).toBe(200);
    expect(unlikePayload).toEqual([
      expect.objectContaining({
        id: '9202',
        title: 'Freshly Liked Track',
      }),
    ]);
  });

  it('returns the recent-play list for an authenticated music session', async () => {
    const { GET } = await importMusicAccountRoute(
      '@/app/api/music/account/recent-tracks/route'
    );
    const response = await GET(
      new NextRequest(
        'http://localhost/api/music/account/recent-tracks?source=netease',
        {
          headers: {
            cookie: createStoredMusicAccountCookie('MUSIC_U=likes-session'),
          },
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(forwardedCookieHeader).toContain('MUSIC_U=likes-session');
    expect(payload).toEqual([
      expect.objectContaining({
        id: '9301',
        title: 'Recent Session Track',
      }),
    ]);
  });

  it('returns 401 from the recent-tracks route when no music session exists', async () => {
    const { GET } = await importMusicAccountRoute(
      '@/app/api/music/account/recent-tracks/route'
    );
    const response = await GET(
      new NextRequest(
        'http://localhost/api/music/account/recent-tracks?source=netease'
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({
      error: '未连接网易云账号，无法获取最近播放',
    });
  });

  it('returns the refreshed recent-play list after reporting a played track through the route', async () => {
    const { POST } = await importMusicAccountRoute(
      '@/app/api/music/account/recent-tracks/route'
    );
    const recentSessionCookie = createStoredMusicAccountCookie(
      'MUSIC_U=likes-session'
    );
    const response = await POST(
      new NextRequest(
        'http://localhost/api/music/account/recent-tracks?source=netease',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: recentSessionCookie,
          },
          body: JSON.stringify({
            trackId: '9302',
          }),
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '9302',
          title: 'Fresh Recent Track',
        }),
        expect.objectContaining({
          id: '9301',
          title: 'Recent Session Track',
        }),
      ])
    );
    expect(payload[0]).toEqual(
      expect.objectContaining({
        id: '9302',
      })
    );
  });

  it('returns the refreshed account-playlist list after subscribing through the route', async () => {
    const { POST } = await importMusicAccountRoute(
      '@/app/api/music/account/playlists/subscriptions/route'
    );
    const sessionCookie = createStoredMusicAccountCookie('MUSIC_U=mock-session');
    const response = await POST(
      new NextRequest(
        'http://localhost/api/music/account/playlists/subscriptions?source=netease',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: sessionCookie,
          },
          body: JSON.stringify({
            playlistId: '503',
          }),
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '501',
          accountPlaylistRole: 'owned',
        }),
        expect.objectContaining({
          id: '503',
          title: 'Fresh Collected Playlist',
          accountPlaylistRole: 'subscribed',
        }),
      ])
    );
  });

  it('returns the refreshed account-playlist list after unsubscribing through the route', async () => {
    const { DELETE } = await importMusicAccountRoute(
      '@/app/api/music/account/playlists/subscriptions/route'
    );
    const sessionCookie = createStoredMusicAccountCookie('MUSIC_U=mock-session');
    const response = await DELETE(
      new NextRequest(
        'http://localhost/api/music/account/playlists/subscriptions?source=netease',
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            cookie: sessionCookie,
          },
          body: JSON.stringify({
            playlistId: '502',
          }),
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual([
      expect.objectContaining({
        id: '501',
        title: 'Created Playlist',
        accountPlaylistRole: 'owned',
      }),
    ]);
  });

  it('returns 401 from the playlist-subscription route when no music session exists', async () => {
    const { POST } = await importMusicAccountRoute(
      '@/app/api/music/account/playlists/subscriptions/route'
    );
    const response = await POST(
      new NextRequest(
        'http://localhost/api/music/account/playlists/subscriptions?source=netease',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            playlistId: '503',
          }),
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({
      error: '未连接网易云账号，无法收藏歌单',
    });
  });
});
