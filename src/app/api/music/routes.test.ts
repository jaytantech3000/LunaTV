import { NextRequest } from 'next/server';

import { GET as getMusicCollection } from './collection/route';
import { GET as getMusicHome } from './home/route';
import { GET as getMusicLyric } from './lyric/route';
import { GET as getMusicSearch } from './search/route';
import { GET as getMusicSources } from './sources/route';
import { GET as getMusicTrack } from './track/route';

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

function createMusicFetchMock(): jest.MockedFunction<typeof fetch> {
  return jest.fn(async (input) => {
    const requestUrl = new URL(String(input));
    const pathname = requestUrl.pathname;
    const type = requestUrl.searchParams.get('type');
    const id = requestUrl.searchParams.get('id');

    if (pathname === '/api/toplist') {
      return createJsonResponse({
        code: 200,
        list: [
          {
            id: 101,
            name: 'Top Rank',
            coverImgUrl: 'http://cdn.example.com/top-rank.jpg',
            description: 'Top rank description',
            trackCount: 2,
            updateFrequency: '刚刚更新',
          },
        ],
      });
    }

    if (pathname === '/api/personalized/playlist') {
      return createJsonResponse({
        code: 200,
        result: [
          {
            id: 301,
            name: 'Focus Playlist',
            picUrl: 'http://cdn.example.com/focus-playlist.jpg',
            copywriter: '适合夜晚循环',
            trackCount: 2,
          },
        ],
      });
    }

    if (pathname === '/api/search/get/web' && type === '1000') {
      return createJsonResponse({
        code: 200,
        result: {
          playlistCount: 1,
          playlists: [
            {
              id: 301,
              name: 'Focus Playlist',
              coverImgUrl: 'http://cdn.example.com/focus-playlist.jpg',
              description: '适合夜晚循环',
              trackCount: 2,
            },
          ],
        },
      });
    }

    if (pathname === '/api/search/get/web') {
      return createJsonResponse({
        code: 200,
        result: {
          songCount: 1,
          songs: [
            {
              id: 9001,
              name: 'Search Song',
              duration: 187000,
              artists: [{ id: 1, name: 'Search Artist' }],
              album: {
                id: 11,
                name: 'Search Album',
                picUrl: 'http://cdn.example.com/search-album.jpg',
              },
            },
          ],
        },
      });
    }

    if (pathname === '/api/playlist/detail' && id === '301') {
      return createJsonResponse({
        code: 200,
        result: {
          id: 301,
          name: 'Focus Playlist',
          coverImgUrl: 'http://cdn.example.com/focus-playlist.jpg',
          description: '适合夜晚循环',
          trackCount: 2,
          creator: { nickname: 'Playlist Curator' },
          updateFrequency: '每日更新',
          tracks: [
            {
              id: 9001,
              name: 'Playlist Song',
              duration: 187000,
              artists: [{ id: 1, name: 'Search Artist' }],
              album: {
                id: 11,
                name: 'Search Album',
                picUrl: 'http://cdn.example.com/search-album.jpg',
              },
            },
          ],
        },
      });
    }

    if (pathname === '/api/playlist/detail') {
      return createJsonResponse({
        code: 200,
        result: {
          id: 101,
          name: 'Top Rank',
          coverImgUrl: 'http://cdn.example.com/top-rank.jpg',
          description: 'Top rank description',
          trackCount: 2,
          updateFrequency: '刚刚更新',
          tracks: [
            {
              id: 9001,
              name: 'Top Song 1',
              duration: 187000,
              artists: [{ id: 1, name: 'Search Artist' }],
              album: {
                id: 11,
                name: 'Search Album',
                picUrl: 'http://cdn.example.com/search-album.jpg',
              },
            },
            {
              id: 9002,
              name: 'Top Song 2',
              duration: 188000,
              artists: [{ id: 2, name: 'Second Artist' }],
              album: {
                id: 12,
                name: 'Second Album',
                picUrl: 'http://cdn.example.com/second-album.jpg',
              },
            },
          ],
        },
      });
    }

    if (pathname === '/api/song/detail') {
      return createJsonResponse({
        code: 200,
        songs: [
          {
            id: 9001,
            name: 'Track Detail',
            duration: 187000,
            artists: [{ id: 1, name: 'Track Artist' }],
            album: {
              id: 21,
              name: 'Track Album',
              picUrl: 'http://cdn.example.com/track-album.jpg',
            },
          },
        ],
      });
    }

    if (pathname === '/api/song/lyric') {
      return createJsonResponse({
        code: 200,
        lrc: {
          lyric: '[00:01.00]第一句\n[00:02.50]第二句',
        },
        tlyric: {
          lyric: '[00:01.00]first\n[00:02.50]second',
        },
      });
    }

    throw new Error(`Unexpected fetch url: ${requestUrl.toString()}`);
  }) as jest.MockedFunction<typeof fetch>;
}

describe('/api/music route handlers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://music.163.com';
    global.fetch = createMusicFetchMock();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
  });

  it('returns only netease as enabled and keeps unfinished providers disabled', async () => {
    const response = await getMusicSources();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sources[0]).toEqual(
      expect.objectContaining({
        key: 'netease',
        enabled: true,
      })
    );
    expect(payload.sources[1]).toEqual(
      expect.objectContaining({
        key: 'qq',
        enabled: false,
      })
    );
    expect(payload.sources[2]).toEqual(
      expect.objectContaining({
        key: 'kugou',
        enabled: false,
      })
    );
  });

  it('hydrates music routes from netease upstream payloads', async () => {
    const homeResponse = await getMusicHome(
      new NextRequest('http://localhost/api/music/home?source=netease')
    );
    const searchResponse = await getMusicSearch(
      new NextRequest('http://localhost/api/music/search?source=netease&q=test')
    );
    const collectionResponse = await getMusicCollection(
      new NextRequest(
        'http://localhost/api/music/collection?source=netease&id=301'
      )
    );
    const trackResponse = await getMusicTrack(
      new NextRequest('http://localhost/api/music/track?source=netease&id=9001')
    );
    const lyricResponse = await getMusicLyric(
      new NextRequest('http://localhost/api/music/lyric?source=netease&id=9001')
    );

    const homePayload = await homeResponse.json();
    const searchPayload = await searchResponse.json();
    const collectionPayload = await collectionResponse.json();
    const trackPayload = await trackResponse.json();
    const lyricPayload = await lyricResponse.json();

    expect(homePayload.spotlight[0].title).toBe('Top Song 1');
    expect(homePayload.sections[0].tab).toBe('rank');
    expect(searchPayload.tracks[0].title).toBe('Search Song');
    expect(searchPayload.collections[0].id).toBe('301');
    expect(collectionPayload.title).toBe('Focus Playlist');
    expect(collectionPayload.tracks[0].title).toBe('Playlist Song');
    expect(trackPayload.track.title).toBe('Track Detail');
    expect(trackPayload.streamUrl).toBe(
      '/media/audio/stream?source=netease&id=9001&quality=standard'
    );
    expect(lyricPayload.lines[0]).toEqual(
      expect.objectContaining({
        text: '第一句',
        translation: 'first',
      })
    );
  });

  it('rejects unsupported music sources', async () => {
    const response = await getMusicHome(
      new NextRequest('http://localhost/api/music/home?source=qq')
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported music source',
    });
  });
});
