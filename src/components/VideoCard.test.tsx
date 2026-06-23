'use client';

/* eslint-disable @next/next/no-img-element */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const mockRouter = {
  back: jest.fn(),
  prefetch: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};

const beginNavigation = jest.fn();

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    alt,
    fill: _fill,
    onLoadingComplete: _onLoadingComplete,
    ...props
  }: React.ComponentProps<'img'> & {
    fill?: boolean;
    onLoadingComplete?: () => void;
  }) => <img {...props} alt={alt || ''} />,
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => mockRouter),
}));

jest.mock('@/hooks/useLongPress', () => ({
  useLongPress: jest.fn(() => ({})),
}));

jest.mock('@/lib/db.client', () => ({
  deleteFavorite: jest.fn(),
  deletePlayRecord: jest.fn(),
  generateStorageKey: jest.fn(() => 'storage-key'),
  getCachedFollowRecordsSnapshot: jest.fn(() => ({})),
  getFollowRecord: jest.fn(),
  isFavorited: jest.fn(),
  saveFavorite: jest.fn(),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));

jest.mock('@/lib/follow-updates', () => ({
  canManageFollowUpdates: jest.fn(() => true),
  disableFollowUpdatesWithFeedback: jest.fn(),
  enableFollowUpdatesWithFeedback: jest.fn(),
  hasNewEpisodes: jest.fn((follow) =>
    Boolean(
      follow && follow.latest_episode_count > follow.acknowledged_episode_count
    )
  ),
  isDesktopFollowUpdatesEnabled: jest.fn(() => true),
}));

jest.mock('@/lib/download/cache', () => ({
  getOfflineDownloadSupportState: jest.fn(() => ({
    supported: true,
  })),
}));

jest.mock('@/lib/download/downloadable', () => ({
  resolveDownloadablePlaybackSources: jest.fn(),
}));

jest.mock('@/components/BatchEpisodeDownloadDialog', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/ImagePlaceholder', () => ({
  ImagePlaceholder: () => <div data-testid='image-placeholder' />,
}));

