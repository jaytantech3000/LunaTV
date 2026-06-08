import {
  createLiveProxyHeaders,
  rewriteLiveManifestContent,
} from './live-proxy';

describe('live proxy core', () => {
  it('rewrites stream, key and segment urls through the live proxy layer', () => {
    const manifest = `#EXTM3U
#EXT-X-MAP:URI="init.mp4"
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXT-X-STREAM-INF:BANDWIDTH=1280000
variant.m3u8
segment-0001.ts`;

    const rewritten = rewriteLiveManifestContent(
      manifest,
      'https://example.com/live/index.m3u8',
      {
        sourceKey: 'demo',
      }
    );

    expect(rewritten).toContain('/api/proxy/segment?');
    expect(rewritten).toContain('/api/proxy/key?');
    expect(rewritten).toContain('/api/proxy/m3u8?');
    expect(rewritten).toContain('moontv-source=demo');
  });

  it('keeps bare segment urls direct when allowCORS is enabled', () => {
    const rewritten = rewriteLiveManifestContent(
      '#EXTM3U\nsegment-0001.ts',
      'https://example.com/live/index.m3u8',
      {
        sourceKey: 'demo',
        allowCORS: true,
      }
    );

    expect(rewritten.trim()).toBe(
      '#EXTM3U\nhttps://example.com/live/segment-0001.ts'
    );
  });

  it('preserves upstream range headers and explicit content length', () => {
    const upstreamHeaders = new Map<string, string>([
      ['content-type', 'application/vnd.apple.mpegurl'],
      ['content-length', '10'],
      ['accept-ranges', 'bytes'],
      ['content-range', 'bytes 0-9/10'],
    ]);
    const upstreamResponse = {
      headers: {
        get(name: string) {
          return upstreamHeaders.get(name.toLowerCase()) || null;
        },
      },
    } as Response;

    const headers = createLiveProxyHeaders(
      upstreamResponse,
      'application/vnd.apple.mpegurl',
      {
        contentLength: '42',
      }
    );

    expect(headers.get('Content-Length')).toBe('42');
    expect(headers.get('Accept-Ranges')).toBe('bytes');
    expect(headers.get('Content-Range')).toBe('bytes 0-9/10');
  });
});
