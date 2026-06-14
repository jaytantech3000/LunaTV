jest.mock('@/lib/config', () => ({
  API_CONFIG: {
    search: {
      path: '?ac=videolist&wd=',
      pagePath: '?ac=videolist&wd={query}&pg={page}',
      headers: {
        'User-Agent': 'test-agent',
        Accept: 'application/json',
      },
    },
    detail: {
      path: '?ac=videolist&ids=',
      headers: {
        Accept: 'application/json',
      },
    },
  },
  getConfig: jest.fn(),
}));

jest.mock('@/lib/search-cache', () => ({
  getCachedSearchPage: jest.fn(),
  setCachedSearchPage: jest.fn(),
}));

import { getConfig } from '@/lib/config';
import { getCachedSearchPage, setCachedSearchPage } from '@/lib/search-cache';

import { resolveDirectUrlFromProxyUrl, searchFromApi } from './downstream';

describe('downstream proxy fallback', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as typeof fetch;
    (getConfig as jest.Mock).mockResolvedValue({
      SiteConfig: {
        SearchDownstreamMaxPage: 1,
      },
    });
    (getCachedSearchPage as jest.Mock).mockReset();
    (getCachedSearchPage as jest.Mock).mockReturnValue(null);
    (setCachedSearchPage as jest.Mock).mockReset();
  });

  it('restores the raw target url from passthrough proxy urls', () => {
    expect(
      resolveDirectUrlFromProxyUrl(
        'https://proxy.example.com/fetch?url=https://api.xiaojizy.live/provide/vod?ac=videolist&wd=onlyfans&pg=2'
      )
    ).toBe(
      'https://api.xiaojizy.live/provide/vod?ac=videolist&wd=onlyfans&pg=2'
    );
  });

  it('falls back to the raw upstream source when the proxy search fails', async () => {
    const proxySite = {
      key: 'xiaojizy.live',
      name: '🔞小鸡资源',
      api: 'https://proxy.example.com/fetch?url=https://api.xiaojizy.live/provide/vod',
    };
    const abortError = new Error('The operation was aborted.');
    (abortError as Error & { name: string }).name = 'AbortError';

    fetchMock
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            pagecount: 1,
            list: [
              {
                vod_id: 100287,
                vod_name: 'OnlyFans - Lana Smalls, Johnny Sins - Round 3',
                vod_pic: 'https://example.com/poster.jpg',
                vod_play_url:
                  '全集$https://xjzym3u-api.cdn-xj.cc/mov/test/index.m3u8',
                vod_content: 'test desc',
                vod_class: '性感网红',
                type_name: '性感网红',
              },
            ],
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        )
      );

    const results = await searchFromApi(
      proxySite as Parameters<typeof searchFromApi>[0],
      'onlyfans'
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://proxy.example.com/fetch?url=https://api.xiaojizy.live/provide/vod?ac=videolist&wd=onlyfans'
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.xiaojizy.live/provide/vod?ac=videolist&wd=onlyfans'
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: '100287',
      title: 'OnlyFans - Lana Smalls, Johnny Sins - Round 3',
      source: 'xiaojizy.live',
    });
    expect(setCachedSearchPage).toHaveBeenCalledWith(
      'xiaojizy.live',
      'onlyfans',
      1,
      'ok',
      expect.any(Array),
      1
    );
  });
});
