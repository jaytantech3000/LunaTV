import { NextRequest } from 'next/server';

const originalFetch = global.fetch;

interface MusicAccountQrRouteModule {
  GET: (request: NextRequest) => Promise<Response> | Response;
  POST: (request: NextRequest) => Promise<Response> | Response;
}

async function importMusicAccountQrRoute(
  modulePath: string
): Promise<MusicAccountQrRouteModule> {
  return (await import(modulePath)) as MusicAccountQrRouteModule;
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

describe('rebuilt music account qr route', () => {
  beforeEach(() => {
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl =
          input instanceof Request
            ? new URL(input.url)
            : new URL(String(input));

        if (requestUrl.pathname === '/api/login/qr/key') {
          return createJsonResponse({
            code: 200,
            data: {
              unikey: 'mock-unikey',
            },
          });
        }

        if (requestUrl.pathname === '/api/login/qr/create') {
          return createJsonResponse({
            code: 200,
            data: {
              qrurl: 'https://music.163.com/login?codekey=mock-unikey',
            },
          });
        }

        if (requestUrl.pathname === '/api/login/qr/check') {
          const key = requestUrl.searchParams.get('key');

          if (key === 'mock-unikey-scanned') {
            return createJsonResponse({
              code: 802,
            });
          }

          if (key === 'mock-unikey-expired') {
            return createJsonResponse({
              code: 800,
            });
          }

          if (key === 'mock-unikey-confirmed') {
            return createJsonResponse({
              code: 803,
              cookie: 'MUSIC_U=mock-session;;__csrf=csrf-token',
            });
          }

          return createJsonResponse({
            code: 801,
          });
        }

        if (requestUrl.pathname === '/api/w/nuser/account/get') {
          const forwardedCookieHeader = readHeader(input, init, 'cookie');

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

  it('creates a qr login session with key and image payload', async () => {
    const { POST } = await importMusicAccountQrRoute(
      '@/app/api/music/account/qr/route'
    );
    const response = await POST(
      new NextRequest('http://localhost/api/music/account/qr?source=netease', {
        method: 'POST',
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        key: 'mock-unikey',
        status: 'waiting',
        qrUrl: 'https://music.163.com/login?codekey=mock-unikey',
        qrImageDataUrl: expect.stringContaining('data:image/'),
      })
    );
  });

  it('maps qr polling states and writes session cookie on confirmed login', async () => {
    const { GET } = await importMusicAccountQrRoute(
      '@/app/api/music/account/qr/route'
    );

    const waitingResponse = await GET(
      new NextRequest(
        'http://localhost/api/music/account/qr?source=netease&key=mock-unikey'
      )
    );
    expect((await waitingResponse.json()).status).toBe('waiting');

    const scannedResponse = await GET(
      new NextRequest(
        'http://localhost/api/music/account/qr?source=netease&key=mock-unikey-scanned'
      )
    );
    expect((await scannedResponse.json()).status).toBe('scanned');

    const expiredResponse = await GET(
      new NextRequest(
        'http://localhost/api/music/account/qr?source=netease&key=mock-unikey-expired'
      )
    );
    expect((await expiredResponse.json()).status).toBe('expired');

    const confirmedResponse = await GET(
      new NextRequest(
        'http://localhost/api/music/account/qr?source=netease&key=mock-unikey-confirmed'
      )
    );
    const confirmedPayload = await confirmedResponse.json();

    expect(confirmedPayload.status).toBe('confirmed');
    expect(confirmedPayload.account).toMatchObject({
      authenticated: true,
      profile: { nickname: 'Luna User' },
    });
    expect(confirmedResponse.headers.get('set-cookie')).toContain(
      'lunatv_music_netease_session='
    );
  });
});
