'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type {
  MusicCollection,
  MusicHomePayload,
  MusicSource,
} from '@/lib/music/types';

import { useMusicPlayerStore } from '@/stores/musicPlayerStore';

import MusicPageClient from './MusicPageClient';

const mockReplace = jest.fn();
let mockSearchParams = 'source=netease&tab=rank&id=netease-rank-city';

const mockSources: MusicSource[] = [
  {
    key: 'netease',
    name: '网易云音乐',
    provider: 'netease',
    enabled: true,
    tabs: ['home', 'rank', 'hot', 'playlist', 'search'],
  },
  {
    key: 'qq',
    name: 'QQ 音乐',
    provider: 'qq',
    enabled: true,
    tabs: ['home', 'rank', 'hot', 'playlist', 'search'],
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

const mockCollection: MusicCollection = {
  id: 'netease-rank-city',
  source: 'netease',
  kind: 'rank',
  title: '城市夜航榜',
  tracks: [],
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
  fetchMusicCollection: jest.fn(async () => mockCollection),
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
    expanded: false,
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
    resetMusicPlayerStore();
  });

  it('clears the selected collection id when switching source from a detail view', async () => {
    render(<MusicPageClient />);

    fireEvent.click(await screen.findByText('QQ 音乐'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/music?source=qq&tab=rank', {
        scroll: false,
      });
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

  it('appends the local library tab and renders favorite and recent tracks', async () => {
    mockSearchParams = 'source=netease&tab=library';

    render(<MusicPageClient />);

    expect(
      await screen.findByRole('button', { name: '曲库' })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: '我的收藏' })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: '最近播放' })
    ).toBeInTheDocument();
    expect(await screen.findByText('收藏歌曲')).toBeInTheDocument();
    expect(await screen.findByText('最近播放歌曲')).toBeInTheDocument();
  });
});
