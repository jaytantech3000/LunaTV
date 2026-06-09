import {
  normalizeVodEpisodeUrl,
  normalizeVodEpisodeUrlForDownload,
} from './normalize';
import {
  buildDownloadVodProxyM3u8Url,
  normalizeVodProxyUrlForDesktopDownload,
  buildVodProxyKeyUrl,
  buildVodProxyM3u8Url,
  buildVodProxySegmentUrl,
  getVodProxyAssetKind,
  isVodProxyUrl,
  looksLikeManifestUrl,
} from './proxy-url';

describe('download proxy url helpers', () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDesktopDownloadSameOriginProxy =
    process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY;
  const originalRuntimeConfig = window.RUNTIME_CONFIG;

  beforeEach(() => {
    mutableEnv.NODE_ENV = 'test';
    delete mutableEnv.NEXT_PUBLIC_DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY;
    delete window.RUNTIME_CONFIG;
  });

  afterAll(() => {
    mutableEnv.NODE_ENV = originalNodeEnv;

    if (originalDesktopDownloadSameOriginProxy === undefined) {
      delete mutableEnv.NEXT_PUBLIC_DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY;
    } else {
      mutableEnv.NEXT_PUBLIC_DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY =
        originalDesktopDownloadSameOriginProxy;
    }

    if (originalRuntimeConfig === undefined) {
      delete window.RUNTIME_CONFIG;
    } else {
      window.RUNTIME_CONFIG = originalRuntimeConfig;
    }
  });

  it('builds proxy urls for manifests, segments and keys', () => {
    expect(
      buildVodProxyM3u8Url({
        source: 'demo',
        url: 'https://example.com/path/index.m3u8?token=abc',
      })
    ).toContain('/api/proxy/vod/m3u8?');

    expect(
      buildVodProxySegmentUrl({
        source: 'demo',
        url: 'https://example.com/path/001.ts',
      })
    ).toContain('/api/proxy/vod/segment?');

    expect(
      buildVodProxyKeyUrl({
        source: 'demo',
        url: 'https://example.com/path/key.bin',
      })
    ).toContain('/api/proxy/vod/key?');
  });

  it('recognizes manifest urls and keeps proxied urls stable', () => {
    expect(looksLikeManifestUrl('https://example.com/video/index.m3u8')).toBe(
      true
    );
    expect(getVodProxyAssetKind('https://example.com/video/index.m3u8')).toBe(
      'm3u8'
    );

    const proxiedUrl = '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Findex.m3u8';
    expect(isVodProxyUrl(proxiedUrl)).toBe(true);
    expect(looksLikeManifestUrl(proxiedUrl)).toBe(true);
    expect(getVodProxyAssetKind(proxiedUrl)).toBe('m3u8');
    expect(normalizeVodEpisodeUrl('demo', proxiedUrl)).toBe(proxiedUrl);
  });

  it('normalizes upstream manifest urls to same-origin proxy urls', () => {
    const normalizedUrl = normalizeVodEpisodeUrl(
      'demo',
      'https://example.com/video/master.m3u8'
    );

    expect(normalizedUrl).toContain('/api/proxy/vod/m3u8?');
    expect(normalizedUrl).toContain('source=demo');
  });

  it('builds same-origin download manifest urls in desktop dev mode', () => {
    mutableEnv.NODE_ENV = 'development';
    mutableEnv.NEXT_PUBLIC_DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY = 'true';
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };

    expect(
      buildDownloadVodProxyM3u8Url({
        source: 'demo',
        url: 'https://example.com/video/master.m3u8',
      })
    ).toBe(
      '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8'
    );
  });

  it('rewrites absolute proxy manifest urls to same-origin urls in desktop dev mode', () => {
    mutableEnv.NODE_ENV = 'development';
    mutableEnv.NEXT_PUBLIC_DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY = 'true';
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };

    expect(
      normalizeVodProxyUrlForDesktopDownload(
        'http://127.0.0.1:8787/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8'
      )
    ).toBe(
      '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8'
    );
  });

  it('normalizes proxied playback urls for download in desktop dev mode', () => {
    mutableEnv.NODE_ENV = 'development';
    mutableEnv.NEXT_PUBLIC_DESKTOP_DOWNLOAD_SAME_ORIGIN_PROXY = 'true';
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };

    expect(
      normalizeVodEpisodeUrlForDownload(
        'demo',
        'http://127.0.0.1:8787/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8'
      )
    ).toBe(
      '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8'
    );
  });
});
