import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { MusicSidebar } from '../components/MusicSidebar';
import type { MusicTrackEntity } from '../domain/entities';
import type { SavedMusicCollectionRecord } from '../services/music-collection-profile';
import type {
  MusicFavoriteRecord,
  MusicPlayRecord,
  MusicRecentTrackRecord,
} from '../services/music-profile-records';
import { useMusicAccountStore } from '../state/music-account-store';
import { useMusicDataStore } from '../state/music-data-store';
import { useMusicLibraryStore } from '../state/music-library-store';
import { useMusicShellStore } from '../state/music-shell-store';

const mockLoadDesktopProfileBootstrapState = jest.fn();

jest.mock('@/lib/desktop/profile-bootstrap', () => ({
  loadDesktopProfileBootstrapState: (...args: unknown[]) =>
    mockLoadDesktopProfileBootstrapState(...args),
}));

const TRACK: MusicTrackEntity = {
  id: 'netease-track-1',
  source: 'netease',
  title: 'Playable Track',
  artists: ['Luna Drive'],
  album: 'Midnight Circuits',
  coverUrl: 'https://cdn.music.test/cover.jpg',
  durationMs: 215000,
  stream: '',
  playable: true,
};

function buildFavoriteRecord(): MusicFavoriteRecord {
  return {
    track: TRACK,
    savedAt: 1111,
  };
}

function buildRecentTrackRecord(): MusicRecentTrackRecord {
  return {
    track: TRACK,
    playedAt: 2222,
  };
}

function buildPlayRecord(): MusicPlayRecord {
  return {
    track: TRACK,
    playedAt: 3333,
    playTimeMs: 64000,
    durationMs: 215000,
    completed: false,
  };
}

function buildSavedCollectionRecord(index = 0): SavedMusicCollectionRecord {
  return {
    summary: {
      id: `${19723756 + index}`,
      source: 'netease',
      kind: 'rank',
      title: index === 0 ? '官方榜单详情' : `收藏歌单 ${index + 1}`,
      coverUrl: 'https://cdn.music.test/toplist.jpg',
      description:
        index === 0 ? 'Toplist Detail' : `Saved Playlist ${index + 1}`,
      trackCount: 10 + index,
      accentColor: '#ff5f6d',
    },
    savedAt: 4444 + index,
  };
}

function setDesktopAuthCookie(
  username: string,
  sessionMode: 'desktop-local' | 'desktop-profile-sync'
) {
  document.cookie = `auth=${encodeURIComponent(
    JSON.stringify({
      username,
      sessionMode,
    })
  )}; path=/`;
}

