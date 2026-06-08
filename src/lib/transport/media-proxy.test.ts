import {
  buildLiveLogoProxyUrl,
  buildVodProxyM3u8MediaUrl,
  getMediaProxyBaseUrl,
} from './media-proxy';

describe('transport media proxy helpers', () => {
  const originalApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalMediaProxyBaseUrl =
    process.env.NEXT_PUBLIC_MEDIA_PROXY_BASE_URL;
  const originalRuntimeConfig = window.RUNTIME_CONFIG;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    delete process.env.NEXT_PUBLIC_MEDIA_PROXY_BASE_URL;
    delete window.RUNTIME_CONFIG;
  });

  afterAll(() => {
    if (originalApiBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBaseUrl;
    }

    if (originalMediaProxyBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_MEDIA_PROXY_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_MEDIA_PROXY_BASE_URL = originalMediaProxyBaseUrl;
    }

    if (originalRuntimeConfig === undefined) {
      delete window.RUNTIME_CONFIG;
    } else {
      window.RUNTIME_CONFIG = originalRuntimeConfig;
    }
  });

  it('prefers the runtime media proxy base over the api base', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://env.example:7001/';
    window.RUNTIME_CONFIG = {
      MEDIA_PROXY_BASE_URL: 'http://127.0.0.1:8788/',
    };

    expect(getMediaProxyBaseUrl()).toBe('http://127.0.0.1:8788');
    expect(
      buildVodProxyM3u8MediaUrl({
        source: 'demo',
        url: 'https://example.com/path/index.m3u8',
      })
    ).toBe(
      'http://127.0.0.1:8788/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fpath%2Findex.m3u8'
    );
  });

  it('builds live logo urls with the moontv-source parameter', () => {
    const proxiedUrl = buildLiveLogoProxyUrl({
      url: 'https://example.com/logo.png',
      sourceKey: 'demo',
    });

    expect(proxiedUrl).toContain('/api/proxy/logo?');
    expect(proxiedUrl).toContain('moontv-source=demo');
    expect(proxiedUrl).not.toContain('&source=demo');
    expect(proxiedUrl).not.toContain('?source=demo');
  });
});
