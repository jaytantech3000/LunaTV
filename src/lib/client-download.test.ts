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

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete mutableEnv[key];
    return;
  }

  mutableEnv[key] = value;
}

describe('client-download helpers', () => {
  const originalEnv = {
    CF_PAGES_BRANCH: mutableEnv.CF_PAGES_BRANCH,
    CLIENT_DOWNLOAD_SIGNING_SECRET: mutableEnv.CLIENT_DOWNLOAD_SIGNING_SECRET,
    DESKTOP_RELEASE_REPO: mutableEnv.DESKTOP_RELEASE_REPO,
    GITHUB_REF_NAME: mutableEnv.GITHUB_REF_NAME,
    LOCAL_SERVICE_RELEASE_REPO: mutableEnv.LOCAL_SERVICE_RELEASE_REPO,
    LOCAL_SERVICE_RELEASE_CHANNEL: mutableEnv.LOCAL_SERVICE_RELEASE_CHANNEL,
    LOCAL_SERVICE_RELEASE_TAG: mutableEnv.LOCAL_SERVICE_RELEASE_TAG,
    LOCAL_SERVICE_RELEASE_URL_MAC_ARM64:
      mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64,
    RAILWAY_GIT_BRANCH: mutableEnv.RAILWAY_GIT_BRANCH,
    VERCEL_GIT_COMMIT_REF: mutableEnv.VERCEL_GIT_COMMIT_REF,
  };

  afterEach(() => {
    restoreEnvValue('CF_PAGES_BRANCH', originalEnv.CF_PAGES_BRANCH);
    restoreEnvValue(
      'CLIENT_DOWNLOAD_SIGNING_SECRET',
      originalEnv.CLIENT_DOWNLOAD_SIGNING_SECRET
    );
    restoreEnvValue('DESKTOP_RELEASE_REPO', originalEnv.DESKTOP_RELEASE_REPO);
    restoreEnvValue('GITHUB_REF_NAME', originalEnv.GITHUB_REF_NAME);
    restoreEnvValue(
      'LOCAL_SERVICE_RELEASE_REPO',
      originalEnv.LOCAL_SERVICE_RELEASE_REPO
    );
    restoreEnvValue(
      'LOCAL_SERVICE_RELEASE_CHANNEL',
      originalEnv.LOCAL_SERVICE_RELEASE_CHANNEL
    );
    restoreEnvValue(
      'LOCAL_SERVICE_RELEASE_TAG',
      originalEnv.LOCAL_SERVICE_RELEASE_TAG
    );
    restoreEnvValue(
      'LOCAL_SERVICE_RELEASE_URL_MAC_ARM64',
      originalEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64
    );
    restoreEnvValue('RAILWAY_GIT_BRANCH', originalEnv.RAILWAY_GIT_BRANCH);
    restoreEnvValue('VERCEL_GIT_COMMIT_REF', originalEnv.VERCEL_GIT_COMMIT_REF);
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
      }
    );

    expect(release?.id).toBe(2);
  });

  it('can further narrow releases with an explicit target commitish filter', () => {
    const release = selectLatestDesktopRelease(
      [
        {
          assets: [],
          id: 1,
          prerelease: true,
          published_at: '2026-06-11T00:00:00.000Z',
          tag_name: 'desktop-v0.2.0',
          target_commitish: 'desktop-sha-a',
        },
        {
          assets: [],
          id: 2,
          prerelease: true,
          published_at: '2026-06-12T00:00:00.000Z',
          tag_name: 'desktop-v0.3.0',
          target_commitish: 'desktop-sha-b',
        },
      ],
      {
        repo: 'demo/LunaTV',
        tagPrefix: 'desktop-v',
        targetCommitish: 'desktop-sha-a',
      }
    );

    expect(release?.id).toBe(1);
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
    delete mutableEnv.LOCAL_SERVICE_RELEASE_REPO;
    delete mutableEnv.DESKTOP_RELEASE_REPO;

    expect(resolveLocalServiceBinaryUrl('mac-arm64')).toBe(
      'https://example.com/lunatv-server'
    );
    expect(resolveLocalServiceBinaryUrl('mac-x64')).toBeNull();
  });

  it('derives stable GitHub release urls for local service binaries', () => {
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64;
    mutableEnv.DESKTOP_RELEASE_REPO = 'demo/LunaTV';
    mutableEnv.LOCAL_SERVICE_RELEASE_TAG = 'local-service-latest';

    expect(resolveLocalServiceBinaryUrl('mac-arm64')).toBe(
      'https://github.com/demo/LunaTV/releases/download/local-service-latest/lunatv-server-mac-arm64'
    );
    expect(resolveLocalServiceBinaryUrl('win-x64')).toBe(
      'https://github.com/demo/LunaTV/releases/download/local-service-latest/lunatv-server-win-x64.exe'
    );
  });

  it('prefers an explicit local service release repo when provided', () => {
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64;
    mutableEnv.DESKTOP_RELEASE_REPO = 'demo/LunaTV';
    mutableEnv.LOCAL_SERVICE_RELEASE_REPO = 'mirror/LunaTV-binaries';
    mutableEnv.LOCAL_SERVICE_RELEASE_TAG = 'local-service-v1';

    expect(resolveLocalServiceBinaryUrl('linux-x64')).toBe(
      'https://github.com/mirror/LunaTV-binaries/releases/download/local-service-v1/lunatv-server-linux-x64'
    );
  });

  it('auto-selects nova local service latest tag from the deployment branch', () => {
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_TAG;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_CHANNEL;
    mutableEnv.DESKTOP_RELEASE_REPO = 'demo/LunaTV';
    mutableEnv.VERCEL_GIT_COMMIT_REF = 'nova';

    expect(resolveLocalServiceBinaryUrl('mac-x64')).toBe(
      'https://github.com/demo/LunaTV/releases/download/local-service-nova-latest/lunatv-server-mac-x64'
    );
  });

  it('allows explicit local service channel override when the deployment branch is unavailable', () => {
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_TAG;
    delete mutableEnv.VERCEL_GIT_COMMIT_REF;
    mutableEnv.DESKTOP_RELEASE_REPO = 'demo/LunaTV';
    mutableEnv.LOCAL_SERVICE_RELEASE_CHANNEL = 'luna';

    expect(resolveLocalServiceBinaryUrl('linux-arm64')).toBe(
      'https://github.com/demo/LunaTV/releases/download/local-service-luna-latest/lunatv-server-linux-arm64'
    );
  });
});
