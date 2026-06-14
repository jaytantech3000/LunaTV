'use client';

/* eslint-disable @next/next/no-img-element */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { DownloadedContentMeta } from '@/lib/download/types';

import { useDownloadStore } from '@/stores/downloadStore';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    alt,
    fill: _fill,
    ...props
  }: React.ComponentProps<'img'> & { fill?: boolean }) => (
    <img {...props} alt={alt || ''} />
  ),
}));

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  prefetch: jest.fn(),
};
const mockBeginNavigation = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => mockRouter),
  useSearchParams: jest.fn(() => new URLSearchParams()),
}));

jest.mock('./NavigationFeedbackProvider', () => ({
  useNavigationFeedback: jest.fn(() => ({
    beginNavigation: mockBeginNavigation,
    clearNavigation: jest.fn(),
    pendingNavigation: null,
  })),
}));

import { DownloadedContentDialog } from './DownloadsClient';

function buildDownloadedContentMeta(
  partial: Partial<DownloadedContentMeta> & Pick<DownloadedContentMeta, 'contentId' | 'source' | 'vodId'>
): DownloadedContentMeta {
  return {
    contentId: partial.contentId,
    source: partial.source,
    vodId: partial.vodId,
    sourceName: partial.sourceName ?? partial.source,
    title: partial.title ?? '同名资源',
    searchTitle: partial.searchTitle,
    poster: partial.poster ?? '',
    adultGroupPoster: partial.adultGroupPoster,
    remarks: partial.remarks,
    year: partial.year ?? '2026',
    desc: partial.desc,
    typeName: partial.typeName,
    doubanId: partial.doubanId,
    episodeTitles: partial.episodeTitles ?? ['第1集'],
    ownerUsername: partial.ownerUsername ?? 'tester',
    episodes:
      partial.episodes ?? [
        {
          episodeIndex: 0,
          episodeTitle: '第1集',
          rootManifestUrl: '/root.m3u8',
          playbackManifestUrl: '/play.m3u8',
          cacheIndexId: `${partial.contentId}:0`,
          resourceCount: 1,
          sizeBytes: 1024,
          downloadedAt: 1710000000000,
        },
      ],
    totalSizeBytes: partial.totalSizeBytes ?? 1024,
    updatedAt: partial.updatedAt ?? 1710000000000,
  };
}

