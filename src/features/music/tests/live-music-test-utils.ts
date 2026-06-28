import { fireEvent, screen } from '@testing-library/react';

import { useLyricsStore } from '../state/lyrics-store';
import { useMusicAccountStore } from '../state/music-account-store';
import { useMusicDataStore } from '../state/music-data-store';
import { useMusicLibraryStore } from '../state/music-library-store';
import { useMusicShellStore } from '../state/music-shell-store';
import { usePlaybackStore } from '../state/playback-store';
import { usePlayerSurfaceStore } from '../state/player-surface-store';

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

export function resetLiveMusicStores(): void {
  localStorage.clear();
  if (typeof window !== 'undefined') {
    window.history.replaceState({}, '', '/music');
  }
  useMusicDataStore.setState({
    source: 'netease',
    homeView: null,
    searchResult: null,
    selectedCollection: null,
    preferredPlaybackQuality: 'standard',
    loading: false,
    error: null,
  });
  useMusicAccountStore.setState({
    source: 'netease',
    account: null,
    loading: false,
    submitting: false,
    error: null,
    qrState: {
      status: 'idle',
      key: null,
      qrUrl: null,
      qrImageDataUrl: null,
      message: null,
    },
  });
  useMusicLibraryStore.setState({
    hydrated: false,
    loading: false,
    error: null,
    savedCollections: [],
    favoriteTracks: [],
    recentTracks: [],
    resumeTracks: [],
    savedCollectionKeys: [],
    favoriteTrackKeys: [],
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
  usePlayerSurfaceStore.setState({
    miniVisible: false,
    fullPlayerOpen: false,
    lyricsPanelOpen: true,
    queuePanelOpen: false,
    transitionState: 'idle',
  });
  useMusicShellStore.setState({
    activeSection: 'home',
    sidebarCollapsed: false,
    mobileDrawerOpen: false,
    layoutMode: 'desktop',
    themeVariant: 'midnight',
  });
  useLyricsStore.setState({
    lyrics: null,
    activeLineIndex: -1,
    followMode: 'auto',
    manualSeekLock: false,
  });
}

export function createLiveMusicFetchMock(): typeof fetch {
  const musicSearchHistory: string[] = [];
  let musicAccountConnected = false;
  const savedMusicCollections: Array<{
    summary: {
      id: string;
      source: 'netease';
      kind: 'playlist' | 'rank' | 'album' | 'artist-toplist';
      title: string;
      coverUrl: string;
      description: string;
      trackCount: number;
      accentColor: string;
    };
    savedAt: number;
  }> = [];
  let fmRefreshCount = 0;

  const buildConnectedMusicAccount = () => ({
    source: 'netease' as const,
    authenticated: true,
    profile: {
      userId: '42',
      nickname: 'Luna Session',
      avatarUrl: 'https://cdn.music.test/luna-session.jpg',
      signature: 'Connected for daily picks',
    },
    playlists: [
      {
        id: '501',
        source: 'netease' as const,
        kind: 'playlist' as const,
        title: 'Created Playlist',
        coverUrl: 'https://cdn.music.test/created-playlist.jpg',
        description: 'Created by Luna Session',
        trackCount: 18,
        accentColor: '#7b61ff',
      },
    ],
  });

  return jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    let requestBody: Record<string, unknown> | null = null;

    if (rawRequestBody) {
      try {
        requestBody = JSON.parse(rawRequestBody) as Record<string, unknown>;
      } catch {
        requestBody = null;
      }
    }

    if (requestUrl.pathname === '/api/music/home') {
      const sessionSections = musicAccountConnected
        ? [
            {
              id: 'netease-daily',
              title: '每日推荐',
              tab: 'daily',
              kind: 'track-list',
              description: '已连接网易云会话后同步的每日推荐曲目。',
              tracks: [
                {
                  id: '9401',
                  source: 'netease',
                  title: 'Daily Session Track',
                  artists: ['Daily Artist'],
                  album: 'Daily Album',
                  coverUrl: 'https://cdn.music.test/daily-track.jpg',
                  durationMs: 205000,
                  stream: '',
                  playable: true,
                },
              ],
            },
            {
              id: 'netease-fm',
              title: '私人 FM',
              tab: 'fm',
              kind: 'track-list',
              description: '已连接网易云会话后同步的连续 FM 曲目。',
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
          ]
        : [];

      return createJsonResponse({
        source: 'netease',
        spotlight: [
          {
            id: '9001',
            source: 'netease',
            title: 'Playable Track',
            artists: ['Artist A'],
            album: 'Album A',
            coverUrl: 'https://cdn.music.test/album-a.jpg',
            durationMs: 215000,
            stream: '',
            playable: true,
          },
        ],
        sections: [
          {
            id: 'netease-rank',
            title: '官方榜单',
            tab: 'rank',
            kind: 'collection-list',
            description: '直接取自网易云公开榜单接口。',
            collections: [
              {
                id: '19723756',
                source: 'netease',
                kind: 'rank',
                title: '官方榜单',
                coverUrl: 'https://cdn.music.test/toplist.jpg',
                description: 'Toplist',
                trackCount: 10,
                accentColor: '#ff5f6d',
              },
            ],
          },
          {
            id: 'netease-playlist',
            title: '推荐歌单',
            tab: 'playlist',
            kind: 'collection-list',
            description: '来自网易云公开推荐歌单接口。',
            collections: [
              {
                id: '301',
                source: 'netease',
                kind: 'playlist',
                title: '推荐歌单',
                coverUrl: 'https://cdn.music.test/playlist.jpg',
                description: '精选推荐',
                trackCount: 12,
                accentColor: '#7b61ff',
              },
            ],
          },
          ...sessionSections,
          {
            id: 'netease-album',
            title: '精选专辑',
            tab: 'album',
            kind: 'collection-list',
            description: '来自网易云新碟上架接口。',
            collections: [
              {
                id: '3190201',
                source: 'netease',
                kind: 'album',
                title: '最新专辑',
                coverUrl: 'https://cdn.music.test/new-album.jpg',
                description: '最新上架专辑',
                trackCount: 1,
                accentColor: '#0ea5e9',
              },
            ],
          },
          {
            id: 'netease-hot',
            title: '热门流派',
            tab: 'hot',
            kind: 'track-list',
            description: '适合直接点播的热播曲目。',
            tracks: [
              {
                id: '9201',
                source: 'netease',
                title: 'Discovery Cut One',
                artists: ['Neon A'],
                album: 'Afterglow',
                coverUrl: 'https://cdn.music.test/discovery-one.jpg',
                durationMs: 187000,
                stream: '',
                playable: true,
              },
              {
                id: '9202',
                source: 'netease',
                title: 'Discovery Cut Two',
                artists: ['Neon B'],
                album: 'Night Shift',
                coverUrl: 'https://cdn.music.test/discovery-two.jpg',
                durationMs: 194000,
                stream: '',
                playable: true,
              },
            ],
          },
        ],
        featuredQueue: [
          {
            queueId: 'netease-featured-9001',
            addedAt: 1,
            fromContext: 'featured',
            track: {
              id: '9001',
              source: 'netease',
              title: 'Playable Track',
              artists: ['Artist A'],
              album: 'Album A',
              coverUrl: 'https://cdn.music.test/album-a.jpg',
              durationMs: 215000,
              stream: '',
              playable: true,
            },
          },
          {
            queueId: 'netease-featured-9002',
            addedAt: 2,
            fromContext: 'featured',
            track: {
              id: '9002',
              source: 'netease',
              title: 'Second Collection Track',
              artists: ['Artist B'],
              album: 'Album B',
              coverUrl: 'https://cdn.music.test/album-b.jpg',
              durationMs: 223000,
              stream: '',
              playable: true,
            },
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

      fmRefreshCount += 1;

      return createJsonResponse([
        {
          id: fmRefreshCount > 1 ? '9603' : '9601',
          source: 'netease',
          title:
            fmRefreshCount > 1
              ? 'FM Refresh Track Three'
              : 'FM Refresh Track One',
          artists: ['FM Refresh Artist'],
          album: 'FM Refresh Album',
          coverUrl:
            fmRefreshCount > 1
              ? 'https://cdn.music.test/fm-refresh-3.jpg'
              : 'https://cdn.music.test/fm-refresh-1.jpg',
          durationMs: fmRefreshCount > 1 ? 207000 : 204000,
          stream: '',
          playable: true,
        },
        {
          id: fmRefreshCount > 1 ? '9604' : '9602',
          source: 'netease',
          title:
            fmRefreshCount > 1
              ? 'FM Refresh Track Four'
              : 'FM Refresh Track Two',
          artists: ['FM Refresh Artist'],
          album: 'FM Refresh Album',
          coverUrl:
            fmRefreshCount > 1
              ? 'https://cdn.music.test/fm-refresh-4.jpg'
              : 'https://cdn.music.test/fm-refresh-2.jpg',
          durationMs: fmRefreshCount > 1 ? 208000 : 206000,
          stream: '',
          playable: true,
        },
      ]);
    }

    if (requestUrl.pathname === '/api/music/search') {
      const query = requestUrl.searchParams.get('q') || '';
      const isArtistQuery = query === 'jay';

      return createJsonResponse({
        source: 'netease',
        query,
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
          {
            id: '9102',
            source: 'netease',
            title: 'Search Track Two',
            artists: ['Search Artist B'],
            album: 'Search Album B',
            coverUrl: 'https://cdn.music.test/search-track-b.jpg',
            durationMs: 211000,
            stream: '',
            playable: true,
          },
        ],
        collections: [
          {
            id: '302',
            source: 'netease',
            kind: 'playlist',
            title: 'Search Playlist',
            coverUrl: 'https://cdn.music.test/search-playlist.jpg',
            description: 'Search playlist description',
            trackCount: 24,
            accentColor: '#7b61ff',
          },
          {
            id: '3190201',
            source: 'netease',
            kind: 'album',
            title: 'Search Album Result',
            coverUrl: 'https://cdn.music.test/search-album.jpg',
            description: 'OMFG',
            trackCount: 1,
            accentColor: '#0ea5e9',
          },
          ...(isArtistQuery
            ? [
                {
                  id: '6452',
                  source: 'netease',
                  kind: 'artist-toplist',
                  title: '周杰伦',
                  coverUrl: 'https://cdn.music.test/jay.jpg',
                  description: '41 albums · 568 tracks',
                  trackCount: 568,
                  accentColor: '#f97316',
                },
              ]
            : []),
        ],
      });
    }

    if (requestUrl.pathname === '/api/music/account') {
      if (requestMethod === 'POST') {
        musicAccountConnected = true;

        return createJsonResponse(buildConnectedMusicAccount());
      }

      if (requestMethod === 'DELETE') {
        musicAccountConnected = false;
      }

      return createJsonResponse({
        source: 'netease',
        authenticated: musicAccountConnected,
        profile: musicAccountConnected
          ? {
              userId: '42',
              nickname: 'Luna Session',
              avatarUrl: 'https://cdn.music.test/luna-session.jpg',
              signature: 'Connected for daily picks',
            }
          : null,
        playlists: musicAccountConnected
          ? [
              {
                id: '501',
                source: 'netease',
                kind: 'playlist',
                title: 'Created Playlist',
                coverUrl: 'https://cdn.music.test/created-playlist.jpg',
                description: 'Created by Luna Session',
                trackCount: 18,
                accentColor: '#7b61ff',
              },
            ]
          : [],
      });
    }

    if (requestUrl.pathname === '/api/music/account/qr') {
      if (requestMethod === 'POST') {
        return createJsonResponse({
          key: '',
          status: 'waiting',
          qrUrl: 'https://music.163.com/login?codekey=mock-unikey',
          qrImageDataUrl: 'data:image/png;base64,mock-image',
        });
      }

      if (requestMethod === 'GET') {
        return createJsonResponse({
          key: requestUrl.searchParams.get('key') || '',
          status: 'waiting',
          message: '等待扫码',
        });
      }
    }

    if (requestUrl.pathname === '/api/music/profile/search-history') {
      if (requestMethod === 'POST') {
        const query =
          typeof requestBody?.query === 'string'
            ? requestBody.query.trim()
            : '';

        if (query) {
          musicSearchHistory.splice(
            0,
            musicSearchHistory.length,
            query,
            ...musicSearchHistory.filter((entry) => entry !== query)
          );
        }

        return createJsonResponse({ success: true });
      }

      if (requestMethod === 'DELETE') {
        const query = requestUrl.searchParams.get('query')?.trim() || '';

        if (query) {
          const nextHistory = musicSearchHistory.filter(
            (entry) => entry !== query
          );
          musicSearchHistory.splice(
            0,
            musicSearchHistory.length,
            ...nextHistory
          );
        } else {
          musicSearchHistory.length = 0;
        }

        return createJsonResponse({ success: true });
      }

      return createJsonResponse([...musicSearchHistory]);
    }

    if (requestUrl.pathname === '/api/music/profile/collections') {
      if (requestMethod === 'POST') {
        const key =
          typeof requestBody?.key === 'string' ? requestBody.key.trim() : '';
        const collection =
          requestBody?.collection && typeof requestBody.collection === 'object'
            ? (requestBody.collection as {
                summary: {
                  id: string;
                  source: 'netease';
                  kind: 'playlist' | 'rank' | 'album' | 'artist-toplist';
                  title: string;
                  coverUrl: string;
                  description: string;
                  trackCount: number;
                  accentColor: string;
                };
                savedAt: number;
              })
            : null;

        if (key && collection?.summary?.id) {
          const nextCollections = [
            collection,
            ...savedMusicCollections.filter(
              (record) =>
                `${record.summary.source}+${record.summary.id}` !== key
            ),
          ].sort((left, right) => right.savedAt - left.savedAt);

          savedMusicCollections.splice(
            0,
            savedMusicCollections.length,
            ...nextCollections
          );
        }

        return createJsonResponse({ success: true });
      }

      if (requestMethod === 'DELETE') {
        const key = requestUrl.searchParams.get('key')?.trim() || '';

        if (key) {
          const nextCollections = savedMusicCollections.filter(
            (record) => `${record.summary.source}+${record.summary.id}` !== key
          );
          savedMusicCollections.splice(
            0,
            savedMusicCollections.length,
            ...nextCollections
          );
        } else {
          savedMusicCollections.length = 0;
        }

        return createJsonResponse({ success: true });
      }

      return createJsonResponse([...savedMusicCollections]);
    }

    if (requestUrl.pathname === '/api/music/collection') {
      const collectionId = requestUrl.searchParams.get('id') || '';
      const collectionKind = requestUrl.searchParams.get('kind') || 'playlist';
      const isSearchPlaylist = collectionId === '302';
      const isAlbumCollection =
        collectionKind === 'album' && collectionId === '3190201';
      const isArtistToplist =
        collectionKind === 'artist-toplist' && collectionId === '6452';

      return createJsonResponse({
        summary: {
          id: collectionId,
          source: 'netease',
          kind: isArtistToplist
            ? 'artist-toplist'
            : isAlbumCollection
            ? 'album'
            : 'playlist',
          title: isArtistToplist
            ? '周杰伦'
            : isAlbumCollection
            ? '最新专辑详情'
            : isSearchPlaylist
            ? 'Search Playlist'
            : '官方榜单详情',
          coverUrl: isArtistToplist
            ? 'https://cdn.music.test/jay.jpg'
            : isAlbumCollection
            ? 'https://cdn.music.test/new-album.jpg'
            : isSearchPlaylist
            ? 'https://cdn.music.test/search-playlist.jpg'
            : 'https://cdn.music.test/toplist.jpg',
          description: isArtistToplist
            ? '41 albums · 568 tracks'
            : isAlbumCollection
            ? '最新上架专辑详情'
            : isSearchPlaylist
            ? 'Search playlist description'
            : 'Toplist Detail',
          trackCount: isArtistToplist
            ? 568
            : isAlbumCollection
            ? 1
            : isSearchPlaylist
            ? 24
            : 1,
          accentColor: isArtistToplist
            ? '#f97316'
            : isAlbumCollection
            ? '#0ea5e9'
            : isSearchPlaylist
            ? '#7b61ff'
            : '#ff5f6d',
        },
        curator: isArtistToplist
          ? '艺人热歌'
          : isAlbumCollection
          ? 'OMFG'
          : isSearchPlaylist
          ? '搜索结果歌单'
          : '网易云音乐',
        updatedAtLabel: isArtistToplist
          ? '热门歌曲'
          : isAlbumCollection
          ? '新碟上架'
          : isSearchPlaylist
          ? '搜索命中'
          : '每日更新',
        tracks: [
          {
            id: isArtistToplist
              ? '210049'
              : isAlbumCollection
              ? '33211676'
              : '9001',
            source: 'netease',
            title: isArtistToplist
              ? '布拉格广场'
              : isAlbumCollection
              ? 'Hello'
              : isSearchPlaylist
              ? 'Search Playlist Track'
              : 'Playable Track',
            artists: isArtistToplist
              ? ['蔡依林', '周杰伦']
              : isAlbumCollection
              ? ['OMFG']
              : isSearchPlaylist
              ? ['Search Artist']
              : ['Artist A'],
            album: isArtistToplist
              ? '看我72变'
              : isAlbumCollection
              ? '最新专辑详情'
              : isSearchPlaylist
              ? 'Search Album'
              : 'Album A',
            coverUrl: isArtistToplist
              ? 'https://cdn.music.test/bratislava.jpg'
              : isAlbumCollection
              ? 'https://cdn.music.test/new-album.jpg'
              : isSearchPlaylist
              ? 'https://cdn.music.test/search-track.jpg'
              : 'https://cdn.music.test/album-a.jpg',
            durationMs: isArtistToplist
              ? 290000
              : isAlbumCollection
              ? 226307
              : isSearchPlaylist
              ? 201000
              : 215000,
            stream: '',
            playable: true,
          },
          ...(isAlbumCollection
            ? []
            : [
                {
                  id: isArtistToplist ? '186016' : '9002',
                  source: 'netease',
                  title: isArtistToplist
                    ? '七里香'
                    : isSearchPlaylist
                    ? 'Search Playlist Track Two'
                    : 'Second Collection Track',
                  artists: isArtistToplist
                    ? ['周杰伦']
                    : isSearchPlaylist
                    ? ['Search Artist B']
                    : ['Artist B'],
                  album: isArtistToplist
                    ? '七里香'
                    : isSearchPlaylist
                    ? 'Search Album B'
                    : 'Album B',
                  coverUrl: isArtistToplist
                    ? 'https://cdn.music.test/qilixiang.jpg'
                    : isSearchPlaylist
                    ? 'https://cdn.music.test/search-track-b.jpg'
                    : 'https://cdn.music.test/album-b.jpg',
                  durationMs: isArtistToplist
                    ? 298000
                    : isSearchPlaylist
                    ? 211000
                    : 223000,
                  stream: '',
                  playable: true,
                },
              ]),
        ],
        relatedCollections: isArtistToplist
          ? [
              {
                id: '274336916',
                source: 'netease',
                kind: 'album',
                title: '即兴曲',
                coverUrl: 'https://cdn.music.test/jixingqu.jpg',
                description: '周杰伦',
                trackCount: 7,
                accentColor: '#0ea5e9',
              },
              {
                id: '274336917',
                source: 'netease',
                kind: 'album',
                title: '范特西',
                coverUrl: 'https://cdn.music.test/fantasy.jpg',
                description: '周杰伦',
                trackCount: 10,
                accentColor: '#22c55e',
              },
            ]
          : [],
      });
    }

    if (requestUrl.pathname === '/api/music/track') {
      const trackId = requestUrl.searchParams.get('id');
      const requestedQuality =
        requestUrl.searchParams.get('quality') === 'high' ? 'high' : 'standard';

      return createJsonResponse({
        track: {
          id: trackId,
          source: 'netease',
          title:
            trackId === '9101'
              ? 'Search Track'
              : trackId === '9102'
              ? 'Search Track Two'
              : trackId === '9401'
              ? 'Daily Session Track'
              : trackId === '9501'
              ? 'FM Session Track'
              : trackId === '9601'
              ? 'FM Refresh Track One'
              : trackId === '9602'
              ? 'FM Refresh Track Two'
              : trackId === '9603'
              ? 'FM Refresh Track Three'
              : trackId === '9604'
              ? 'FM Refresh Track Four'
              : trackId === '9701'
              ? 'FM Trash Replacement'
              : trackId === '9201'
              ? 'Discovery Cut One'
              : trackId === '9202'
              ? 'Discovery Cut Two'
              : trackId === '9002'
              ? 'Second Collection Track'
              : 'Playable Track',
          artists:
            trackId === '9101'
              ? ['Search Artist']
              : trackId === '9102'
              ? ['Search Artist B']
              : trackId === '9401'
              ? ['Daily Artist']
              : trackId === '9501'
              ? ['FM Artist']
              : trackId === '9601' ||
                trackId === '9602' ||
                trackId === '9603' ||
                trackId === '9604'
              ? ['FM Refresh Artist']
              : trackId === '9701'
              ? ['Trash Artist']
              : trackId === '9201'
              ? ['Neon A']
              : trackId === '9202'
              ? ['Neon B']
              : trackId === '9002'
              ? ['Artist B']
              : ['Artist A'],
          album:
            trackId === '9101'
              ? 'Search Album'
              : trackId === '9102'
              ? 'Search Album B'
              : trackId === '9401'
              ? 'Daily Album'
              : trackId === '9501'
              ? 'FM Album'
              : trackId === '9601' ||
                trackId === '9602' ||
                trackId === '9603' ||
                trackId === '9604'
              ? 'FM Refresh Album'
              : trackId === '9701'
              ? 'Trash Album'
              : trackId === '9201'
              ? 'Afterglow'
              : trackId === '9202'
              ? 'Night Shift'
              : trackId === '9002'
              ? 'Album B'
              : 'Album A',
          coverUrl:
            trackId === '9101'
              ? 'https://cdn.music.test/search-track.jpg'
              : trackId === '9102'
              ? 'https://cdn.music.test/search-track-b.jpg'
              : trackId === '9401'
              ? 'https://cdn.music.test/daily-track.jpg'
              : trackId === '9501'
              ? 'https://cdn.music.test/fm-track.jpg'
              : trackId === '9601'
              ? 'https://cdn.music.test/fm-refresh-1.jpg'
              : trackId === '9602'
              ? 'https://cdn.music.test/fm-refresh-2.jpg'
              : trackId === '9603'
              ? 'https://cdn.music.test/fm-refresh-3.jpg'
              : trackId === '9604'
              ? 'https://cdn.music.test/fm-refresh-4.jpg'
              : trackId === '9701'
              ? 'https://cdn.music.test/fm-trash.jpg'
              : trackId === '9201'
              ? 'https://cdn.music.test/discovery-one.jpg'
              : trackId === '9202'
              ? 'https://cdn.music.test/discovery-two.jpg'
              : trackId === '9002'
              ? 'https://cdn.music.test/album-b.jpg'
              : 'https://cdn.music.test/album-a.jpg',
          durationMs:
            trackId === '9002'
              ? 223000
              : trackId === '9201'
              ? 187000
              : trackId === '9202'
              ? 194000
              : trackId === '9501'
              ? 214000
              : trackId === '9601'
              ? 204000
              : trackId === '9602'
              ? 206000
              : trackId === '9603'
              ? 207000
              : trackId === '9604'
              ? 208000
              : trackId === '9701'
              ? 203000
              : trackId === '9401'
              ? 205000
              : trackId === '9102'
              ? 211000
              : trackId === '9101'
              ? 201000
              : 215000,
          stream: '',
          playable: true,
        },
        quality: requestedQuality,
        streamUrl: `/api/music/stream?source=netease&id=${trackId}&quality=${requestedQuality}`,
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
            text:
              trackId === '9002'
                ? '第二首第一句'
                : trackId === '9101'
                ? '搜索首句'
                : trackId === '9401'
                ? '每日推荐第一句'
                : trackId === '9501'
                ? 'FM 第一段'
                : trackId === '9601'
                ? 'FM 刷新一'
                : trackId === '9602'
                ? 'FM 刷新二'
                : trackId === '9603'
                ? 'FM 刷新三'
                : trackId === '9604'
                ? 'FM 刷新四'
                : trackId === '9701'
                ? 'FM Trash 一'
                : '第一句',
          },
          {
            timeMs: 2500,
            text:
              trackId === '9002'
                ? '第二首第二句'
                : trackId === '9101'
                ? '搜索第二句'
                : trackId === '9401'
                ? '每日推荐第二句'
                : trackId === '9501'
                ? 'FM 第二段'
                : trackId === '9601'
                ? 'FM 刷新续一'
                : trackId === '9602'
                ? 'FM 刷新续二'
                : trackId === '9603'
                ? 'FM 刷新续三'
                : trackId === '9604'
                ? 'FM 刷新续四'
                : trackId === '9701'
                ? 'FM Trash 二'
                : '第二句',
          },
        ],
      });
    }

    return createJsonResponse(
      {
        error: `Unhandled fetch: ${requestUrl.pathname}`,
      },
      {
        status: 500,
      }
    );
  }) as typeof fetch;
}

export async function connectNeteaseSessionFromCookieFallback(): Promise<void> {
  fireEvent.click(
    await screen.findByRole('button', { name: 'Use cookie instead' })
  );
  fireEvent.change(screen.getByLabelText('Netease session cookie'), {
    target: { value: 'MUSIC_U=mock-session' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await screen.findByText('Session connected');
}

export function mockMediaElementPlayback(): {
  playSpy: jest.SpyInstance;
  pauseSpy: jest.SpyInstance;
} {
  return {
    playSpy: jest
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined),
    pauseSpy: jest
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined),
  };
}
