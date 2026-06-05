jest.mock('./cache', () => ({
  putDownloadResponse: jest.fn().mockResolvedValue(undefined),
}));

import {
  collectMediaPlaylistResources,
  isMasterPlaylist,
  parseManifestForDownloadWithFallback,
  selectPlaybackManifestUrl,
} from './manifest';

function createManifestResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    clone() {
      return createManifestResponse(body);
    },
    text: async () => body,
  } as unknown as Response;
}

describe('manifest parsing helpers', () => {
  it('detects master playlists and selects the highest bandwidth variant', () => {
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2F720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2F1080.m3u8`;

    expect(isMasterPlaylist(manifest)).toBe(true);
    expect(selectPlaybackManifestUrl(manifest)).toContain('1080.m3u8');
  });

  it('collects media playlist resources including key and map', () => {
    const manifest = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-KEY:METHOD=AES-128,URI="/api/proxy/vod/key?source=demo&url=https%3A%2F%2Fexample.com%2Fkey.bin"
#EXT-X-MAP:URI="/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2Finit.mp4"
#EXTINF:4.0,
/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2F0001.ts
#EXTINF:4.0,
/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2F0002.ts`;

    expect(collectMediaPlaylistResources(manifest)).toEqual([
      {
        type: 'key',
        url: '/api/proxy/vod/key?source=demo&url=https%3A%2F%2Fexample.com%2Fkey.bin',
      },
      {
        type: 'map',
        url: '/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2Finit.mp4',
      },
      {
        type: 'segment',
        url: '/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2F0001.ts',
      },
      {
        type: 'segment',
        url: '/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2F0002.ts',
      },
    ]);
  });

  it('collects ll-hls part, preload and rendition resources', () => {
    const manifest = `#EXTM3U
#EXT-X-PART:DURATION=0.333,URI="/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2Fpart-0001.ts"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2Fpart-0002.ts"
#EXT-X-RENDITION-REPORT:URI="/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Faudio.m3u8",LAST-MSN=12
#EXTINF:4.0,
/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2F0001.ts`;

    expect(collectMediaPlaylistResources(manifest)).toEqual([
      {
        type: 'segment',
        url: '/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2Fpart-0001.ts',
      },
      {
        type: 'segment',
        url: '/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2Fpart-0002.ts',
      },
      {
        type: 'manifest',
        url: '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Faudio.m3u8',
      },
      {
        type: 'segment',
        url: '/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2F0001.ts',
      },
    ]);
  });

  it('rejects unsupported DRM methods', () => {
    expect(() =>
      collectMediaPlaylistResources(
        `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="https://example.com/key"`
      )
    ).toThrow('暂不支持 DRM/HLS 加密方式: SAMPLE-AES');
  });

  it('falls back to the next entry manifest when the first candidate fails', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
      })
      .mockResolvedValueOnce(
        createManifestResponse(
          `#EXTM3U
#EXTINF:4.0,
/api/proxy/vod/segment?source=demo&url=https%3A%2F%2Fexample.com%2F0001.ts`
        )
      );

    global.fetch = fetchMock as typeof fetch;

    try {
      const result = await parseManifestForDownloadWithFallback([
        '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fblocked.m3u8',
        '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fexample.com%2Fplayable.m3u8',
      ]);

      expect(result.rootManifestUrl).toContain('playable.m3u8');
      expect(result.playbackManifestUrl).toContain('playable.m3u8');
      expect(result.resources).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
