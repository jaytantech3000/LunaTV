jest.mock('./cache', () => ({
  putDownloadResponse: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./desktop-runtime', () => ({
  isDesktopLocalDownloadRuntimeEnabled: jest.fn(),
  resolveDesktopDownloadManifest: jest.fn(),
}));

import {
  isDesktopLocalDownloadRuntimeEnabled,
  resolveDesktopDownloadManifest,
} from './desktop-runtime';
import { parseManifestForDownloadWithFallback } from './manifest';
import type { ManifestParseResult } from './types';

describe('parseManifestForDownloadWithFallback desktop runtime delegation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as unknown as jest.Mock | undefined)?.mockReset?.();
    global.fetch = jest.fn() as typeof fetch;
    jest.mocked(isDesktopLocalDownloadRuntimeEnabled).mockReturnValue(true);
  });

  it('delegates manifest resolution to the desktop runtime when available', async () => {
    const manifestResult: ManifestParseResult = {
      rootManifestUrl:
        '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Froot.m3u8',
      playbackManifestUrl:
        'http://127.0.0.1:8787/media/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Fplayback.m3u8',
      resources: [
        {
          type: 'manifest',
          url: '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Froot.m3u8',
        },
      ],
      resourceUrls: [
        '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Froot.m3u8',
      ],
      isMasterPlaylist: false,
    };

    jest
      .mocked(resolveDesktopDownloadManifest)
      .mockResolvedValue(manifestResult);

    await expect(
      parseManifestForDownloadWithFallback([
        '   ',
        '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Froot.m3u8',
        '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Froot.m3u8',
      ])
    ).resolves.toEqual(manifestResult);

    expect(resolveDesktopDownloadManifest).toHaveBeenCalledWith(
      [
        '/api/proxy/vod/m3u8?source=demo&url=https%3A%2F%2Fcdn.example.com%2Froot.m3u8',
      ],
      {
        signal: undefined,
      }
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
