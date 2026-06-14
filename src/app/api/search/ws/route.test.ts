jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getAvailableApiSites: jest.fn(),
  getConfig: jest.fn(),
}));

jest.mock('@/lib/downstream', () => ({
  searchFromApi: jest.fn(),
}));

jest.mock('@/lib/yellow', () => {
  const actual = jest.requireActual('@/lib/yellow');
  return {
    ...actual,
    filterAdultContentResults: jest.fn(actual.filterAdultContentResults),
  };
});

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { filterAdultContentResults } from '@/lib/yellow';

import { GET } from './route';

describe('/api/search/ws', () => {
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
    (searchFromApi as jest.Mock).mockResolvedValue([adultResult]);
  });

  it('applies adult filtering when site adult filtering is enabled', async () => {
    const request = new NextRequest(
      'http://localhost/api/search/ws?q=onlyfans'
    );

    const response = await GET(request);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(searchFromApi).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'adult-source',
      }),
      'onlyfans'
    );
    expect(filterAdultContentResults).toHaveBeenCalledTimes(1);
  });

  it('skips adult filtering when site adult filtering is disabled', async () => {
    (getConfig as jest.Mock).mockResolvedValue({
      SiteConfig: {
        DisableYellowFilter: true,
      },
    });

    const request = new NextRequest(
      'http://localhost/api/search/ws?q=onlyfans'
    );

    const response = await GET(request);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(filterAdultContentResults).not.toHaveBeenCalled();
  });
});
