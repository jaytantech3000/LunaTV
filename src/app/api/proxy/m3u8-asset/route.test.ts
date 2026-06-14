jest.mock('@/lib/download/vod-proxy', () => ({
  resolveVodProxyRequest: jest.fn(),
}));

jest.mock('@/lib/m3u8-proxy', () => ({
  verifyM3U8ProxySignature: jest.fn(),
}));

jest.mock('@/lib/proxy-security', () => ({
  fetchWithValidatedRedirects: jest.fn(),
  normalizeHeaderUrl: jest.fn((value: string | null | undefined) => value),
  validateProxyTargetUrl: jest.fn(),
}));

import { NextRequest } from 'next/server';

import { resolveVodProxyRequest } from '@/lib/download/vod-proxy';
import { verifyM3U8ProxySignature } from '@/lib/m3u8-proxy';
import {
  fetchWithValidatedRedirects,
  validateProxyTargetUrl,
} from '@/lib/proxy-security';

import { GET } from './route';

describe('/api/proxy/m3u8-asset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (verifyM3U8ProxySignature as jest.Mock).mockReturnValue(true);
    (validateProxyTargetUrl as jest.Mock).mockResolvedValue(
      'https://example.com/key.bin'
    );
    (resolveVodProxyRequest as jest.Mock).mockResolvedValue({
      apiSite: {
        referer: 'https://upstream.example/',
        ua: 'test-agent',
      },
    });
    (fetchWithValidatedRedirects as jest.Mock).mockResolvedValue(
      new Response('demo-key', {
        headers: {
          'content-type': 'application/octet-stream',
        },
        status: 200,
      })
    );
  });

  it('streams key assets directly while keeping the longer key timeout', async () => {
    const request = new NextRequest(
      'http://localhost/api/proxy/m3u8-asset?source=demo&url=https%3A%2F%2Fexample.com%2Fkey.bin&kind=key&sig=demo&referer=https%3A%2F%2Fplayer.example%2F'
    );

    const response = await GET(request);

    expect(fetchWithValidatedRedirects).toHaveBeenCalledWith(
      'https://example.com/key.bin',
      expect.objectContaining({
        method: 'GET',
      }),
      expect.objectContaining({
        initialUrlValidated: true,
        responseMode: 'stream',
        timeoutMs: 25000,
      })
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('demo-key');
  });

  it('omits upstream content length when the response body was content-encoded', async () => {
    (fetchWithValidatedRedirects as jest.Mock).mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3, 4]), {
        headers: {
          'content-encoding': 'gzip',
          'content-length': '41',
          'content-type': 'application/octet-stream',
        },
        status: 200,
      })
    );

    const request = new NextRequest(
      'http://localhost/api/proxy/m3u8-asset?source=demo&url=https%3A%2F%2Fexample.com%2Fkey.bin&kind=key&sig=demo&referer=https%3A%2F%2Fplayer.example%2F'
    );

    const response = await GET(request);

    expect(response.headers.get('Content-Length')).toBeNull();
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      1, 2, 3, 4,
    ]);
  });
});
