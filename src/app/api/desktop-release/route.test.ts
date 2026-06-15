jest.mock('@/lib/client-download', () => ({
  buildSignedDesktopDownloadPath: jest.fn(),
  fetchLatestDesktopRelease: jest.fn(),
  getDesktopReleaseConfig: jest.fn(),
  listDesktopReleaseAssets: jest.fn(),
}));

import {
  buildSignedDesktopDownloadPath,
  fetchLatestDesktopRelease,
  getDesktopReleaseConfig,
  listDesktopReleaseAssets,
} from '@/lib/client-download';

import { GET } from './route';

describe('/api/desktop-release', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getDesktopReleaseConfig as jest.Mock).mockReturnValue({
      repo: 'demo/LunaTV',
      targetCommitish: 'desktop',
    });
    (fetchLatestDesktopRelease as jest.Mock).mockResolvedValue({
      created_at: '2026-06-15T00:00:00.000Z',
      id: 39,
      name: 'Desktop Internal #39',
      published_at: '2026-06-15T00:00:00.000Z',
      tag_name: 'desktop-v0.1.0',
    });
    (listDesktopReleaseAssets as jest.Mock).mockReturnValue({
      assets: [
        {
          asset: {
            id: 401,
            name: 'LunaTV-aarch64.dmg',
            size: 123,
          },
          key: 'mac-arm64',
          label: 'macOS Apple Silicon',
        },
      ],
      missingAssetKeys: ['mac-x64'],
    });
    (buildSignedDesktopDownloadPath as jest.Mock).mockReturnValue(
      '/api/client-download?kind=desktop&releaseId=39&assetId=401&expires=1&sig=demo'
    );
  });

  it('returns signed desktop assets with CDN cache headers', async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.assets[0]).toMatchObject({
      downloadPath:
        '/api/client-download?kind=desktop&releaseId=39&assetId=401&expires=1&sig=demo',
      key: 'mac-arm64',
      name: 'LunaTV-aarch64.dmg',
    });
    expect(payload.missingAssetKeys).toEqual(['mac-x64']);
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe(
      'public, s-maxage=300'
    );
  });

  it('returns 503 when no matching release is available', async () => {
    (fetchLatestDesktopRelease as jest.Mock).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Desktop release is temporarily unavailable',
    });
  });
});
