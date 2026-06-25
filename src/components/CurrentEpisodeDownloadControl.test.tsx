'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { getOfflineDownloadSupportState } from '@/lib/download/cache';
import { resolveDownloadablePlaybackSources } from '@/lib/download/downloadable';
import { DownloadedContentMeta } from '@/lib/download/types';
import { SearchResult } from '@/lib/types';

import { useDownloadStore } from '@/stores/downloadStore';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: React.PropsWithChildren<
    React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
  >) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock('@/lib/download/cache', () => ({
  getOfflineDownloadSupportState: jest.fn(),
}));

jest.mock('@/lib/download/downloadable', () => ({
  resolveDownloadablePlaybackSources: jest.fn(),
}));

jest.mock('@/lib/download/client', () => ({
  downloadClient: {
    startEpisodeDownload: jest.fn(),
    pauseTask: jest.fn(),
    resumeTask: jest.fn(),
    cancelTask: jest.fn(),
    deleteEpisode: jest.fn(),
  },
}));

jest.mock('@/components/BatchEpisodeDownloadDialog', () => ({
  __esModule: true,
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid='batch-dialog'>batch dialog</div> : null,
}));

import CurrentEpisodeDownloadControl from './CurrentEpisodeDownloadControl';

function buildDetail(): SearchResult {
  return {
    id: '1',
    title: '测试资源',
    poster: '',
    episodes: ['https://example.com/play-1.m3u8'],
    episodes_titles: ['第1集'],
    source: 'source-a',
    source_name: '源 A',
    year: '2026',
  };
}

function buildDownloadedContentMeta(): DownloadedContentMeta {
  return {
    contentId: 'source-a:1',
    source: 'source-a',
    vodId: '1',
    sourceName: '源 A',
    title: '测试资源',
    poster: '',
    year: '2026',
    episodeTitles: ['第1集'],
    ownerUsername: 'tester',
    episodes: [
      {
        episodeIndex: 0,
        episodeTitle: '第1集',
        rootManifestUrl: '/root.m3u8',
        playbackManifestUrl: '/play.m3u8',
        cacheIndexId: 'source-a:1:0',
        resourceCount: 24,
        sizeBytes: 1024 * 1024 * 64,
        downloadedAt: 1710000000000,
      },
    ],
    totalSizeBytes: 1024 * 1024 * 64,
    updatedAt: 1710000000000,
  };
}

describe('CurrentEpisodeDownloadControl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getOfflineDownloadSupportState as jest.Mock).mockReturnValue({
      supported: true,
    });
    useDownloadStore.setState({
      hasHydrated: true,
      library: {},
      maxConcurrentTasks: 3,
      ownerUsername: 'tester',
      tasks: {},
    });
  });

  it('uses an icon trigger for offline compact mode and toggles the detail panel', async () => {
    const detail = buildDetail();
    const downloadedContent = buildDownloadedContentMeta();

    useDownloadStore.setState({
      library: {
        [downloadedContent.contentId]: downloadedContent,
      },
    });

    render(
      <CurrentEpisodeDownloadControl
        detail={detail}
        episodeIndex={0}
        downloadEpisodeIndex={0}
        isOfflineMode
        compact
      />
    );

    const trigger = await screen.findByRole('button', {
      name: '查看离线下载详情',
    });

    expect(screen.queryByText('离线下载详情')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '下载更多' })
    ).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(screen.getByText('离线下载详情')).toBeInTheDocument();
    expect(screen.getByText('当前离线播放')).toBeInTheDocument();
    expect(screen.queryByText('已完成离线缓存')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '下载更多' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '收起离线下载详情' }));

    await waitFor(() => {
      expect(screen.queryByText('离线下载详情')).not.toBeInTheDocument();
    });
  });

  it('can still open batch download management from the compact offline panel', async () => {
    const detail = buildDetail();
    const downloadedContent = buildDownloadedContentMeta();

    useDownloadStore.setState({
      library: {
        [downloadedContent.contentId]: downloadedContent,
      },
    });
    (resolveDownloadablePlaybackSources as jest.Mock).mockResolvedValue({
      detail,
      availableSources: [],
    });

    render(
      <CurrentEpisodeDownloadControl
        detail={detail}
        episodeIndex={0}
        downloadEpisodeIndex={0}
        isOfflineMode
        compact
        searchTitle='测试资源'
        searchType='tv'
      />
    );

    fireEvent.click(
      await screen.findByRole('button', { name: '查看离线下载详情' })
    );
    fireEvent.click(screen.getByRole('button', { name: '下载更多' }));

    await waitFor(() => {
      expect(resolveDownloadablePlaybackSources).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'source-a',
          id: '1',
          query: '测试资源',
          searchType: 'tv',
        })
      );
    });

    expect(await screen.findByTestId('batch-dialog')).toBeInTheDocument();
  });

  it('renders a simplified standard download summary for online playback', async () => {
    const detail = {
      ...buildDetail(),
      episodes_titles: ['全集'],
    };

    render(<CurrentEpisodeDownloadControl detail={detail} episodeIndex={0} />);

    expect(await screen.findByText('离线下载')).toBeInTheDocument();
    expect(screen.getByText('当前内容')).toBeInTheDocument();
    expect(screen.getByText('未缓存')).toBeInTheDocument();
    expect(
      screen.getByText('可缓存当前内容，稍后离线播放。')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '下载当前集' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '下载选项' })
    ).toBeInTheDocument();
  });
});
