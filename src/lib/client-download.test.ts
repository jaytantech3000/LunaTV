import {
  buildSignedDesktopDownloadPath,
  getDesktopAssetKeyForName,
  listDesktopReleaseAssets,
  resolveLocalServiceBinaryUrl,
  selectLatestDesktopRelease,
  signDesktopDownload,
  verifySignedDesktopDownload,
} from './client-download';

const mutableEnv = process.env as Record<string, string | undefined>;

describe('client-download helpers', () => {
  const originalEnv = {
    CLIENT_DOWNLOAD_SIGNING_SECRET: mutableEnv.CLIENT_DOWNLOAD_SIGNING_SECRET,
    LOCAL_SERVICE_RELEASE_URL_MAC_ARM64:
      mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64,
  };

  afterEach(() => {
    mutableEnv.CLIENT_DOWNLOAD_SIGNING_SECRET =
      originalEnv.CLIENT_DOWNLOAD_SIGNING_SECRET;
    mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64 =
      originalEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64;
  });

  it('selects the newest prerelease that matches the desktop release line', () => {
    const release = selectLatestDesktopRelease(
      [
        {
          assets: [],
          id: 1,
          prerelease: true,
          published_at: '2026-06-10T00:00:00.000Z',
          tag_name: 'desktop-v0.1.0',
          target_commitish: 'desktop',
        },
        {
          assets: [],
          id: 2,
          prerelease: true,
          published_at: '2026-06-11T00:00:00.000Z',
          tag_name: 'desktop-v0.2.0',
          target_commitish: 'desktop',
        },
        {
          assets: [],
          id: 3,
          prerelease: true,
          published_at: '2026-06-12T00:00:00.000Z',
          tag_name: 'web-v0.3.0',
          target_commitish: 'main',
        },
      ],
      {
        repo: 'demo/LunaTV',
        tagPrefix: 'desktop-v',
        targetCommitish: 'desktop',
      }
    );

    expect(release?.id).toBe(2);
  });

  it('maps desktop assets and reports missing required targets', () => {
    const { assets, missingAssetKeys } = listDesktopReleaseAssets({
      assets: [
        {
          browser_download_url: 'https://example.com/LunaTV-aarch64.dmg',
          id: 11,
          name: 'LunaTV-aarch64.dmg',
          size: 10,
        },
        {
          browser_download_url: 'https://example.com/LunaTV-x64-setup.exe',
          id: 12,
          name: 'LunaTV-x64-setup.exe',
          size: 12,
        },
      ],
      id: 1,
      prerelease: true,
      tag_name: 'desktop-v0.1.0',
      target_commitish: 'desktop',
    });

    expect(assets.map((entry) => entry.key)).toEqual([
      'mac-arm64',
      'win-x64-setup',
    ]);
    expect(missingAssetKeys).toEqual(['mac-x64', 'win-x64-portable']);
    expect(getDesktopAssetKeyForName('LunaTV-portable.zip')).toBe(
      'win-x64-portable'
    );
  });

  it('signs and verifies desktop download tokens', () => {
    mutableEnv.CLIENT_DOWNLOAD_SIGNING_SECRET = 'test-secret';

    const signature = signDesktopDownload({
      assetId: 200,
      expires: 123456789,
      releaseId: 100,
    });

    expect(signature).toBeTruthy();
    expect(
      verifySignedDesktopDownload({
        assetId: 200,
        expires: 123456789,
        releaseId: 100,
        signature,
      })
    ).toBe(true);
    expect(
      verifySignedDesktopDownload({
        assetId: 201,
        expires: 123456789,
        releaseId: 100,
        signature,
      })
    ).toBe(false);

    const downloadPath = buildSignedDesktopDownloadPath({
      assetId: 200,
      expires: 123456789,
      releaseId: 100,
    });
    expect(downloadPath).toContain('kind=desktop');
    expect(downloadPath).toContain('assetId=200');
  });

  it('reads local service platform mappings from environment variables', () => {
    mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64 =
      'https://example.com/lunatv-server';

    expect(resolveLocalServiceBinaryUrl('mac-arm64')).toBe(
      'https://example.com/lunatv-server'
    );
    expect(resolveLocalServiceBinaryUrl('mac-x64')).toBeNull();
  });
});
