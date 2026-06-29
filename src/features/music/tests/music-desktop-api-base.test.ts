import {
  createMusicAccountQrSession,
  fetchMusicAccountState,
} from '../services/music-account-api-client';
import { subscribeMusicAccountPlaylist } from '../services/music-account-playlists';
import { fetchMusicHomeView } from '../services/music-api-client';
import { listMusicLikedTracks } from '../services/music-liked-tracks';
import { listMusicRecentTracks } from '../services/music-recent-tracks';

const originalFetch = global.fetch;
const originalRuntimeConfig = window.RUNTIME_CONFIG;

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

describe('desktop music api base routing', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    window.RUNTIME_CONFIG = {
      API_BASE_URL: 'http://127.0.0.1:8787/',
    };

    fetchMock = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl =
          input instanceof Request
            ? new URL(input.url, 'http://localhost')
            : new URL(String(input), 'http://localhost');
        const requestMethod =
          input instanceof Request ? input.method : init?.method || 'GET';

        if (
          requestMethod === 'GET' &&
          requestUrl.pathname === '/api/music/home'
        ) {
          return createJsonResponse({
            source: 'netease',
            hero: {
              title: 'Desktop home',
            },
          });
        }

        if (
          requestMethod === 'GET' &&
          requestUrl.pathname === '/api/music/account'
        ) {
          return createJsonResponse({
            source: 'netease',
            connected: false,
            profile: null,
          });
        }

        if (
          requestMethod === 'POST' &&
          requestUrl.pathname === '/api/music/account/qr'
        ) {
          return createJsonResponse({
            key: 'desktop-qr-key',
            qrUrl: 'https://music.163.com/login?codekey=desktop-qr-key',
            qrImageDataUrl: 'data:image/png;base64,desktop-qr',
          });
        }

        if (
          requestMethod === 'POST' &&
          requestUrl.pathname === '/api/music/account/playlists/subscriptions'
        ) {
          return createJsonResponse([
            {
              id: 'playlist-1',
              source: 'netease',
              kind: 'playlist',
              title: 'Desktop Playlist',
            },
          ]);
        }

        if (
          requestMethod === 'GET' &&
          requestUrl.pathname === '/api/music/account/likes'
        ) {
          return createJsonResponse([
            {
              id: 'like-1',
              source: 'netease',
              title: 'Liked track',
              artists: ['Artist'],
              album: 'Album',
              coverUrl: '',
              durationMs: 180000,
              stream: '',
              playable: true,
            },
          ]);
        }

        if (
          requestMethod === 'GET' &&
          requestUrl.pathname === '/api/music/account/recent-tracks'
        ) {
          return createJsonResponse([
            {
              id: 'recent-1',
              source: 'netease',
              title: 'Recent track',
              artists: ['Artist'],
              album: 'Album',
              coverUrl: '',
              durationMs: 180000,
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
    ) as jest.MockedFunction<typeof fetch>;

    global.fetch = fetchMock;
  });

  afterAll(() => {
    global.fetch = originalFetch;

    if (originalRuntimeConfig === undefined) {
      delete window.RUNTIME_CONFIG;
    } else {
      window.RUNTIME_CONFIG = originalRuntimeConfig;
    }
  });

  it('routes desktop music home requests through the runtime api base url', async () => {
    await fetchMusicHomeView('netease');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/music/home?source=netease',
      expect.objectContaining({
        cache: 'no-store',
        method: 'GET',
      })
    );
  });

  it('routes desktop music account and qr requests through the runtime api base url', async () => {
    await fetchMusicAccountState('netease');
    await createMusicAccountQrSession('netease');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8787/api/music/account?source=netease',
      expect.objectContaining({
        cache: 'no-store',
        method: 'GET',
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8787/api/music/account/qr?source=netease',
      expect.objectContaining({
        cache: 'no-store',
        method: 'POST',
      })
    );
  });

  it('routes desktop music library sync requests through the runtime api base url', async () => {
    await subscribeMusicAccountPlaylist('playlist-1');
    await listMusicLikedTracks();
    await listMusicRecentTracks();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8787/api/music/account/playlists/subscriptions?source=netease',
      expect.objectContaining({
        cache: 'no-store',
        method: 'POST',
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8787/api/music/account/likes?source=netease',
      expect.objectContaining({
        cache: 'no-store',
        method: 'GET',
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:8787/api/music/account/recent-tracks?source=netease',
      expect.objectContaining({
        cache: 'no-store',
        method: 'GET',
      })
    );
  });
});
