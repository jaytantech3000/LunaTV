jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getAvailableApiSites: jest.fn(),
  getCacheTime: jest.fn(),
  getConfig: jest.fn(),
}));

jest.mock('@/lib/downstream', () => ({
  searchFromApi: jest.fn(),
}));

jest.mock('@/lib/episode-rewriter', () => ({
  rewriteEpisodesForAdFilterMany: jest.fn(),
}));

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { rewriteEpisodesForAdFilterMany } from '@/lib/episode-rewriter';

import { GET } from './route';

describe('/api/search', () => {
  const adultResult = {
    id: 'adult-1',
    title: 'OnlyFans 精选合集',
    source: 'adult-source',
    source_name: '🔞成人资源',
    poster: '',
    episodes: ['https://example.com/1.m3u8'],
    episodes_titles: ['第1集'],
    year: '2026',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthInfoFromCookie as jest.Mock).mockReturnValue({
      username: 'tester',
    });
    (getConfig as jest.Mock).mockResolvedValue({
      SiteConfig: {
        DisableYellowFilter: false,
      },
    });
    (getAvailableApiSites as jest.Mock).mockResolvedValue([
      {
        key: 'adult-source',
        name: '成人源',
      },
    ]);
    (getCacheTime as jest.Mock).mockResolvedValue(60);
    (rewriteEpisodesForAdFilterMany as jest.Mock).mockImplementation(
      async (results: unknown[]) => results
    );
  });

  it('filters adult results when site adult filtering is enabled', async () => {
    (searchFromApi as jest.Mock).mockResolvedValue([adultResult]);

    const request = new NextRequest('http://localhost/api/search?q=onlyfans');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.results).toEqual([]);
  });

  it('keeps adult results when site adult filtering is disabled', async () => {
    (getConfig as jest.Mock).mockResolvedValue({
      SiteConfig: {
        DisableYellowFilter: true,
      },
    });
    (searchFromApi as jest.Mock).mockResolvedValue([adultResult]);

    const request = new NextRequest('http://localhost/api/search?q=onlyfans');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.results).toEqual([adultResult]);
  });
});