jest.mock('@/components/MobileActionSheet', () => ({
  __esModule: true,
  default: ({
    isOpen,
    actions,
  }: {
    isOpen: boolean;
    actions: Array<{
      id: string;
      label: string;
      disabled?: boolean;
      onClick: () => void;
    }>;
  }) =>
    isOpen ? (
      <div data-testid='mobile-action-sheet'>
        {actions.map((action) => (
          <button
            key={action.id}
            type='button'
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
    ) : null,
}));

jest.mock('@/components/NavigationFeedbackProvider', () => ({
  useNavigationFeedback: jest.fn(() => ({
    beginNavigation,
  })),
}));

import {
  getCachedFollowRecordsSnapshot,
  getFollowRecord,
  isFavorited,
  saveFavorite,
} from '@/lib/db.client';
import { resolveDownloadablePlaybackSources } from '@/lib/download/downloadable';
import {
  disableFollowUpdatesWithFeedback,
  enableFollowUpdatesWithFeedback,
} from '@/lib/follow-updates';

import VideoCard from './VideoCard';

describe('VideoCard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (isFavorited as jest.Mock).mockResolvedValue(false);
    (getFollowRecord as jest.Mock).mockResolvedValue(null);
    (getCachedFollowRecordsSnapshot as jest.Mock).mockReturnValue({});
    (enableFollowUpdatesWithFeedback as jest.Mock).mockResolvedValue({
      title: '追更视频',
      source_name: '测试源',
      year: '2026',
      cover: 'https://example.com/poster.jpg',
      search_title: '追更视频',
      followed_at: 1,
      followed_episode_count: 12,
      acknowledged_episode_count: 12,
      latest_episode_count: 12,
      last_checked_at: 1,
    });
    (resolveDownloadablePlaybackSources as jest.Mock).mockResolvedValue({
      detail: {
        source: 'resolved-source',
        id: 'resolved-id',
        title: '解析后视频',
        source_name: '解析源',
        year: '2026',
        poster: 'https://example.com/resolved-poster.jpg',
      },
      availableSources: [],
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('shows immediate loading feedback before pushing the playback route', async () => {
    render(
      <VideoCard
        from='search'
        id='video-1'
        poster='https://example.com/poster.jpg'
        source='source-a'
        title='测试视频'
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByAltText('测试视频'));

    const href = `/play?source=source-a&id=video-1&title=${encodeURIComponent(
      '测试视频'
    )}`;

    expect(beginNavigation).toHaveBeenCalledWith({
      href,
      kind: 'card',
      label: '测试视频',
    });
    expect(screen.getByText('正在打开')).toBeInTheDocument();
    expect(mockRouter.push).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(mockRouter.push).toHaveBeenCalledWith(href);
  });

  it('routes favorites with offline playback metadata back to offline playback', async () => {
    render(
      <VideoCard
        from='favorite'
        id='video-1'
        poster='https://example.com/poster.jpg'
        source='source-a'
        title='离线视频'
        year='2026'
        currentEpisode={2}
        playbackMode='offline'
        offlineContentId='source-a:video-1'
        source_name='测试源'
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByAltText('离线视频'));

    const href =
      '/play?offline=1&contentId=source-a%3Avideo-1&source=source-a&id=video-1&title=%E7%A6%BB%E7%BA%BF%E8%A7%86%E9%A2%91&year=2026&episode=2';

    expect(beginNavigation).toHaveBeenCalledWith({
      href,
      kind: 'card',
      label: '离线视频',
    });
    expect(screen.getByText('离线')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(mockRouter.push).toHaveBeenCalledWith(href);
  });

  it('shows follow-updates actions in the context menu', async () => {
    render(
      <VideoCard
        from='favorite'
        id='video-1'
        poster='https://example.com/poster.jpg'
        source='source-a'
        title='追更视频'
        source_name='测试源'
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.contextMenu(screen.getByAltText('追更视频'));

    expect(screen.getByText('开启追更')).toBeInTheDocument();

    fireEvent.click(screen.getByText('开启追更'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(enableFollowUpdatesWithFeedback).toHaveBeenCalledWith({
      source: 'source-a',
      id: 'video-1',
      title: '追更视频',
      sourceName: '测试源',
      year: undefined,
      cover: 'https://example.com/poster.jpg',
      searchTitle: '追更视频',
    });
    expect(disableFollowUpdatesWithFeedback).not.toHaveBeenCalled();
  });

  it('shows follow-updates actions for douban cards and enables them with the resolved source', async () => {
    render(
      <VideoCard
        from='douban'
        poster='https://example.com/poster.jpg'
        title='豆瓣聚合视频'
        year='2026'
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.contextMenu(screen.getByAltText('豆瓣聚合视频'));

    expect(screen.getByText('开启追更')).toBeInTheDocument();

    fireEvent.click(screen.getByText('开启追更'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveDownloadablePlaybackSources).toHaveBeenCalledWith({
      title: '豆瓣聚合视频',
      year: '2026',
      searchType: undefined,
      query: undefined,
      doubanId: undefined,
      allowAdultCandidates: false,
    });
    expect(enableFollowUpdatesWithFeedback).toHaveBeenCalledWith({
      source: 'resolved-source',
      id: 'resolved-id',
      title: '解析后视频',
      sourceName: '解析源',
      year: '2026',
      cover: 'https://example.com/resolved-poster.jpg',
      searchTitle: '豆瓣聚合视频',
    });
  });

  it('shows favorite actions in the context menu for direct cards', async () => {
    render(
      <VideoCard
        from='playrecord'
        id='video-1'
        poster='https://example.com/poster.jpg'
        source='source-a'
        title='favorite-video'
        source_name='source-name'
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.contextMenu(screen.getByAltText('favorite-video'));

    expect(screen.getByText('添加收藏')).toBeInTheDocument();

    fireEvent.click(screen.getByText('添加收藏'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(saveFavorite).toHaveBeenCalledWith(
      'source-a',
      'video-1',
      expect.objectContaining({
        title: 'favorite-video',
        source_name: 'source-name',
        year: '',
        cover: 'https://example.com/poster.jpg',
        total_episodes: 1,
        search_title: 'favorite-video',
        playback_mode: 'online',
        is_adult: expect.any(Boolean),
        origin: 'vod',
      })
    );
  });

  it('shows favorite actions for douban cards and saves the resolved source', async () => {
    render(
      <VideoCard
        from='douban'
        poster='https://example.com/poster.jpg'
        title='douban-favorite-video'
        year='2026'
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.contextMenu(screen.getByAltText('douban-favorite-video'));

    expect(screen.getByText('添加收藏')).toBeInTheDocument();

    fireEvent.click(screen.getByText('添加收藏'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveDownloadablePlaybackSources).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'douban-favorite-video',
        year: '2026',
        searchType: undefined,
        query: undefined,
        doubanId: undefined,
        allowAdultCandidates: expect.any(Boolean),
      })
    );
    expect(saveFavorite).toHaveBeenCalledWith(
      'resolved-source',
      'resolved-id',
      expect.objectContaining({
        title: expect.any(String),
        source_name: expect.any(String),
        year: '2026',
        cover: 'https://example.com/resolved-poster.jpg',
        total_episodes: 1,
        search_title: 'douban-favorite-video',
        playback_mode: 'online',
        is_adult: expect.any(Boolean),
        origin: 'vod',
      })
    );
  });

  it('renders the NEW badge when followed content has updates', async () => {
    (getCachedFollowRecordsSnapshot as jest.Mock).mockReturnValue({
      'storage-key': {
        title: '追更视频',
        source_name: '测试源',
        year: '2026',
        cover: 'https://example.com/poster.jpg',
        search_title: '追更视频',
        followed_at: 1,
        followed_episode_count: 12,
        acknowledged_episode_count: 12,
        latest_episode_count: 14,
        last_checked_at: 1,
      },
    });
    (getFollowRecord as jest.Mock).mockResolvedValue({
      title: '追更视频',
      source_name: '测试源',
      year: '2026',
      cover: 'https://example.com/poster.jpg',
      search_title: '追更视频',
      followed_at: 1,
      followed_episode_count: 12,
      acknowledged_episode_count: 12,
      latest_episode_count: 14,
      last_checked_at: 1,
    });

    render(
      <VideoCard
        from='favorite'
        id='video-1'
        poster='https://example.com/poster.jpg'
        source='source-a'
        title='追更视频'
        source_name='测试源'
        episodes={14}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(await screen.findByText('NEW')).toBeInTheDocument();
  });
});