describe('DownloadedContentDialog', () => {
  beforeEach(() => {
    mockRouter.push.mockReset();
    mockRouter.replace.mockReset();
    mockRouter.prefetch.mockReset();
    mockBeginNavigation.mockReset();
    useDownloadStore.setState({
      hasHydrated: true,
      library: {},
      maxConcurrentTasks: 3,
      ownerUsername: null,
      tasks: {},
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(0), 0),
      writable: true,
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: (id: number) => window.clearTimeout(id),
      writable: true,
    });
  });

  it('still closes after enabling local title grouping from the dialog menu', async () => {
    const primaryContent = buildDownloadedContentMeta({
      contentId: 'source-a:1',
      source: 'source-a',
      vodId: '1',
      sourceName: '源 A',
      title: '测试片名',
    });
    const secondaryContent = buildDownloadedContentMeta({
      contentId: 'source-b:2',
      source: 'source-b',
      vodId: '2',
      sourceName: '源 B',
      title: '测试片名',
      updatedAt: 1710000001000,
    });

    useDownloadStore.setState({
      library: {
        [primaryContent.contentId]: primaryContent,
        [secondaryContent.contentId]: secondaryContent,
      },
    });

    const contentGroup = {
      id: 'group-1',
      contentId: primaryContent.contentId,
      title: primaryContent.title,
      poster: primaryContent.poster,
      sourceName: primaryContent.sourceName,
      year: primaryContent.year,
      contents: [primaryContent],
      totalEpisodeCount: primaryContent.episodes.length,
      totalSizeBytes: primaryContent.totalSizeBytes,
      updatedAt: primaryContent.updatedAt,
    };

    function Wrapper() {
      const [isOpen, setIsOpen] = React.useState(true);

      if (!isOpen) {
        return <div data-testid='dialog-closed'>closed</div>;
      }

      return (
        <DownloadedContentDialog
          content={primaryContent}
          contentGroup={contentGroup}
          onSelectContent={jest.fn()}
          onClose={() => setIsOpen(false)}
          onDeleteEpisode={jest.fn(async () => undefined)}
        />
      );
    }

    render(<Wrapper />);

    fireEvent.click(screen.getByRole('button', { name: '更多设置' }));
    fireEvent.click(screen.getByRole('button', { name: /开启同名聚合/ }));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    await waitFor(() => {
      expect(screen.getByTestId('dialog-closed')).toBeInTheDocument();
    });
  });

  it('flattens grouped same-title episodes across sources into one playable list', async () => {
    const primaryContent = buildDownloadedContentMeta({
      contentId: 'source-a:1',
      source: 'source-a',
      vodId: '1',
      sourceName: '源 A',
      title: '铁拳教育',
      episodes: [
        {
          episodeIndex: 1,
          episodeTitle: '第2集',
          rootManifestUrl: '/source-a-root-2.m3u8',
          playbackManifestUrl: '/source-a-play-2.m3u8',
          cacheIndexId: 'source-a:1:1',
          resourceCount: 1,
          sizeBytes: 2048,
          downloadedAt: 1710000002000,
        },
      ],
      episodeTitles: ['第1集', '第2集'],
      totalSizeBytes: 2048,
    });
    const secondaryContent = buildDownloadedContentMeta({
      contentId: 'source-b:2',
      source: 'source-b',
      vodId: '2',
      sourceName: '源 B',
      title: '铁拳教育',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: '第1集',
          rootManifestUrl: '/source-b-root-1.m3u8',
          playbackManifestUrl: '/source-b-play-1.m3u8',
          cacheIndexId: 'source-b:2:0',
          resourceCount: 1,
          sizeBytes: 1024,
          downloadedAt: 1710000001000,
        },
      ],
      episodeTitles: ['第1集'],
      totalSizeBytes: 1024,
      updatedAt: 1710000003000,
    });

    useDownloadStore.setState({
      library: {
        [primaryContent.contentId]: primaryContent,
        [secondaryContent.contentId]: secondaryContent,
      },
    });

    const contentGroup = {
      id: 'title:铁拳教育',
      contentId: secondaryContent.contentId,
      title: secondaryContent.title,
      poster: secondaryContent.poster,
      sourceName: secondaryContent.sourceName,
      year: secondaryContent.year,
      groupingKind: 'title' as const,
      contents: [secondaryContent, primaryContent],
      totalEpisodeCount:
        secondaryContent.episodes.length + primaryContent.episodes.length,
      totalSizeBytes:
        secondaryContent.totalSizeBytes + primaryContent.totalSizeBytes,
      updatedAt: secondaryContent.updatedAt,
    };

    render(
      <DownloadedContentDialog
        content={secondaryContent}
        contentGroup={contentGroup}
        onSelectContent={jest.fn()}
        onClose={jest.fn()}
        onDeleteEpisode={jest.fn(async () => undefined)}
      />
    );

    expect(screen.getByText('2 条离线资源 · 覆盖 2 集')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '离线播放 源 B 的 第1集' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '离线播放 源 A 的 第2集' })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '离线播放 源 A 的 第2集' })
    );

    expect(mockBeginNavigation).toHaveBeenCalledWith({
      href: '/play?offline=1&contentId=source-a%3A1&source=source-a&id=1&title=%E9%93%81%E6%8B%B3%E6%95%99%E8%82%B2&year=2026&episode=2',
      kind: 'card',
      label: '源 A 的 第2集',
    });

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith(
        '/play?offline=1&contentId=source-a%3A1&source=source-a&id=1&title=%E9%93%81%E6%8B%B3%E6%95%99%E8%82%B2&year=2026&episode=2'
      );
    });
  });

  it('allows editing selections across grouped sources', async () => {
    const onDeleteEpisode = jest.fn(async () => undefined);
    const primaryContent = buildDownloadedContentMeta({
      contentId: 'source-a:1',
      source: 'source-a',
      vodId: '1',
      sourceName: '源 A',
      title: '铁拳教育',
      episodes: [
        {
          episodeIndex: 1,
          episodeTitle: '第2集',
          rootManifestUrl: '/source-a-root-2.m3u8',
          playbackManifestUrl: '/source-a-play-2.m3u8',
          cacheIndexId: 'source-a:1:1',
          resourceCount: 1,
          sizeBytes: 2048,
          downloadedAt: 1710000002000,
        },
      ],
      episodeTitles: ['第1集', '第2集'],
      totalSizeBytes: 2048,
    });
    const secondaryContent = buildDownloadedContentMeta({
      contentId: 'source-b:2',
      source: 'source-b',
      vodId: '2',
      sourceName: '源 B',
      title: '铁拳教育',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: '第1集',
          rootManifestUrl: '/source-b-root-1.m3u8',
          playbackManifestUrl: '/source-b-play-1.m3u8',
          cacheIndexId: 'source-b:2:0',
          resourceCount: 1,
          sizeBytes: 1024,
          downloadedAt: 1710000001000,
        },
      ],
      episodeTitles: ['第1集'],
      totalSizeBytes: 1024,
      updatedAt: 1710000003000,
    });

    useDownloadStore.setState({
      library: {
        [primaryContent.contentId]: primaryContent,
        [secondaryContent.contentId]: secondaryContent,
      },
    });

    const contentGroup = {
      id: 'title:铁拳教育',
      contentId: secondaryContent.contentId,
      title: secondaryContent.title,
      poster: secondaryContent.poster,
      sourceName: secondaryContent.sourceName,
      year: secondaryContent.year,
      groupingKind: 'title' as const,
      contents: [secondaryContent, primaryContent],
      totalEpisodeCount:
        secondaryContent.episodes.length + primaryContent.episodes.length,
      totalSizeBytes:
        secondaryContent.totalSizeBytes + primaryContent.totalSizeBytes,
      updatedAt: secondaryContent.updatedAt,
    };

    render(
      <DownloadedContentDialog
        content={secondaryContent}
        contentGroup={contentGroup}
        onSelectContent={jest.fn()}
        onClose={jest.fn()}
        onDeleteEpisode={onDeleteEpisode}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.click(
      screen.getByRole('button', { name: '选择 源 B 的 第1集' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: '选择 源 A 的 第2集' })
    );
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(onDeleteEpisode).toHaveBeenCalledTimes(2);
    });

    expect(onDeleteEpisode).toHaveBeenNthCalledWith(1, 'source-b:2', 0);
    expect(onDeleteEpisode).toHaveBeenNthCalledWith(2, 'source-a:1', 1);
  });

  it('simplifies repeated metadata for adult grouped offline resources', async () => {
    const primaryContent = buildDownloadedContentMeta({
      contentId: 'adult-a:1',
      source: 'adult-a',
      vodId: '1',
      sourceName: '豆豆资源',
      title: 'miuzxc vol.1',
      searchTitle: 'miuzxc',
      poster: 'https://example.com/poster-a.jpg',
      remarks: '85分钟',
      typeName: '伦理片',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: 'HD',
          rootManifestUrl: '/adult-a-root-1.m3u8',
          playbackManifestUrl: '/adult-a-play-1.m3u8',
          cacheIndexId: 'adult-a:1:0',
          resourceCount: 1,
          sizeBytes: 1024,
          downloadedAt: 1710000001000,
        },
      ],
      episodeTitles: ['HD'],
      totalSizeBytes: 1024,
    });
    const secondaryContent = buildDownloadedContentMeta({
      contentId: 'adult-b:2',
      source: 'adult-b',
      vodId: '2',
      sourceName: '豆豆资源',
      title: 'miuzxc vol.2',
      searchTitle: 'miuzxc',
      poster: 'https://example.com/poster-b.jpg',
      remarks: '92分钟',
      typeName: '伦理片',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: 'HD',
          rootManifestUrl: '/adult-b-root-1.m3u8',
          playbackManifestUrl: '/adult-b-play-1.m3u8',
          cacheIndexId: 'adult-b:2:0',
          resourceCount: 1,
          sizeBytes: 2048,
          downloadedAt: 1710000002000,
        },
      ],
      episodeTitles: ['HD'],
      totalSizeBytes: 2048,
      updatedAt: 1710000003000,
    });

    useDownloadStore.setState({
      library: {
        [primaryContent.contentId]: primaryContent,
        [secondaryContent.contentId]: secondaryContent,
      },
    });

    const contentGroup = {
      id: 'adult:miuzxc',
      contentId: primaryContent.contentId,
      title: 'miuzxc',
      poster: primaryContent.poster,
      sourceName: primaryContent.sourceName,
      year: primaryContent.year,
      groupingKind: 'adult' as const,
      adultGroupingQuery: 'miuzxc',
      contents: [primaryContent, secondaryContent],
      totalEpisodeCount:
        primaryContent.episodes.length + secondaryContent.episodes.length,
      totalSizeBytes:
        primaryContent.totalSizeBytes + secondaryContent.totalSizeBytes,
      updatedAt: secondaryContent.updatedAt,
    };

    render(
      <DownloadedContentDialog
        content={primaryContent}
        contentGroup={contentGroup}
        onSelectContent={jest.fn()}
        onClose={jest.fn()}
        onDeleteEpisode={jest.fn(async () => undefined)}
      />
    );

    expect(screen.getByText('2 条离线资源 · 覆盖 1 集')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '离线播放 miuzxc vol.1' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '离线播放 miuzxc vol.2' })
    ).toBeInTheDocument();
    expect(screen.getByAltText('miuzxc 归集图')).toBeInTheDocument();
    expect(screen.getByAltText('miuzxc vol.1 封面')).toBeInTheDocument();
    expect(screen.getByAltText('miuzxc vol.2 封面')).toBeInTheDocument();
    expect(screen.getByText('85分钟')).toBeInTheDocument();
    expect(screen.getByText('92分钟')).toBeInTheDocument();
    expect(screen.queryByText('EP01')).not.toBeInTheDocument();
    expect(screen.queryByText('HD')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('豆豆资源')).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: '豆豆资源' })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '离线播放 miuzxc vol.2' })
    );

    expect(mockBeginNavigation).toHaveBeenCalledWith({
      href: '/play?offline=1&contentId=adult-b%3A2&source=adult-b&id=2&title=miuzxc+vol.2&year=2026&episode=1',
      kind: 'card',
      label: 'miuzxc vol.2',
    });

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith(
        '/play?offline=1&contentId=adult-b%3A2&source=adult-b&id=2&title=miuzxc+vol.2&year=2026&episode=1'
      );
    });
  });

  it('allows setting an adult grouped resource poster as the group cover', async () => {
    const primaryContent = buildDownloadedContentMeta({
      contentId: 'adult-a:1',
      source: 'adult-a',
      vodId: '1',
      sourceName: '豆豆资源',
      title: 'miuzxc vol.1',
      searchTitle: 'miuzxc',
      poster: 'https://example.com/poster-a.jpg',
      remarks: '85分钟',
      typeName: '伦理片',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: 'HD',
          rootManifestUrl: '/adult-a-root-1.m3u8',
          playbackManifestUrl: '/adult-a-play-1.m3u8',
          cacheIndexId: 'adult-a:1:0',
          resourceCount: 1,
          sizeBytes: 1024,
          downloadedAt: 1710000001000,
        },
      ],
      episodeTitles: ['HD'],
      totalSizeBytes: 1024,
    });
    const secondaryContent = buildDownloadedContentMeta({
      contentId: 'adult-b:2',
      source: 'adult-b',
      vodId: '2',
      sourceName: '豆豆资源',
      title: 'miuzxc vol.2',
      searchTitle: 'miuzxc',
      poster: 'https://example.com/poster-b.jpg',
      remarks: '92分钟',
      typeName: '伦理片',
      episodes: [
        {
          episodeIndex: 0,
          episodeTitle: 'HD',
          rootManifestUrl: '/adult-b-root-1.m3u8',
          playbackManifestUrl: '/adult-b-play-1.m3u8',
          cacheIndexId: 'adult-b:2:0',
          resourceCount: 1,
          sizeBytes: 2048,
          downloadedAt: 1710000002000,
        },
      ],
      episodeTitles: ['HD'],
      totalSizeBytes: 2048,
      updatedAt: 1710000003000,
    });

    useDownloadStore.setState({
      library: {
        [primaryContent.contentId]: primaryContent,
        [secondaryContent.contentId]: secondaryContent,
      },
    });

    const contentGroup = {
      id: 'adult:miuzxc',
      contentId: primaryContent.contentId,
      title: 'miuzxc',
      poster: primaryContent.poster,
      sourceName: primaryContent.sourceName,
      year: primaryContent.year,
      groupingKind: 'adult' as const,
      adultGroupingQuery: 'miuzxc',
      contents: [primaryContent, secondaryContent],
      totalEpisodeCount:
        primaryContent.episodes.length + secondaryContent.episodes.length,
      totalSizeBytes:
        primaryContent.totalSizeBytes + secondaryContent.totalSizeBytes,
      updatedAt: secondaryContent.updatedAt,
    };

    render(
      <DownloadedContentDialog
        content={primaryContent}
        contentGroup={contentGroup}
        onSelectContent={jest.fn()}
        onClose={jest.fn()}
        onDeleteEpisode={jest.fn(async () => undefined)}
      />
    );

    fireEvent.contextMenu(
      screen.getByRole('button', { name: '离线播放 miuzxc vol.2' })
    );
    fireEvent.click(screen.getByRole('menuitem', { name: '设为封面' }));

    await waitFor(() => {
      expect(screen.getByAltText('miuzxc 归集图')).toHaveAttribute(
        'src',
        'https://example.com/poster-b.jpg'
      );
    });

    const { library } = useDownloadStore.getState();
    expect(library[primaryContent.contentId]?.adultGroupPoster).toBe(
      'https://example.com/poster-b.jpg'
    );
    expect(library[secondaryContent.contentId]?.adultGroupPoster).toBe(
      'https://example.com/poster-b.jpg'
    );
    expect(
      screen.getByText('已将 miuzxc vol.2 设为归集封面。')
    ).toBeInTheDocument();
  });
});
