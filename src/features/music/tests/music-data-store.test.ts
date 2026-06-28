import { useLyricsStore } from '../state/lyrics-store';
import { useMusicDataStore } from '../state/music-data-store';
import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

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

describe('useMusicDataStore', () => {
  beforeEach(() => {
    useMusicDataStore.setState({
      source: 'netease',
      homeView: null,
      searchResult: null,
      selectedCollection: null,
      preferredPlaybackQuality: 'standard',
      loading: false,
      error: null,
    });
    usePlaybackStore.setState({
      queue: [],
      currentTrackId: null,
      playState: 'idle',
      playMode: 'list-loop',
      volume: 0.9,
      muted: false,
      positionMs: 0,
      durationMs: 0,
      bufferedMs: 0,
      requestedSeekMs: null,
      error: null,
    });
    useLyricsStore.setState({
      lyrics: null,
      activeLineIndex: -1,
      followMode: 'auto',
      manualSeekLock: false,
    });
    usePlayerSurfaceStore.setState({
      miniVisible: false,
      fullPlayerOpen: false,
      lyricsPanelOpen: true,
      queuePanelOpen: false,
      transitionState: 'idle',
    });

    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl =
          input instanceof Request
            ? new URL(input.url)
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
              action?: string;
              trackId?: string;
            })
          : null;

        if (requestUrl.pathname === '/api/music/home') {
          return createJsonResponse({
            source: 'netease',
            spotlight: [],
            sections: [
              {
                id: 'netease-rank',
                title: '官方榜单',
                tab: 'rank',
                kind: 'collection-list',
                collections: [],
              },
            ],
            featuredQueue: [],
          });
        }

        if (requestUrl.pathname === '/api/music/search') {
          return createJsonResponse({
            source: 'netease',
            query: requestUrl.searchParams.get('q') || '',
            tracks: [
              {
                id: '9101',
                source: 'netease',
                title: 'Search Track',
                artists: ['Search Artist'],
                album: 'Search Album',
                coverUrl: 'https://cdn.music.test/search-track.jpg',
                durationMs: 201000,
                stream: '',
                playable: true,
              },
            ],
            collections: [],
          });
        }

        if (requestUrl.pathname === '/api/music/collection') {
          return createJsonResponse({
            summary: {
              id: requestUrl.searchParams.get('id') || '',
              source: 'netease',
              kind: 'playlist',
              title: 'Focused Collection',
              coverUrl: 'https://cdn.music.test/collection.jpg',
              description: 'Collection description',
              trackCount: 1,
              accentColor: '#ff5f6d',
            },
            curator: '网易云音乐',
            updatedAtLabel: '每日更新',
            tracks: [
              {
                id: '9001',
                source: 'netease',
                title: 'Collection Track',
                artists: ['Artist A'],
                album: 'Album A',
                coverUrl: 'https://cdn.music.test/album-a.jpg',
                durationMs: 215000,
                stream: '',
                playable: true,
              },
              {
                id: '9002',
                source: 'netease',
                title: 'Collection Track Two',
                artists: ['Artist B'],
                album: 'Album B',
                coverUrl: 'https://cdn.music.test/album-b.jpg',
                durationMs: 223000,
                stream: '',
                playable: true,
              },
            ],
          });
        }

        if (requestUrl.pathname === '/api/music/track') {
          const trackId = requestUrl.searchParams.get('id') || '9001';

          return createJsonResponse({
            track: {
              id: trackId,
              source: 'netease',
              title:
                trackId === '9002' ? 'Collection Track Two' : 'Search Track',
              artists: trackId === '9002' ? ['Artist B'] : ['Search Artist'],
              album: trackId === '9002' ? 'Album B' : 'Search Album',
              coverUrl:
                trackId === '9002'
                  ? 'https://cdn.music.test/album-b.jpg'
                  : 'https://cdn.music.test/search-track.jpg',
              durationMs: trackId === '9002' ? 223000 : 201000,
              stream: '',
              playable: true,
            },
            quality: 'standard',
            streamUrl: `/api/music/stream?source=netease&id=${trackId}&quality=standard`,
          });
        }

        if (requestUrl.pathname === '/api/music/lyric') {
          const trackId = requestUrl.searchParams.get('id') || '9001';

          return createJsonResponse({
            trackId,
            source: 'netease',
            offsetMs: 0,
            lines: [
              {
                timeMs: 1000,
                text: trackId === '9002' ? '第二首第一句' : '搜索首句',
              },
            ],
          });
        }

        if (requestUrl.pathname === '/api/music/fm') {
          if (requestMethod === 'POST' && requestBody?.action === 'trash') {
            return createJsonResponse([
              {
                id: '9701',
                source: 'netease',
                title: 'FM Trash Replacement',
                artists: ['Trash Artist'],
                album: 'Trash Album',
                coverUrl: 'https://cdn.music.test/fm-trash.jpg',
                durationMs: 203000,
                stream: '',
                playable: true,
              },
            ]);
          }

          return createJsonResponse([
            {
              id: '9601',
              source: 'netease',
              title: 'FM Refresh Track One',
              artists: ['FM Refresh Artist'],
              album: 'FM Refresh Album',
              coverUrl: 'https://cdn.music.test/fm-refresh-1.jpg',
              durationMs: 204000,
              stream: '',
              playable: true,
            },
            {
              id: '9602',
              source: 'netease',
              title: 'FM Refresh Track Two',
              artists: ['FM Refresh Artist'],
              album: 'FM Refresh Album',
              coverUrl: 'https://cdn.music.test/fm-refresh-2.jpg',
              durationMs: 206000,
              stream: '',
              playable: true,
            },
          ]);
        }

        return createJsonResponse(
          {
            error: `Unhandled fetch: ${requestUrl.pathname}`,
          },
          {
            status: 500,
          }
        );
      }
    ) as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('bootstraps home data into the new music data store', async () => {
    await useMusicDataStore.getState().bootstrap();

    expect(useMusicDataStore.getState().homeView?.source).toBe('netease');
    expect(useMusicDataStore.getState().loading).toBe(false);
    expect(useMusicDataStore.getState().error).toBeNull();
  });

  it('stores search results after submitting a query', async () => {
    await useMusicDataStore.getState().submitSearch('hello');

    expect(useMusicDataStore.getState().searchResult?.query).toBe('hello');
    expect(useMusicDataStore.getState().searchResult?.tracks[0]?.title).toBe(
      'Search Track'
    );
  });

  it('stores selected collection after opening a playlist', async () => {
    await useMusicDataStore.getState().openCollection('19723756');

    expect(useMusicDataStore.getState().selectedCollection?.summary.id).toBe(
      '19723756'
    );
    expect(useMusicDataStore.getState().selectedCollection?.tracks[0]?.id).toBe(
      '9001'
    );
  });

  it('plays a selected track with rebuilt playback, lyrics, and mini player state', async () => {
    await useMusicDataStore.getState().openCollection('19723756');
    await useMusicDataStore.getState().playTrack('9002', 'collection');

    expect(usePlaybackStore.getState().currentTrackId).toBe('9002');
    expect(usePlaybackStore.getState().queue).toHaveLength(2);
    expect(usePlaybackStore.getState().queue[1]?.track.stream).toBe(
      '/api/music/stream?source=netease&id=9002&quality=standard'
    );
    expect(useLyricsStore.getState().lyrics?.trackId).toBe('9002');
    expect(usePlayerSurfaceStore.getState().miniVisible).toBe(true);
  });

  it('captures route errors into store state', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      global.fetch = jest.fn(async (input: RequestInfo | URL) => {
        const requestUrl =
          input instanceof Request
            ? new URL(input.url)
            : new URL(String(input), 'http://localhost');

        if (requestUrl.pathname === '/api/music/home') {
          return createJsonResponse(
            {
              error: '音乐上游请求失败',
            },
            {
              status: 502,
            }
          );
        }

        return createJsonResponse({
          error: `Unhandled fetch: ${requestUrl.pathname}`,
        });
      }) as typeof fetch;

      await useMusicDataStore.getState().bootstrap();

      expect(useMusicDataStore.getState().homeView).toBeNull();
      expect(useMusicDataStore.getState().loading).toBe(false);
      expect(useMusicDataStore.getState().error).toBe('音乐上游请求失败');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('refreshes the personal fm queue when advancing from the last fm track', async () => {
    useMusicDataStore.setState({
      homeView: {
        source: 'netease',
        spotlight: [],
        sections: [
          {
            id: 'netease-fm',
            title: '私人 FM',
            tab: 'fm',
            kind: 'track-list',
            tracks: [
              {
                id: '9501',
                source: 'netease',
                title: 'FM Session Track',
                artists: ['FM Artist'],
                album: 'FM Album',
                coverUrl: 'https://cdn.music.test/fm-track.jpg',
                durationMs: 214000,
                stream: '',
                playable: true,
              },
            ],
          },
        ],
        featuredQueue: [],
      },
    });
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'fm-1',
        addedAt: 1,
        fromContext: 'fm',
        track: {
          id: '9501',
          source: 'netease',
          title: 'FM Session Track',
          artists: ['FM Artist'],
          album: 'FM Album',
          coverUrl: 'https://cdn.music.test/fm-track.jpg',
          durationMs: 214000,
          stream: '',
          playable: true,
        },
      },
    ]);
    useLyricsStore.setState({
      lyrics: {
        trackId: '9501',
        source: 'netease',
        offsetMs: 0,
        lines: [{ timeMs: 1000, text: 'FM 第一段' }],
      },
      activeLineIndex: 0,
      followMode: 'auto',
      manualSeekLock: false,
    });

    await useMusicDataStore.getState().advancePlayback();

    expect(usePlaybackStore.getState().currentTrackId).toBe('9601');
    expect(
      usePlaybackStore.getState().queue.map((item) => item.track.id)
    ).toEqual(['9601', '9602']);
    expect(usePlaybackStore.getState().queue[0]?.fromContext).toBe('fm');
    expect(useLyricsStore.getState().lyrics).toBeNull();
    expect(
      useMusicDataStore
        .getState()
        .homeView?.sections.find((section) => section.tab === 'fm')?.tracks?.[0]
        ?.id
    ).toBe('9601');
  });

  it('posts trash feedback and replaces the active personal fm queue', async () => {
    useMusicDataStore.setState({
      homeView: {
        source: 'netease',
        spotlight: [],
        sections: [
          {
            id: 'netease-fm',
            title: '私人 FM',
            tab: 'fm',
            kind: 'track-list',
            tracks: [
              {
                id: '9501',
                source: 'netease',
                title: 'FM Session Track',
                artists: ['FM Artist'],
                album: 'FM Album',
                coverUrl: 'https://cdn.music.test/fm-track.jpg',
                durationMs: 214000,
                stream: '',
                playable: true,
              },
            ],
          },
        ],
        featuredQueue: [],
      },
    });
    usePlaybackStore.getState().seedQueue([
      {
        queueId: 'fm-1',
        addedAt: 1,
        fromContext: 'fm',
        track: {
          id: '9501',
          source: 'netease',
          title: 'FM Session Track',
          artists: ['FM Artist'],
          album: 'FM Album',
          coverUrl: 'https://cdn.music.test/fm-track.jpg',
          durationMs: 214000,
          stream: '',
          playable: true,
        },
      },
    ]);

    await useMusicDataStore.getState().trashCurrentPersonalFmTrack();

    expect(usePlaybackStore.getState().currentTrackId).toBe('9701');
    expect(usePlaybackStore.getState().queue).toEqual([
      expect.objectContaining({
        fromContext: 'fm',
        track: expect.objectContaining({
          id: '9701',
          title: 'FM Trash Replacement',
        }),
      }),
    ]);

    const fmRequests = (global.fetch as jest.Mock).mock.calls
      .map(([input, requestInit]) => ({
        method:
          input instanceof Request
            ? input.method
            : requestInit?.method || 'GET',
        url:
          input instanceof Request
            ? new URL(input.url)
            : new URL(String(input), 'http://localhost'),
      }))
      .filter((call) => call.url.pathname === '/api/music/fm');

    expect(fmRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
        }),
      ])
    );
  });
});