function resetMusicSidebarStores() {
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
  useMusicShellStore.setState({
    activeSection: 'home',
    sidebarCollapsed: false,
    mobileDrawerOpen: false,
    layoutMode: 'desktop',
    themeVariant: 'midnight',
  });
  useMusicDataStore.setState({
    source: 'netease',
    homeView: null,
    searchResult: null,
    selectedCollection: null,
    loading: false,
    error: null,
  });
  useMusicLibraryStore.setState({
    hydrated: true,
    loading: false,
    error: null,
    savedCollections: [buildSavedCollectionRecord()],
    favoriteTracks: [buildFavoriteRecord()],
    recentTracks: [buildRecentTrackRecord()],
    resumeTracks: [buildPlayRecord()],
    savedCollectionKeys: ['netease+19723756'],
    favoriteTrackKeys: ['netease+netease-track-1'],
  });
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

function installMusicCollectionsProfileFetchMock(options?: {
  musicAccountResponse?: unknown;
  musicQrSessionResponse?: unknown;
  qrStatusSequence?: Array<'waiting' | 'scanned' | 'expired' | 'confirmed'>;
}): jest.Mock {
  let qrStatusIndex = 0;
  let musicPreferences = {
    themeVariant: 'midnight',
    sidebarCollapsed: false,
    preferredPlaybackQuality: 'standard',
    lyricsFollowMode: 'auto',
    playMode: 'list-loop',
    volume: 0.9,
    muted: false,
  };
  const fetchMock = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = String(input);
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
            preferences?: Partial<typeof musicPreferences>;
          })
        : null;

      if (requestUrl.includes('/api/music/account/qr')) {
        if (!requestUrl.includes('&key=')) {
          return createJsonResponse(
            options?.musicQrSessionResponse || {
              key: 'mock-unikey',
              status: 'waiting',
              qrUrl: 'https://music.163.com/login?codekey=mock-unikey',
              qrImageDataUrl: 'data:image/png;base64,mock-image',
            }
          );
        }

        const currentStatus =
          options?.qrStatusSequence?.[
            Math.min(qrStatusIndex, (options.qrStatusSequence?.length || 1) - 1)
          ] || 'waiting';
        qrStatusIndex += 1;

        if (currentStatus === 'confirmed') {
          return createJsonResponse({
            key: 'mock-unikey',
            status: 'confirmed',
            account: {
              source: 'netease',
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
                  source: 'netease',
                  kind: 'playlist',
                  title: 'Created Playlist',
                  coverUrl: 'https://cdn.music.test/created-playlist.jpg',
                  description: 'Created by Luna Session',
                  trackCount: 18,
                  accentColor: '#7b61ff',
                },
              ],
            },
            message: '登录成功，正在同步',
          });
        }

        if (currentStatus === 'scanned') {
          return createJsonResponse({
            key: 'mock-unikey',
            status: 'scanned',
            message: '已扫码，请在手机确认',
          });
        }

        if (currentStatus === 'expired') {
          return createJsonResponse({
            key: 'mock-unikey',
            status: 'expired',
            message: '二维码已失效，请重新生成',
          });
        }

        return createJsonResponse({
          key: 'mock-unikey',
          status: 'waiting',
          message: '等待扫码',
        });
      }

      if (requestUrl.includes('/api/music/account')) {
        return createJsonResponse(
          options?.musicAccountResponse || {
            source: 'netease',
            authenticated: false,
            profile: null,
            playlists: [],
          }
        );
      }

      if (requestUrl.includes('/api/music/home')) {
        return createJsonResponse({
          source: 'netease',
          spotlight: [],
          sections: [],
          featuredQueue: [],
        });
      }

      if (requestUrl.includes('/music/profile/collections')) {
        return createJsonResponse([]);
      }

      if (requestUrl.includes('/music/profile/recent-tracks')) {
        return createJsonResponse([]);
      }

      if (requestUrl.includes('/music/profile/preferences')) {
        if (requestMethod === 'POST') {
          musicPreferences = {
            ...musicPreferences,
            ...(requestBody?.preferences || {}),
          };

          return createJsonResponse({ success: true });
        }

        return createJsonResponse(musicPreferences);
      }

      if (
        requestUrl.includes('/music/profile/favorites') ||
        requestUrl.includes('/music/profile/play-records')
      ) {
        return createJsonResponse({});
      }

      return createJsonResponse({}, 404);
    }
  );

  global.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

