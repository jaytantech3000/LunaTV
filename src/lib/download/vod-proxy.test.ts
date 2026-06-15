import { sanitizeVodManifestContent } from './sanitize-manifest';
import { createVodProxyHeaders, rewriteVodManifestContent } from './vod-proxy';

describe('sanitizeVodManifestContent', () => {
  it('strips unsupported adjump discontinuity blocks from manifests', () => {
    const content = `#EXTM3U
#EXT-X-VERSION:3
#EXTINF:1,
0000000.ts
#EXT-X-DISCONTINUITY
#EXTINF:3,
/video/adjump/time/17766952429940000000.ts
#EXTINF:3,
/video/adjump/time/17766952429940000001.ts
#EXT-X-DISCONTINUITY
#EXTINF:1,
0000001.ts
#EXT-X-ENDLIST`;

    const sanitizedContent = sanitizeVodManifestContent(content);

    expect(sanitizedContent).not.toContain('adjump');
    expect(sanitizedContent).toContain('0000000.ts');
    expect(sanitizedContent).toContain('0000001.ts');
    expect(sanitizedContent).not.toContain('#EXT-X-DISCONTINUITY');
  });

  it('strips unsupported ll-hls adjump uris', () => {
    const content = `#EXTM3U
#EXT-X-PART:DURATION=0.333,URI="/video/adjump/time/17766952429940000002.ts"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="/video/adjump/time/17766952429940000003.ts"
#EXT-X-MAP:URI="/video/adjump/time/init.mp4"
#EXTINF:1,
0000001.ts`;

    const sanitizedContent = sanitizeVodManifestContent(content);

    expect(sanitizedContent).not.toContain('adjump');
    expect(sanitizedContent).toContain('0000001.ts');
  });
});

describe('createVodProxyHeaders', () => {
  it('uses explicit content length for rewritten manifests', () => {
    const upstreamHeaders = new Map<string, string>([
      ['content-length', '18'],
      ['content-type', 'application/vnd.apple.mpegurl'],
    ]);
    const upstreamResponse = {
      headers: {
        get(name: string) {
          return upstreamHeaders.get(name.toLowerCase()) || null;
        },
      },
    } as Response;

    const headers = createVodProxyHeaders(
      upstreamResponse,
      'application/vnd.apple.mpegurl',
      {
        contentLength: '42',
      }
    );

    expect(headers.get('Content-Length')).toBe('42');
  });

  it('omits upstream content length when the body was content-encoded', () => {
    const upstreamHeaders = new Map<string, string>([
      ['content-encoding', 'gzip'],
      ['content-length', '41'],
      ['content-type', 'application/octet-stream'],
    ]);
    const upstreamResponse = {
      headers: {
        get(name: string) {
          return upstreamHeaders.get(name.toLowerCase()) || null;
        },
        has(name: string) {
          return upstreamHeaders.has(name.toLowerCase());
        },
      },
    } as Response;

    const headers = createVodProxyHeaders(upstreamResponse);

    expect(headers.get('Content-Length')).toBeNull();
  });
});

describe('rewriteVodManifestContent', () => {
  it('rewrites ll-hls attribute uris to proxy urls', () => {
    const manifest = `#EXTM3U
#EXT-X-PART:DURATION=0.333,URI="part-0001.ts"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="part-0002.ts"
#EXT-X-RENDITION-REPORT:URI="audio.m3u8",LAST-MSN=12
segment-0001.ts`;

    const rewritten = rewriteVodManifestContent(
      manifest,
      'https://example.com/path/index.m3u8',
      'demo'
    );

    expect(rewritten).toContain(
      'URI="/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2Fpath%2Fpart-0001.ts"'
    );
    expect(rewritten).toContain(
      'URI="/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2Fpath%2Fpart-0002.ts"'
    );
    expect(rewritten).toContain(
      'URI="/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fpath%2Faudio.m3u8"'
    );
    expect(rewritten).toContain(
      '/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2Fpath%2Fsegment-0001.ts'
    );
  });
});
