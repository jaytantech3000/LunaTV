'use client';

import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { useDownloadStore } from '@/stores/downloadStore';

jest.mock('@/lib/db.client', () => ({
  clearAllPlayRecords: jest.fn(),
  getAllPlayRecords: jest.fn(),
  getCachedPlayRecordsSnapshot: jest.fn(),
  subscribeToDataUpdates: jest.fn(() => () => undefined),
}));

jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

import {
  getAllPlayRecords,
  getCachedPlayRecordsSnapshot,
} from '@/lib/db.client';

import ContinueWatching from './ContinueWatching';
import { SiteProvider } from './SiteProvider';

const mockedGetAllPlayRecords = jest.mocked(getAllPlayRecords);
const mockedGetCachedPlayRecordsSnapshot = jest.mocked(
  getCachedPlayRecordsSnapshot
);

const buildPlayRecord = (partial: Record<string, unknown> = {}) => ({
  title: '普通剧集',
  source_name: '普通资源',
  year: '2026',
  cover: 'https://example.com/poster.jpg',
  index: 1,
  total_episodes: 12,
  play_time: 120,
  total_time: 1800,
  save_time: 1710000000000,
  search_title: '普通剧集',
  ...partial,
});

describe('ContinueWatching', () => {
  beforeEach(() => {
    mockedGetAllPlayRecords.mockReset();
    mockedGetCachedPlayRecordsSnapshot.mockReset();
    useDownloadStore.setState({
      hasHydrated: true,
      library: {},
      maxConcurrentTasks: 3,
      ownerUsername: null,
      tasks: {},
    });
  });

  it('hides adult play records when adult content filtering is enabled', async () => {
    const playRecords = {
      'adult+1': buildPlayRecord({
        title: 'OnlyFans 精选合集',
        save_time: 1710000001000,
        is_adult: true,
      }),
      'normal+2': buildPlayRecord({
        title: '普通剧集',
        save_time: 1710000002000,
      }),
    };

    mockedGetCachedPlayRecordsSnapshot.mockReturnValue(playRecords);
    mockedGetAllPlayRecords.mockResolvedValue(playRecords);

    render(
      <SiteProvider siteName='LunaTV' adultContentFilterEnabled>
        <ContinueWatching />
      </SiteProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('普通剧集')).toBeInTheDocument();
    });

    expect(screen.queryByText('OnlyFans 精选合集')).not.toBeInTheDocument();
  });

  it('keeps adult play records visible when adult content filtering is disabled', async () => {
    const playRecords = {
      'adult+1': buildPlayRecord({
        title: 'OnlyFans 精选合集',
        save_time: 1710000001000,
        is_adult: true,
      }),
    };

    mockedGetCachedPlayRecordsSnapshot.mockReturnValue(playRecords);
    mockedGetAllPlayRecords.mockResolvedValue(playRecords);

    render(
      <SiteProvider siteName='LunaTV' adultContentFilterEnabled={false}>
        <ContinueWatching />
      </SiteProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('OnlyFans 精选合集')).toBeInTheDocument();
    });
  });
});
