jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

import { getConfig } from '@/lib/config';
import { SearchResult } from '@/lib/types';

import {
  rewriteEpisodesForAdFilter,
  shouldUseServerSideEpisodeProxy,
} from './episode-rewriter';

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

  return {
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

    expect(
      shouldUseServerSideEpisodeProxy(null as any, makeRequest() as any)
    ).toBe(true);
  });

  it('allows legacy env to disable server-side filtering', () => {
    process.env.ENABLE_AD_FILTER = 'false';

    expect(
      shouldUseServerSideEpisodeProxy(null as any, makeRequest() as any)
    ).toBe(false);
  });

  it('lets explicit proxy env override admin defaults', () => {
    process.env.M3U8_SERVER_PROXY = 'false';

    expect(
      shouldUseServerSideEpisodeProxy(
        { AdFilterConfig: { enabled: true } } as any,
        makeRequest() as any
      )
    ).toBe(false);
  });

  it('lets the request force proxy or direct mode', () => {
    expect(
      shouldUseServerSideEpisodeProxy(null as any, makeRequest('server') as any)
    ).toBe(true);
    expect(
      shouldUseServerSideEpisodeProxy(
        { AdFilterConfig: { enabled: true } } as any,
        makeRequest('direct') as any
      )
    ).toBe(false);
  });

  it('keeps native tv clients direct unless explicitly opted in', () => {
    expect(
      shouldUseServerSideEpisodeProxy(
        { AdFilterConfig: { enabled: true } } as any,
        makeRequest(undefined, { userAgent: 'OrionTV okhttp' }) as any
      )
    ).toBe(false);

    expect(
      shouldUseServerSideEpisodeProxy(
        { AdFilterConfig: { enabled: true } } as any,
        makeRequest('server', {
          client: 'oriontv',
          userAgent: 'OrionTV okhttp',
        }) as any
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
    mockedGetConfig.mockResolvedValue({
      AdFilterConfig: { enabled: true },
      SourceConfig: [],
    } as any);

    const result = await rewriteEpisodesForAdFilter(
      createResult({
        episodes: [
          'https://example.com/path/index.m3u8',
          'https://example.com/video.mp4',
        ],
      }),
      makeRequest() as any
    );

    expect(result?.episodes[0]).toContain('/api/proxy/m3u8-filter?');
    expect(result?.episodes[0]).toContain('source=demo');
    expect(result?.episodes[1]).toBe('https://example.com/video.mp4');
  });

  it('skips rewriting when the source is marked as ad-filter disabled', async () => {
    mockedGetConfig.mockResolvedValue({
      AdFilterConfig: { enabled: true },
      SourceConfig: [{ key: 'demo', disable_ad_filter: true }],
    } as any);

    const result = await rewriteEpisodesForAdFilter(
      createResult(),
      makeRequest() as any
    );

    expect(result?.episodes[0]).toBe('https://example.com/path/index.m3u8');
  });
});
