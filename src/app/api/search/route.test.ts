jest.mock('@/lib/auth', () => {
  const actual = jest.requireActual('@/lib/auth');
  return {
    ...actual,
    requireAuthContextFromRequest: jest.fn(),
  };
});

jest.mock('@/lib/core/content/service', () => ({
  searchContent: jest.fn(),
}));

import { NextRequest } from 'next/server';

import { AuthContextError, requireAuthContextFromRequest } from '@/lib/auth';
import { searchContent } from '@/lib/core/content/service';

import { GET } from './route';

describe('/api/search', () => {
  const searchResult = {
    id: 'adult-1',
    title: 'OnlyFans 绮鹃€夊悎闆?',
    source: 'adult-source',
    source_name: '馃敒鎴愪汉璧勬簮',
    poster: '',
    episodes: ['https://example.com/1.m3u8'],
    episodes_titles: ['绗?闆?'],
    year: '2026',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (requireAuthContextFromRequest as jest.Mock).mockReturnValue({
      username: 'tester',
      source: 'request-cookie',
    });
    (searchContent as jest.Mock).mockResolvedValue({
      results: [searchResult],
      cacheTime: 60,
    });
  });

  it('passes the adult flag through to the content service', async () => {
    const request = new NextRequest(
      'http://localhost/api/search?q=onlyfans&adult=1'
    );

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.results).toEqual([searchResult]);
    expect(searchContent).toHaveBeenCalledWith({
      authContext: expect.objectContaining({
        username: 'tester',
      }),
      query: 'onlyfans',
      allowAdultResults: true,
    });
  });

  it('returns auth errors from the request auth context helper', async () => {
    (requireAuthContextFromRequest as jest.Mock).mockImplementation(() => {
      throw new AuthContextError();
    });

    const request = new NextRequest('http://localhost/api/search?q=onlyfans');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({
      error: 'Unauthorized',
    });
  });
});
