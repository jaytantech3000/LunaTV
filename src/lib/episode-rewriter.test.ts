jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

import type { NextRequest } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import type { SearchResult } from '@/lib/types';

import {
  rewriteEpisodesForAdFilter,
  shouldUseServerSideEpisodeProxy,
} from './episode-rewriter';

type MockRequest = Pick<NextRequest, 'headers' | 'nextUrl'>;

function makeRequest(
  adfilter?: string,
  options: {
    client?: string;
    host?: string;
    protocol?: string;
    userAgent?: string;
  } = {}
) {
  const searchParams = new URLSearchParams();
  if (adfilter !== undefined) {
    searchParams.set('adfilter', adfilter);
  }
  if (options.client) {
    searchParams.set('client', options.client);
  }

  const request: MockRequest = {
    nextUrl: {
      searchParams,
      origin: `${options.protocol || 'http'}://${options.host || 'localhost:3000'}`,
      protocol: `${options.protocol || 'http'}:`,
    },
    headers: {
      get: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === 'user-agent') return options.userAgent;
        if (normalized === 'host') return options.host || 'localhost:3000';
        if (normalized === 'x-forwarded-proto') return options.protocol;
        return undefined;
      },
    },
  };

  return request as unknown as NextRequest;
}

function createResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'demo-id',
    title: 'Demo Title',
    poster: '',
    episodes: ['https://example.com/path/index.m3u8'],
    episodes_titles: ['第1集'],
    source: 'demo',
    source_name: 'Demo',
    year: '2026',
    ...overrides,
  };
}

function createAdminConfig(
  overrides: Partial<AdminConfig> = {}
): AdminConfig {
  return {
    ConfigSubscribtion: {
      URL: '',
      AutoUpdate: false,
      LastCheck: '',
    },
    ConfigFile: '{}',
    SiteConfig: {
      SiteName: 'LunaTV',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType: '',
      DoubanProxy: '',
      DoubanImageProxyType: '',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
      FluidSearch: true,
      EnableWebLive: false,
    },
    UserConfig: {
      Users: [],
    },
    SourceConfig: [],
    CustomCategories: [],
    AdFilterConfig: {
      enabled: true,
    },
    ...overrides,
  };
}

describe('shouldUseServerSideEpisodeProxy', () => {
  const originalEnv = {
    ENABLE_AD_FILTER: process.env.ENABLE_AD_FILTER,
    ENABLE_M3U8_SERVER_PROXY: process.env.ENABLE_M3U8_SERVER_PROXY,
    M3U8_SERVER_PROXY: process.env.M3U8_SERVER_PROXY,
  };

  afterEach(() => {
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it('uses server-side filtering by default for browser playback', () => {
    delete process.env.ENABLE_AD_FILTER;
    delete process.env.ENABLE_M3U8_SERVER_PROXY;
    delete process.env.M3U8_SERVER_PROXY;

    expect(shouldUseServerSideEpisodeProxy(null, makeRequest())).toBe(true);
  });

  it('allows legacy env to disable server-side filtering', () => {
    process.env.ENABLE_AD_FILTER = 'false';

    expect(shouldUseServerSideEpisodeProxy(null, makeRequest())).toBe(false);
  });

  it('lets explicit proxy env override admin defaults', () => {
    process.env.M3U8_SERVER_PROXY = 'false';

    expect(
      shouldUseServerSideEpisodeProxy(
        createAdminConfig({ AdFilterConfig: { enabled: true } }),
        makeRequest()
      )
    ).toBe(false);
  });

  it('lets the request force proxy or direct mode', () => {
    expect(shouldUseServerSideEpisodeProxy(null, makeRequest('server'))).toBe(
      true
    );
    expect(
      shouldUseServerSideEpisodeProxy(
        createAdminConfig({ AdFilterConfig: { enabled: true } }),
        makeRequest('direct')
      )
    ).toBe(false);
  });

  it('keeps native tv clients direct unless explicitly opted in', () => {
    expect(
      shouldUseServerSideEpisodeProxy(
        createAdminConfig({ AdFilterConfig: { enabled: true } }),
        makeRequest(undefined, { userAgent: 'OrionTV okhttp' })
      )
    ).toBe(false);

    expect(
      shouldUseServerSideEpisodeProxy(
        createAdminConfig({ AdFilterConfig: { enabled: true } }),
        makeRequest('server', {
          client: 'oriontv',
          userAgent: 'OrionTV okhttp',
        })
      )
    ).toBe(true);
  });
});

describe('rewriteEpisodesForAdFilter', () => {
  const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;

  afterEach(() => {
    mockedGetConfig.mockReset();
  });

  it('rewrites m3u8 episodes to the signed proxy url', async () => {
    mockedGetConfig.mockResolvedValue(
      createAdminConfig({
        AdFilterConfig: { enabled: true },
        SourceConfig: [],
      })
    );

    const result = await rewriteEpisodesForAdFilter(
      createResult({
        episodes: [
          'https://example.com/path/index.m3u8',
          'https://example.com/video.mp4',
        ],
      }),
      makeRequest()
    );

    expect(result?.episodes[0]).toContain('/api/proxy/m3u8-filter?');
    expect(result?.episodes[0]).toContain('source=demo');
    expect(result?.episodes[1]).toBe('https://example.com/video.mp4');
  });

  it('skips rewriting when the source is marked as ad-filter disabled', async () => {
    mockedGetConfig.mockResolvedValue(
      createAdminConfig({
        AdFilterConfig: { enabled: true },
        SourceConfig: [
          {
            key: 'demo',
            name: 'Demo',
            api: 'https://example.com/api.php',
            from: 'custom',
            disable_ad_filter: true,
          },
        ],
      })
    );

    const result = await rewriteEpisodesForAdFilter(
      createResult(),
      makeRequest()
    );

    expect(result?.episodes[0]).toBe('https://example.com/path/index.m3u8');
  });
});
