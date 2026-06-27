'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type {
  MusicCollection,
  MusicHomePayload,
  MusicSource,
  MusicTrack,
} from '@/lib/music/types';

import { useMusicPlayerStore } from '@/stores/musicPlayerStore';

import MusicPageClient from './MusicPageClient';

const mockReplace = jest.fn();
let mockSearchParams = 'source=netease&tab=rank&id=netease-rank-city';
const mockFetchMusicCollection = jest.fn<Promise<MusicCollection>, []>();

const mockSources: MusicSource[] = [
  {
    key: 'netease',
    name: '网易云音乐',
    provider: 'netease',
    enabled: true,
    tabs: ['home', 'rank', 'hot', 'playlist', 'search'],
  },
  {
    key: 'audius',
    name: 'Audius',
    provider: 'audius',
    enabled: true,
    tabs: ['home', 'hot', 'playlist', 'search'],
  },
  {
    key: 'jamendo',
    name: 'Jamendo',
    provider: 'jamendo',
    enabled: true,
    tabs: ['home', 'hot', 'playlist', 'search'],
  },
];

const mockHomePayload: MusicHomePayload = {
  source: 'netease',
  spotlight: [],
  sections: [
    {
      id: 'netease-rank',
      title: '榜单雷达',
      tab: 'rank',
      kind: 'collection-list',
      collections: [
        {
          id: 'netease-rank-city',
          source: 'netease',
          kind: 'rank',
          title: '城市夜航榜',
        },
      ],
    },
    {
      id: 'netease-playlist',
      title: '策展歌单',
      tab: 'playlist',
      kind: 'collection-list',
      collections: [
        {
          id: 'netease-playlist-focus',
          source: 'netease',
          kind: 'playlist',
          title: '写代码时听什么',
        },
      ],
    },
  ],
};

const playableCollectionTracks: MusicTrack[] = [
  {
    id: 'playlist-track-1',
    source: 'netease',
    title: '夜航第一首',
    artists: [{ name: '歌手甲' }],
    playable: true,
    durationMs: 185000,
  },
  {
    id: 'playlist-track-2',
    source: 'netease',
    title: '夜航第二首',
    artists: [{ name: '歌手乙' }],
    playable: true,
    durationMs: 196000,
  },
];

let mockCollection: MusicCollection = {
  id: 'netease-rank-city',
  source: 'netease',
  kind: 'rank',
  title: '城市夜航榜',
  tracks: playableCollectionTracks,
};

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/music'),
  useRouter: jest.fn(() => ({
    replace: mockReplace,
  })),
  useSearchParams: jest.fn(() => new URLSearchParams(mockSearchParams)),
}));

jest.mock('@/lib/transport/music-client', () => ({
  fetchMusicSources: jest.fn(async () => mockSources),
  fetchMusicHome: jest.fn(async () => mockHomePayload),
  fetchMusicCollection: (...args: []) => mockFetchMusicCollection(...args),
  fetchMusicTrack: jest.fn(),
  fetchMusicLyric: jest.fn(),
  searchMusic: jest.fn(async () => ({
    source: 'netease',
    query: '',
    tracks: [],
    collections: [],
  })),
}));

jest.mock('@/lib/music/profile', () => ({
  buildMusicTrackFromQueueItem: jest.fn((track) => ({
    id: track.trackId,
    source: track.source,
    title: track.title,
    artists: track.artistsText
      .split(' / ')
      .filter(Boolean)
      .map((name: string) => ({ name })),
    album: track.albumTitle
      ? {
          title: track.albumTitle,
        }
      : undefined,
    cover: track.cover,
    durationMs: track.durationMs,
    playable: true,
    subtitle: track.subtitle,
  })),
  getMusicFavoritesList: jest.fn(async () => [
    {
      trackId: 'favorite-track',
      source: 'netease',
      title: '收藏歌曲',
      artistsText: '歌手甲',
      cover: 'https://example.com/favorite.jpg',
      durationMs: 198000,
      albumTitle: '收藏专辑',
      subtitle: '收藏条目',
      savedAt: 3000,
    },
  ]),
  getAllMusicPlayRecords: jest.fn(async () => ({
    'netease+resume-track': {
      trackId: 'resume-track',
      source: 'netease',
      title: '续播歌曲',
      artistsText: '歌手丙',
      cover: 'https://example.com/resume.jpg',
      durationMs: 246000,
      albumTitle: '续播专辑',
      subtitle: '中断前播放',
      playedAt: 5000,
      playTimeSec: 84,
      durationSec: 246,
      completed: false,
    },
  })),
  getMusicRecentTracks: jest.fn(async () => [
    {
      trackId: 'recent-track',
      source: 'qq',
      title: '最近播放歌曲',
      artistsText: '歌手乙',
      cover: 'https://example.com/recent.jpg',
      durationMs: 205000,
      albumTitle: '最近专辑',
      subtitle: '最近播放',
      playedAt: 4000,
    },
  ]),
  subscribeToMusicProfileUpdates: jest.fn(() => () => undefined),
}));