describe('MusicSidebar account card', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    localStorage.clear();
    installMusicCollectionsProfileFetchMock();
    document.cookie = 'auth=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
      STORAGE_TYPE: 'localstorage',
      PROFILE_MODE: 'single-user-local',
      PROFILE_SYNC_ENABLED: false,
    };
    resetMusicSidebarStores();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the desktop local account card with user-scoped library stats', async () => {
    setDesktopAuthCookie('desktop-owner', 'desktop-local');
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload: {
        appTarget: 'desktop',
        runtime: {
          profileSyncEnabled: false,
        },
        profileSync: {
          enabled: false,
          reachable: false,
          authenticated: false,
          username: null,
          role: null,
          storageType: null,
          profileMode: null,
          error: null,
          errorKind: null,
          syncDomains: ['playrecords', 'favorites'],
        },
        localAuth: {
          username: 'desktop-owner',
          passwordRequired: false,
          multiUser: false,
          ownerPasswordConfigured: true,
        },
      },
      localAuth: {
        username: 'desktop-owner',
        passwordRequired: false,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    });

    installMusicCollectionsProfileFetchMock();
    render(<MusicSidebar />);

    expect(await screen.findByText('desktop-owner')).toBeInTheDocument();
    expect(screen.getByText('Stored on this Mac')).toBeInTheDocument();
    expect(
      screen.getByText('Desktop local / localstorage')
    ).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('Resume')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(3);
  });

  it('shows the profile sync account card when remote sync is active', async () => {
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
      STORAGE_TYPE: 'localstorage',
      PROFILE_MODE: 'single-user-local',
      PROFILE_SYNC_ENABLED: true,
      PROFILE_SYNC_STORAGE_TYPE: 'redis',
      PROFILE_SYNC_PROFILE_MODE: 'shared-multi-user',
    };
    setDesktopAuthCookie('cloud-owner', 'desktop-profile-sync');
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload: {
        appTarget: 'desktop',
        runtime: {
          profileSyncEnabled: true,
        },
        profileSync: {
          enabled: true,
          reachable: true,
          authenticated: true,
          username: 'cloud-owner',
          role: 'owner',
          storageType: 'redis',
          profileMode: 'shared-multi-user',
          error: null,
          errorKind: null,
          syncDomains: ['playrecords', 'favorites', 'searchhistory'],
        },
        localAuth: {
          username: 'desktop-owner',
          passwordRequired: false,
          multiUser: true,
          ownerPasswordConfigured: true,
        },
      },
      localAuth: {
        username: 'desktop-owner',
        passwordRequired: false,
        multiUser: true,
        ownerPasswordConfigured: true,
      },
    });

    render(<MusicSidebar />);

    expect(await screen.findByText('cloud-owner')).toBeInTheDocument();
    expect(await screen.findByText('Sync ready')).toBeInTheDocument();
    expect(
      screen.getByText('Remote shared profile / redis')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Only library data syncs remotely. Discovery and playback stay local.'
      )
    ).toBeInTheDocument();
  });

  it('shows netease playlists in the sidebar when a music account is connected', async () => {
    setDesktopAuthCookie('desktop-owner', 'desktop-local');
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload: {
        appTarget: 'desktop',
        runtime: {
          profileSyncEnabled: false,
        },
        profileSync: {
          enabled: false,
          reachable: false,
          authenticated: false,
          username: null,
          role: null,
          storageType: null,
          profileMode: null,
          error: null,
          errorKind: null,
          syncDomains: ['playrecords', 'favorites', 'searchhistory'],
        },
        localAuth: {
          username: 'desktop-owner',
          passwordRequired: false,
          multiUser: false,
          ownerPasswordConfigured: true,
        },
      },
      localAuth: {
        username: 'desktop-owner',
        passwordRequired: false,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    });

    installMusicCollectionsProfileFetchMock({
      musicAccountResponse: {
        source: 'netease',
        authenticated: true,
        profile: {
          userId: '42',
          nickname: 'Luna User',
          avatarUrl: 'https://cdn.music.test/luna-user.jpg',
          signature: 'Night shift listener',
        },
        playlists: [
          {
            id: '501',
            source: 'netease',
            kind: 'playlist',
            title: 'Created Playlist',
            coverUrl: 'https://cdn.music.test/created-playlist.jpg',
            description: 'Created by Luna User',
            trackCount: 18,
            accentColor: '#7b61ff',
          },
        ],
      },
    });

    render(<MusicSidebar />);

    expect(await screen.findByText('Luna User')).toBeInTheDocument();
    expect(await screen.findByText('My playlists')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Open personal playlist Created Playlist',
      })
    ).toBeInTheDocument();
  });

  it('shows qr login by default and lets the user switch to cookie fallback', async () => {
    setDesktopAuthCookie('desktop-owner', 'desktop-local');
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload: {
        appTarget: 'desktop',
        runtime: {
          profileSyncEnabled: false,
        },
        profileSync: {
          enabled: false,
          reachable: false,
          authenticated: false,
          username: null,
          role: null,
          storageType: null,
          profileMode: null,
          error: null,
          errorKind: null,
          syncDomains: ['playrecords', 'favorites', 'searchhistory'],
        },
        localAuth: {
          username: 'desktop-owner',
          passwordRequired: false,
          multiUser: false,
          ownerPasswordConfigured: true,
        },
      },
      localAuth: {
        username: 'desktop-owner',
        passwordRequired: false,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    });

    installMusicCollectionsProfileFetchMock({
      musicQrSessionResponse: {
        key: 'mock-unikey',
        status: 'waiting',
        qrUrl: 'https://music.163.com/login?codekey=mock-unikey',
        qrImageDataUrl: 'data:image/png;base64,mock-image',
      },
    });

    render(<MusicSidebar />);

    expect(await screen.findByAltText('Netease QR login')).toBeInTheDocument();
    expect(screen.getByText('等待扫码')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use cookie instead' }));

    expect(screen.getByLabelText('Netease session cookie')).toBeInTheDocument();
  });

  it('renders the connected account card after qr login is confirmed', async () => {
    jest.useFakeTimers();
    setDesktopAuthCookie('desktop-owner', 'desktop-local');
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload: {
        appTarget: 'desktop',
        runtime: {
          profileSyncEnabled: false,
        },
        profileSync: {
          enabled: false,
          reachable: false,
          authenticated: false,
          username: null,
          role: null,
          storageType: null,
          profileMode: null,
          error: null,
          errorKind: null,
          syncDomains: ['playrecords', 'favorites', 'searchhistory'],
        },
        localAuth: {
          username: 'desktop-owner',
          passwordRequired: false,
          multiUser: false,
          ownerPasswordConfigured: true,
        },
      },
      localAuth: {
        username: 'desktop-owner',
        passwordRequired: false,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    });

    installMusicCollectionsProfileFetchMock({
      qrStatusSequence: ['confirmed'],
    });

    render(<MusicSidebar />);
    expect(await screen.findByAltText('Netease QR login')).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText('Luna Session')).toBeInTheDocument();
    expect(screen.getByText('Session connected')).toBeInTheDocument();
  });

  it('shows saved collections in the expanded sidebar', async () => {
    setDesktopAuthCookie('desktop-owner', 'desktop-local');
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload: {
        appTarget: 'desktop',
        runtime: {
          profileSyncEnabled: false,
        },
        profileSync: {
          enabled: false,
          reachable: false,
          authenticated: false,
          username: null,
          role: null,
          storageType: null,
          profileMode: null,
          error: null,
          errorKind: null,
          syncDomains: ['playrecords', 'favorites', 'searchhistory'],
        },
        localAuth: {
          username: 'desktop-owner',
          passwordRequired: false,
          multiUser: false,
          ownerPasswordConfigured: true,
        },
      },
      localAuth: {
        username: 'desktop-owner',
        passwordRequired: false,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    });

    render(<MusicSidebar />);

    expect(await screen.findByText('Saved collections')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Open saved collection 官方榜单详情',
      })
    ).toBeInTheDocument();
  });

  it('removes a saved collection directly from the sidebar rail', async () => {
    setDesktopAuthCookie('desktop-owner', 'desktop-local');
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload: {
        appTarget: 'desktop',
        runtime: {
          profileSyncEnabled: false,
        },
        profileSync: {
          enabled: false,
          reachable: false,
          authenticated: false,
          username: null,
          role: null,
          storageType: null,
          profileMode: null,
          error: null,
          errorKind: null,
          syncDomains: ['playrecords', 'favorites', 'searchhistory'],
        },
        localAuth: {
          username: 'desktop-owner',
          passwordRequired: false,
          multiUser: false,
          ownerPasswordConfigured: true,
        },
      },
      localAuth: {
        username: 'desktop-owner',
        passwordRequired: false,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    });

    render(<MusicSidebar />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Remove saved collection 官方榜单详情',
      })
    );

    await waitFor(() => {
      expect(
        screen.queryByRole('button', {
          name: 'Open saved collection 官方榜单详情',
        })
      ).not.toBeInTheDocument();
    });
    expect(useMusicLibraryStore.getState().savedCollections).toHaveLength(0);
  });

  it('shows overflow access and compact saved collection affordance', async () => {
    setDesktopAuthCookie('desktop-owner', 'desktop-local');
    mockLoadDesktopProfileBootstrapState.mockResolvedValue({
      payload: {
        appTarget: 'desktop',
        runtime: {
          profileSyncEnabled: false,
        },
        profileSync: {
          enabled: false,
          reachable: false,
          authenticated: false,
          username: null,
          role: null,
          storageType: null,
          profileMode: null,
          error: null,
          errorKind: null,
          syncDomains: ['playrecords', 'favorites', 'searchhistory'],
        },
        localAuth: {
          username: 'desktop-owner',
          passwordRequired: false,
          multiUser: false,
          ownerPasswordConfigured: true,
        },
      },
      localAuth: {
        username: 'desktop-owner',
        passwordRequired: false,
        multiUser: false,
        ownerPasswordConfigured: true,
      },
    });

    const savedCollections = Array.from({ length: 8 }, (_value, index) =>
      buildSavedCollectionRecord(index)
    );
    useMusicLibraryStore.setState({
      savedCollections,
      savedCollectionKeys: savedCollections.map(
        (record) => `${record.summary.source}+${record.summary.id}`
      ),
    });

    render(<MusicSidebar />);

    expect(await screen.findByText('Saved collections')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Open saved collection 官方榜单详情',
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Open saved collection 收藏歌单 7',
      })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open library for 2 more saved collections',
      })
    );
    expect(useMusicShellStore.getState().activeSection).toBe('library');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Collapse music sidebar',
      })
    );

    expect(await screen.findByText('8 saved')).toBeInTheDocument();
  });
});
