import {
  listMusicRecentTracks,
  reportMusicTrackPlayed,
} from '../services/music-recent-tracks';

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

describe('music recent tracks service', () => {
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
          requestUrl.pathname === '/api/music/account/recent-tracks'
        ) {
          return createJsonResponse([
            {
              id: '9301',
              source: 'netease',
              title: 'Recent Session Track',
              artists: ['Recent Artist'],
              album: 'Recent Album',
              coverUrl: 'https://cdn.music.test/recent-track.jpg',
              durationMs: 223000,
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
          requestUrl.pathname === '/api/music/account/recent-tracks'
        ) {
          if (requestBody?.trackId === '9303') {
            return createJsonResponse(
              {
                error: '未连接网易云账号，无法上报最近播放',
              },
              {
                status: 401,
              }
            );
          }

          return createJsonResponse([
            {
              id: requestBody?.trackId || '',
              source: 'netease',
              title: 'Fresh Recent Track',
              artists: ['Fresh Recent Artist'],
              album: 'Fresh Recent Album',
              coverUrl: 'https://cdn.music.test/fresh-recent-track.jpg',
              durationMs: 206000,
              stream: '',
              playable: true,
            },
            {
              id: '9301',
              source: 'netease',
              title: 'Recent Session Track',
              artists: ['Recent Artist'],
              album: 'Recent Album',
              coverUrl: 'https://cdn.music.test/recent-track.jpg',
              durationMs: 223000,
              stream: '',
              playable: true,
            },
          ]);
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

  it('lists normalized recent-track records from the account recent-tracks route', async () => {
    const payload = await listMusicRecentTracks();

    expect(payload).toHaveLength(1);
    expect(payload[0]).toEqual(
      expect.objectContaining({
        track: expect.objectContaining({
          id: '9301',
          title: 'Recent Session Track',
        }),
      })
    );
    expect(payload[0].playedAt).toBeGreaterThan(0);
  });

  it('reports a played track through the account recent-tracks route and returns normalized records', async () => {
    const payload = await reportMusicTrackPlayed('9302');

    expect(payload).toHaveLength(2);
    expect(payload[0]).toEqual(
      expect.objectContaining({
        track: expect.objectContaining({
          id: '9302',
          title: 'Fresh Recent Track',
        }),
      })
    );
    expect(payload[1]).toEqual(
      expect.objectContaining({
        track: expect.objectContaining({
          id: '9301',
        }),
      })
    );
    expect(payload[0].playedAt).toBeGreaterThan(payload[1].playedAt);
  });

  it('propagates the upstream 401 error payload when reporting recent-play sync fails', async () => {
    await expect(reportMusicTrackPlayed('9303')).rejects.toMatchObject({
      message: '未连接网易云账号，无法上报最近播放',
      status: 401,
    });
  });
});