function resetMusicPlayerStore() {
  useMusicPlayerStore.setState({
    hasHydrated: true,
    queue: [],
    currentIndex: -1,
    playMode: 'list-loop',
    volume: 0.85,
    muted: false,
    currentTimeSec: 0,
    recentTracks: [],
    isPlaying: false,
    durationSec: 0,
    streamUrl: null,
    lyrics: null,
    isTrackLoading: false,
    trackError: null,
  });
}

describe('MusicPageClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = 'source=netease&tab=rank&id=netease-rank-city';
    mockSources[2] = {
      ...mockSources[2],
      enabled: true,
    };
    mockCollection = {
      id: 'netease-rank-city',
      source: 'netease',
      kind: 'rank',
      title: '城市夜航榜',
      tracks: playableCollectionTracks,
    };
    mockFetchMusicCollection.mockResolvedValue(mockCollection);
    resetMusicPlayerStore();
  });

  it('describes the current music rollout accurately', async () => {
    render(<MusicPageClient />);

    expect(
      await screen.findByText(
        /统一 music client 已接通平台切换、热门、歌单、搜索和全局播放器/,
        {
          selector: 'p',
        }
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /当前 Web 与桌面本地模式都会按平台配置显示网易云、Audius，\s*Jamendo 在配置 client id 后也会一起显示/,
        {
          selector: 'p',
        }
      )
    ).toBeInTheDocument();
  });

  it('renders audius and jamendo tabs when the music source api enables them', async () => {
    render(<MusicPageClient />);

    expect(await screen.findByText('Audius')).toBeInTheDocument();
    expect(await screen.findByText('Jamendo')).toBeInTheDocument();
  });

  it('clears the selected collection id when switching source from a detail view', async () => {
    render(<MusicPageClient />);

    fireEvent.click(await screen.findByText('Audius'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        '/music?source=audius&tab=home',
        {
          scroll: false,
        }
      );
    });
  });

  it('clears the selected collection id when switching tabs from a detail view', async () => {
    render(<MusicPageClient />);

    fireEvent.click(await screen.findByRole('button', { name: '歌单' }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        '/music?source=netease&tab=playlist',
        {
          scroll: false,
        }
      );
    });
  });

  it('plays a collection immediately when the play icon is clicked', async () => {
    render(<MusicPageClient />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: '直接播放 城市夜航榜',
      })
    );

    await waitFor(() => {
      expect(mockFetchMusicCollection).toHaveBeenCalledWith({
        source: 'netease',
        id: 'netease-rank-city',
      });
    });

    await waitFor(() => {
      expect(useMusicPlayerStore.getState().queue).toEqual([
        expect.objectContaining({
          trackId: 'playlist-track-1',
          source: 'netease',
          title: '夜航第一首',
        }),
        expect.objectContaining({
          trackId: 'playlist-track-2',
          source: 'netease',
          title: '夜航第二首',
        }),
      ]);
    });

    expect(mockReplace).not.toHaveBeenCalledWith(
      '/music?source=netease&tab=rank&id=netease-rank-city',
      {
        scroll: false,
      }
    );
  });

  it('falls back from jamendo and shows a graceful message when the source is disabled', async () => {
    mockSearchParams = 'source=jamendo&tab=home';
    mockSources[2] = {
      ...mockSources[2],
      enabled: false,
    };

    render(<MusicPageClient />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        '/music?source=netease&tab=home',
        {
          scroll: false,
        }
      );
    });

    expect(
      await screen.findByText(
        'Jamendo 官方接口当前不可用，已自动切换到其他平台'
      )
    ).toBeInTheDocument();
  });

  it('appends the local library tab and renders favorite and recent tracks', async () => {
    mockSearchParams = 'source=netease&tab=library';

    render(<MusicPageClient />);

    expect(
      await screen.findByRole('button', { name: '曲库' })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: '继续收听' })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: '我的收藏' })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: '最近播放' })
    ).toBeInTheDocument();
    expect(await screen.findByText('续播歌曲')).toBeInTheDocument();
    expect(await screen.findByText('收藏歌曲')).toBeInTheDocument();
    expect(await screen.findByText('最近播放歌曲')).toBeInTheDocument();
  });
});
