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
  isFavorited: jest.fn(),
  saveFavorite: jest.fn(),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
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
  default: () => null,
}));

jest.mock('@/components/NavigationFeedbackProvider', () => ({
  useNavigationFeedback: jest.fn(() => ({
    beginNavigation,
  })),
}));

import { isFavorited } from '@/lib/db.client';

import VideoCard from './VideoCard';

describe('VideoCard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (isFavorited as jest.Mock).mockResolvedValue(false);
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
});
