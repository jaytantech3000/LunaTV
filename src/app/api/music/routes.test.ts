import { NextRequest } from 'next/server';

import { GET as getMusicCollection } from './collection/route';
import { GET as getMusicHome } from './home/route';
import { GET as getMusicLyric } from './lyric/route';
import { GET as getMusicSearch } from './search/route';
import { GET as getMusicSources } from './sources/route';
import { GET as getMusicTrack } from './track/route';

interface MusicFetchMockOptions {
  failToplistDetail?: boolean;
  paidTrackId?: number;
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

function createMusicFetchMock(
  options: MusicFetchMockOptions = {}
): jest.MockedFunction<typeof fetch> {
  return jest.fn(async (input) => {
    const requestUrl = new URL(String(input));
    const host = requestUrl.host;
    const pathname = requestUrl.pathname;
    const type = requestUrl.searchParams.get('type');
    const id = requestUrl.searchParams.get('id');
    const ids = requestUrl.searchParams.get('ids');
    const paidTrackId = options.paidTrackId || 0;

    if (host === 'api.audius.co' && pathname === '/v1/tracks/trending') {
      return createJsonResponse({
        data: [
          {
            id: 'audius-track-1',
            title: 'Audius Spotlight',
            duration: 201,
            genre: 'Electronic',
            artwork: {
              '1000x1000': 'https://cdn.audius.test/spotlight.jpg',
            },
            user: {
              id: 'artist-1',
              name: 'Audius Artist',
            },
          },
        ],
      });
    }

    if (host === 'api.audius.co' && pathname === '/v1/playlists/trending') {
      return createJsonResponse({
        data: [
          {
            id: 'audius-playlist-1',
            playlist_name: 'Audius Trending Playlist',
            description: 'Fresh from Audius',
            track_count: 2,
            artwork: {
              '1000x1000': 'https://cdn.audius.test/playlist.jpg',
            },
            user: {
              id: 'curator-1',
              name: 'Audius Curator',
            },
          },
        ],
      });
    }

    if (host === 'api.audius.co' && pathname === '/v1/tracks/search') {
      return createJsonResponse({
        data: [
          {
            id: 'audius-search-track-1',
            title: 'Audius Search Track',
            duration: 189,
            genre: 'House',
            artwork: {
              '1000x1000': 'https://cdn.audius.test/search-track.jpg',
            },
            user: {
              id: 'artist-2',
              name: 'Search Artist',
            },
          },
        ],
      });
    }

    if (host === 'api.audius.co' && pathname === '/v1/playlists/search') {
      return createJsonResponse({
        data: [
          {
            id: 'audius-playlist-2',
            playlist_name: 'Audius Search Playlist',
            description: 'Search playlist',
            track_count: 1,
            artwork: {
              '1000x1000': 'https://cdn.audius.test/search-playlist.jpg',
            },
            user: {
              id: 'curator-2',
              name: 'Search Curator',
            },
          },
        ],
      });
    }

    if (
      host === 'api.audius.co' &&
      pathname === '/v1/playlists/audius-playlist-1'
    ) {
      return createJsonResponse({
        data: [
          {
            id: 'audius-playlist-1',
            playlist_name: 'Audius Trending Playlist',
            description: 'Fresh from Audius',
            track_count: 2,
            artwork: {
              '1000x1000': 'https://cdn.audius.test/playlist.jpg',
            },
            user: {
              id: 'curator-1',
              name: 'Audius Curator',
            },
            tracks: [
              {
                id: 'audius-track-1',
                title: 'Playlist Audius Track',
                duration: 201,
                genre: 'Electronic',
                artwork: {
                  '1000x1000': 'https://cdn.audius.test/playlist-track.jpg',
                },
                user: {
                  id: 'artist-1',
                  name: 'Audius Artist',
                },
              },
            ],
          },
        ],
      });
    }

    if (host === 'api.audius.co' && pathname === '/v1/tracks/audius-track-1') {
      return createJsonResponse({
        data: {
          id: 'audius-track-1',
          title: 'Audius Track Detail',
          duration: 201,
          genre: 'Electronic',
          artwork: {
            '1000x1000': 'https://cdn.audius.test/track-detail.jpg',
          },
          stream: {
            url: 'https://stream.audius.test/audius-track-1.mp3',
          },
          access: {
            stream: true,
          },
          user: {
            id: 'artist-1',
            name: 'Audius Artist',
          },
        },
      });
    }

    if (host === 'api.jamendo.com' && pathname === '/v3.0/tracks/') {
      if (id === 'jamendo-track-1') {
        return createJsonResponse({
          headers: {
            status: 'success',
          },
          results: [
            {
              id: 'jamendo-track-1',
              name: 'Jamendo Track Detail',
              duration: 233,
              artist_name: 'Jamendo Artist',
              album_id: 'album-1',
              album_name: 'Jamendo Album',
              image: 'https://cdn.jamendo.test/track.jpg',
              audio: 'https://stream.jamendo.test/jamendo-track-1.mp3',
            },
          ],
        });
      }

      return createJsonResponse({
        headers: {
          status: 'success',
        },
        results: [
          {
            id: 'jamendo-track-2',
            name: 'Jamendo Search Track',
            duration: 244,
            artist_name: 'Jamendo Search Artist',
            album_id: 'album-2',
            album_name: 'Jamendo Search Album',
            image: 'https://cdn.jamendo.test/search-track.jpg',
            audio: 'https://stream.jamendo.test/jamendo-track-2.mp3',
          },
        ],
      });
    }

    if (host === 'api.jamendo.com' && pathname === '/v3.0/playlists/') {
      return createJsonResponse({
        headers: {
          status: 'success',
        },
        results: [
          {
            id: 'jamendo-playlist-1',
            name: 'Jamendo Featured Playlist',
            creationdate: '2026-06-01',
            user_name: 'Jamendo Curator',
            image: 'https://cdn.jamendo.test/playlist.jpg',
          },
        ],
      });
    }

    if (host === 'api.jamendo.com' && pathname === '/v3.0/playlists/tracks/') {
      return createJsonResponse({
        headers: {
          status: 'success',
        },
        results: [
          {
            id: 'jamendo-playlist-1',
            name: 'Jamendo Featured Playlist',
            creationdate: '2026-06-01',
            user_name: 'Jamendo Curator',
            image: 'https://cdn.jamendo.test/playlist.jpg',
            track_count: 1,
            tracks: [
              {
                id: 'jamendo-track-1',
                name: 'Jamendo Playlist Track',
                duration: 233,
                artist_name: 'Jamendo Artist',
                album_id: 'album-1',
                album_name: 'Jamendo Album',
                image: 'https://cdn.jamendo.test/playlist-track.jpg',
                audio: 'https://stream.jamendo.test/jamendo-track-1.mp3',
              },
            ],
          },
        ],
      });
    }

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
              fee: 0,
              duration: 187000,
              artists: [{ id: 1, name: 'Search Artist' }],
              album: {
                id: 11,
                name: 'Search Album',
                picUrl: 'http://cdn.example.com/search-album.jpg',
              },
            },
            ...(paidTrackId
              ? [
                  {
                    id: paidTrackId,
                    name: 'Paid Search Song',
                    fee: 1,
                    duration: 201000,
                    artists: [{ id: 8, name: 'Premium Artist' }],
                    album: {
                      id: 88,
                      name: 'Premium Album',
                      picUrl: 'http://cdn.example.com/premium-album.jpg',
                    },
                  },
                ]
              : []),
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
              fee: 0,
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

    if (pathname === '/api/playlist/detail' && options.failToplistDetail) {
      return createJsonResponse({
        code: -447,
        msg: '服务器忙碌，请稍后再试！',
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
              fee: 0,
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
              fee: 0,
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

    if (pathname === '/api/song/detail' && ids === `[${paidTrackId}]`) {
      return createJsonResponse({
        code: 200,
        songs: [
          {
            id: paidTrackId,
            name: 'Paid Track Detail',
            fee: 1,
            duration: 201000,
            artists: [{ id: 8, name: 'Premium Artist' }],
            album: {
              id: 88,
              name: 'Premium Album',
              picUrl: 'http://cdn.example.com/premium-album.jpg',
            },
          },
        ],
      });
    }

    if (pathname === '/api/song/detail') {
      return createJsonResponse({
        code: 200,
        songs: [
          {
            id: 9001,
            name: 'Track Detail',
            fee: 0,
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
    delete process.env.AUDIOUS_API_BASE_URL;
    delete process.env.JAMENDO_API_BASE_URL;
    delete process.env.JAMENDO_CLIENT_ID;
    global.fetch = createMusicFetchMock();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    delete process.env.AUDIOUS_API_BASE_URL;
    delete process.env.JAMENDO_API_BASE_URL;
    delete process.env.JAMENDO_CLIENT_ID;
  });

  it('returns audius as enabled and keeps jamendo behind client id', async () => {
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
        key: 'audius',
        enabled: true,
      })
    );
    expect(payload.sources[2]).toEqual(
      expect.objectContaining({
        key: 'jamendo',
        enabled: false,
      })
    );
  });

  it('enables jamendo after client id is configured', async () => {
    process.env.JAMENDO_CLIENT_ID = 'jamendo-test-client';

    const response = await getMusicSources();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sources[2]).toEqual(
      expect.objectContaining({
        key: 'jamendo',
        enabled: true,
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
    expect(trackPayload.track.playable).toBe(true);
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

  it('keeps the music home payload available when spotlight detail fetch fails', async () => {
    global.fetch = createMusicFetchMock({
      failToplistDetail: true,
    });

    const response = await getMusicHome(
      new NextRequest('http://localhost/api/music/home?source=netease')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.spotlight).toEqual([]);
    expect(payload.sections[0].collections[0].title).toBe('Top Rank');
    expect(payload.sections[2].collections[0].title).toBe('Focus Playlist');
  });

  it('marks paid search tracks as unavailable for playback', async () => {
    global.fetch = createMusicFetchMock({
      paidTrackId: 9901,
    });

    const response = await getMusicSearch(
      new NextRequest('http://localhost/api/music/search?source=netease&q=test')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.tracks[1]).toEqual(
      expect.objectContaining({
        id: '9901',
        playable: false,
        title: 'Paid Search Song',
      })
    );
  });

  it('rejects playback for tracks blocked by copyright or membership', async () => {
    global.fetch = createMusicFetchMock({
      paidTrackId: 9901,
    });

    const response = await getMusicTrack(
      new NextRequest('http://localhost/api/music/track?source=netease&id=9901')
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: '当前曲目受版权或会员限制，暂不可播放',
    });
  });

  it('hydrates audius music routes from audius upstream payloads', async () => {
    const homeResponse = await getMusicHome(
      new NextRequest('http://localhost/api/music/home?source=audius')
    );
    const searchResponse = await getMusicSearch(
      new NextRequest('http://localhost/api/music/search?source=audius&q=test')
    );
    const collectionResponse = await getMusicCollection(
      new NextRequest(
        'http://localhost/api/music/collection?source=audius&id=audius-playlist-1'
      )
    );
    const trackResponse = await getMusicTrack(
      new NextRequest(
        'http://localhost/api/music/track?source=audius&id=audius-track-1'
      )
    );
    const lyricResponse = await getMusicLyric(
      new NextRequest(
        'http://localhost/api/music/lyric?source=audius&id=audius-track-1'
      )
    );

    const homePayload = await homeResponse.json();
    const searchPayload = await searchResponse.json();
    const collectionPayload = await collectionResponse.json();
    const trackPayload = await trackResponse.json();
    const lyricPayload = await lyricResponse.json();

    expect(homeResponse.status).toBe(200);
    expect(homePayload.spotlight[0].title).toBe('Audius Spotlight');
    expect(homePayload.sections[0].tab).toBe('hot');
    expect(searchPayload.tracks[0].title).toBe('Audius Search Track');
    expect(searchPayload.collections[0].id).toBe('audius-playlist-2');
    expect(collectionPayload.title).toBe('Audius Trending Playlist');
    expect(collectionPayload.tracks[0].title).toBe('Playlist Audius Track');
    expect(trackPayload.track.title).toBe('Audius Track Detail');
    expect(trackPayload.streamUrl).toBe(
      'https://stream.audius.test/audius-track-1.mp3'
    );
    expect(lyricPayload.lines).toEqual([]);
  });

  it('hydrates jamendo music routes when client id is configured', async () => {
    process.env.JAMENDO_CLIENT_ID = 'jamendo-test-client';

    const homeResponse = await getMusicHome(
      new NextRequest('http://localhost/api/music/home?source=jamendo')
    );
    const searchResponse = await getMusicSearch(
      new NextRequest('http://localhost/api/music/search?source=jamendo&q=test')
    );
    const collectionResponse = await getMusicCollection(
      new NextRequest(
        'http://localhost/api/music/collection?source=jamendo&id=jamendo-playlist-1'
      )
    );
    const trackResponse = await getMusicTrack(
      new NextRequest(
        'http://localhost/api/music/track?source=jamendo&id=jamendo-track-1'
      )
    );
    const lyricResponse = await getMusicLyric(
      new NextRequest(
        'http://localhost/api/music/lyric?source=jamendo&id=jamendo-track-1'
      )
    );

    const homePayload = await homeResponse.json();
    const searchPayload = await searchResponse.json();
    const collectionPayload = await collectionResponse.json();
    const trackPayload = await trackResponse.json();
    const lyricPayload = await lyricResponse.json();

    expect(homeResponse.status).toBe(200);
    expect(homePayload.spotlight[0].title).toBe('Jamendo Search Track');
    expect(homePayload.sections[0].tab).toBe('hot');
    expect(searchPayload.tracks[0].title).toBe('Jamendo Search Track');
    expect(searchPayload.collections[0].id).toBe('jamendo-playlist-1');
    expect(collectionPayload.title).toBe('Jamendo Featured Playlist');
    expect(collectionPayload.tracks[0].title).toBe('Jamendo Playlist Track');
    expect(trackPayload.track.title).toBe('Jamendo Track Detail');
    expect(trackPayload.streamUrl).toBe(
      'https://stream.jamendo.test/jamendo-track-1.mp3'
    );
    expect(lyricPayload.lines).toEqual([]);
  });
});
