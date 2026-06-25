import {
  normalizeVodEpisodeUrl,
  normalizeVodEpisodeUrlForDownload,
} from './normalize';
import {
  buildDownloadVodProxyM3u8Url,
  buildVodProxyKeyUrl,
  buildVodProxyM3u8Url,
  buildVodProxySegmentUrl,
  getVodProxyAssetKind,
  isVodProxyUrl,
  looksLikeManifestUrl,
  normalizeVodProxyUrlForDesktopDownload,
} from './proxy-url';

describe('download proxy url helpers', () => {
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

    const proxiedUrl =
      '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Findex.m3u8';
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

  it('builds download manifest urls through the shared VOD proxy', () => {
    expect(
      buildDownloadVodProxyM3u8Url({
        source: 'demo',
        url: 'https://example.com/video/master.m3u8',
      })
    ).toBe(
      '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8'
    );
  });

  it('keeps absolute proxy manifest urls stable for download normalization', () => {
    expect(
      normalizeVodProxyUrlForDesktopDownload(
        'http://127.0.0.1:8787/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8'
      )
    ).toBe(
      'http://127.0.0.1:8787/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8'
    );
  });

  it('keeps proxied playback urls stable for download normalization', () => {
    expect(
      normalizeVodEpisodeUrlForDownload(
        'demo',
        'http://127.0.0.1:8787/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8'
      )
    ).toBe(
      'http://127.0.0.1:8787/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8'
    );
  });
});
