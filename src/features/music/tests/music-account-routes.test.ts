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

describe('rebuilt music account route', () => {
  beforeEach(() => {
    forwardedCookieHeader = null;
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl =
          input instanceof Request
            ? new URL(input.url)
            : new URL(String(input));

        if (requestUrl.pathname === '/api/w/nuser/account/get') {
          forwardedCookieHeader = readHeader(input, init, 'cookie');

          if (forwardedCookieHeader?.includes('MUSIC_U=mock-session')) {
            return createJsonResponse({
              code: 200,
              account: {
                id: 42,
              },
              profile: {
                userId: 42,
                nickname: 'Luna User',
                avatarUrl: 'https://cdn.music.test/luna-user.jpg',
                signature: 'Night shift listener',
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
          return createJsonResponse({
            code: 200,
            more: false,
            playlist: [
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
            ],
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
});
