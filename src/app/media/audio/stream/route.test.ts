import { NextRequest } from 'next/server';

import { GET } from './route';

describe('/media/audio/stream', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    jest.clearAllMocks();
  });

  it('resolves netease redirects and preserves range requests', async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://music.163.com';

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: {
            location: 'https://cdn.example.com/audio.mp3',
          },
          status: 302,
        })
      )
      .mockResolvedValueOnce(
        new Response('BCD', {
          headers: {
            'accept-ranges': 'bytes',
            'content-length': '3',
            'content-range': 'bytes 1-3/6',
            'content-type': 'audio/mpeg',
          },
          status: 206,
        })
      );

    global.fetch = fetchMock as jest.MockedFunction<typeof fetch>;

    const request = new NextRequest(
      'http://localhost/media/audio/stream?source=netease&id=9001',
      {
        headers: {
          range: 'bytes=1-3',
        },
      }
    );

    const response = await GET(request);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/song/media/outer/url?id=9001.mp3'
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://cdn.example.com/audio.mp3',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({
          Range: 'bytes=1-3',
        }),
      })
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Content-Range')).toBe('bytes 1-3/6');
    await expect(response.text()).resolves.toBe('BCD');
  });
});
