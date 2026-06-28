import {
  likeMusicTrack,
  listMusicLikedTracks,
  unlikeMusicTrack,
} from '../services/music-liked-tracks';

const originalFetch = global.fetch;

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

describe('music liked tracks service', () => {
  beforeEach(() => {
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl =
          input instanceof Request
            ? new URL(input.url, 'http://localhost')
            : new URL(String(input), 'http://localhost');
        const requestMethod =
          input instanceof Request ? input.method : init?.method || 'GET';
        const rawRequestBody =
          input instanceof Request
            ? await input.clone().text()
            : typeof init?.body === 'string'
            ? init.body
            : '';
        const requestBody = rawRequestBody
          ? (JSON.parse(rawRequestBody) as {
              trackId?: string;
            })
          : null;

        if (
          requestMethod === 'GET' &&
          requestUrl.pathname === '/api/music/account/likes'
        ) {
          return createJsonResponse([
            {
              id: '9201',
              source: 'netease',
              title: 'Liked Session Track',
              artists: ['Liked Artist'],
              album: 'Liked Album',
              coverUrl: 'https://cdn.music.test/liked-track.jpg',
              durationMs: 204000,
              stream: '',
              playable: true,
            },
            {
              id: '',
              source: 'netease',
              title: '',
              artists: [],
              album: '',
              coverUrl: '',
              durationMs: 0,
              stream: '',
              playable: true,
            },
          ]);
        }

        if (
          requestMethod === 'POST' &&
          requestUrl.pathname === '/api/music/account/likes'
        ) {
          return createJsonResponse([
            {
              id: requestBody?.trackId || '',
              source: 'netease',
              title: 'Freshly Liked Track',
              artists: ['Fresh Artist'],
              album: 'Fresh Album',
              coverUrl: 'https://cdn.music.test/fresh-liked-track.jpg',
              durationMs: 212000,
              stream: '',
              playable: true,
            },
          ]);
        }

        if (
          requestMethod === 'DELETE' &&
          requestUrl.pathname === '/api/music/account/likes'
        ) {
          return createJsonResponse(
            {
              error: '未连接网易云账号，无法取消收藏歌曲',
            },
            {
              status: 401,
            }
          );
        }

        return createJsonResponse(
          {
            error: `Unhandled request: ${requestMethod} ${requestUrl.pathname}`,
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

  it('lists normalized liked-track records from the account likes route', async () => {
    const payload = await listMusicLikedTracks();

    expect(payload).toHaveLength(1);
    expect(payload[0]).toEqual(
      expect.objectContaining({
        track: expect.objectContaining({
          id: '9201',
          title: 'Liked Session Track',
        }),
      })
    );
    expect(payload[0].savedAt).toBeGreaterThan(0);
  });

  it('likes a track through the account likes route and returns normalized records', async () => {
    const payload = await likeMusicTrack('9202');

    expect(payload).toEqual([
      expect.objectContaining({
        track: expect.objectContaining({
          id: '9202',
          title: 'Freshly Liked Track',
        }),
      }),
    ]);
  });

  it('propagates the upstream 401 error payload when unliking fails', async () => {
    await expect(unlikeMusicTrack('9201')).rejects.toMatchObject({
      message: '未连接网易云账号，无法取消收藏歌曲',
      status: 401,
    });
  });
});
