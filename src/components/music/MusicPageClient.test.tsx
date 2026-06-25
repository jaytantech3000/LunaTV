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
  useSearchParams: jest.fn(
    () => new URLSearchParams('source=netease&tab=rank&id=netease-rank-city')
  ),
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
});
