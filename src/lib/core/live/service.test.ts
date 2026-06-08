import {
  getLiveChannels,
  getLiveEpg,
  getLiveSources,
  precheckLiveStream,
} from './service';

import { getConfig } from '@/lib/config';
import { getCachedLiveChannels } from '@/lib/live';

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

jest.mock('@/lib/live', () => ({
  getCachedLiveChannels: jest.fn(),
}));

describe('live service', () => {
  const mockedGetConfig = getConfig as jest.Mock;
  const mockedGetCachedLiveChannels = getCachedLiveChannels as jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockedGetConfig.mockResolvedValue({
      LiveConfig: [
        {
          key: 'news',
          name: 'News',
          url: 'https://news.example/live.m3u',
          ua: 'Custom UA',
          from: 'config',
          disabled: false,
          channelNumber: 2,
        },
        {
          key: 'disabled',
          name: 'Disabled',
          url: 'https://disabled.example/live.m3u',
          from: 'config',
          disabled: true,
        },
      ],
    });
    mockedGetCachedLiveChannels.mockResolvedValue({
      channelNumber: 2,
      channels: [
        {
          id: 'news-0',
          tvgId: 'cctv1',
          name: 'CCTV-1',
          logo: '',
          group: '央视频道',
          url: 'https://stream.example/cctv1.m3u8',
        },
      ],
      epgUrl: 'https://epg.example/guide.xml',
      epgs: {
        cctv1: [
          {
            start: '20260608080000 +0800',
            end: '20260608090000 +0800',
            title: '朝闻天下',
          },
        ],
      },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  it('returns enabled live sources only', async () => {
    await expect(getLiveSources()).resolves.toEqual([
      expect.objectContaining({
        key: 'news',
      }),
    ]);
  });

  it('reads channels and epg from cached live data', async () => {
    await expect(getLiveChannels('news')).resolves.toEqual([
      expect.objectContaining({
        id: 'news-0',
        tvgId: 'cctv1',
      }),
    ]);

    await expect(getLiveEpg('news', 'cctv1')).resolves.toEqual({
      tvgId: 'cctv1',
      source: 'news',
      epgUrl: 'https://epg.example/guide.xml',
      programs: [
        {
          start: '20260608080000 +0800',
          end: '20260608090000 +0800',
          title: '朝闻天下',
        },
      ],
    });
  });

  it('returns empty epg data when cached channels are missing', async () => {
    mockedGetCachedLiveChannels.mockResolvedValueOnce(null);

    await expect(getLiveEpg('news', 'missing')).resolves.toEqual({
      tvgId: 'missing',
      source: 'news',
      epgUrl: '',
      programs: [],
    });
  });

  it('prechecks live streams with the source user agent and classifies content type', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (header: string) =>
          header === 'Content-Type' ? 'video/mp4' : null,
      },
      body: {
        cancel: jest.fn(),
      },
    }) as typeof fetch;

    await expect(
      precheckLiveStream({
        url: encodeURIComponent('https://stream.example/live.m3u8'),
        sourceKey: 'news',
      })
    ).resolves.toEqual({
      type: 'mp4',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://stream.example/live.m3u8',
      expect.objectContaining({
        headers: {
          'User-Agent': 'Custom UA',
        },
      })
    );
  });

  it('raises service errors for invalid live lookups', async () => {
    mockedGetCachedLiveChannels.mockResolvedValueOnce(null);

    await expect(getLiveChannels('news')).rejects.toMatchObject({
      message: '频道信息未找到',
      status: 404,
    });

    await expect(
      precheckLiveStream({
        url: encodeURIComponent('https://stream.example/live.m3u8'),
        sourceKey: 'missing',
      })
    ).rejects.toMatchObject({
      message: 'Source not found',
      status: 404,
    });
  });
});
