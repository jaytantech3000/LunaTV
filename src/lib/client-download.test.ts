import {
  buildSignedDesktopDownloadPath,
  fetchLatestDesktopRelease,
  fetchLocalServiceReleaseSummary,
  getDesktopAssetKeyForName,
  getDesktopReleaseConfig,
  isClientDownloadSigningEnabled,
  listDesktopReleaseAssets,
  resolveLocalServiceBinaryUrl,
  resolveLocalServiceInstallerUrl,
  selectLatestDesktopRelease,
  selectLatestVersionedLocalServiceRelease,
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
  const originalFetch = global.fetch;
  const originalEnv = {
    CF_PAGES_BRANCH: mutableEnv.CF_PAGES_BRANCH,
    CLIENT_DOWNLOAD_SIGNING_SECRET: mutableEnv.CLIENT_DOWNLOAD_SIGNING_SECRET,
    DESKTOP_RELEASE_REPO: mutableEnv.DESKTOP_RELEASE_REPO,
    DESKTOP_RELEASE_TAG_PREFIX: mutableEnv.DESKTOP_RELEASE_TAG_PREFIX,
    DESKTOP_RELEASE_TARGET_COMMITISH:
      mutableEnv.DESKTOP_RELEASE_TARGET_COMMITISH,
    GITHUB_REF_NAME: mutableEnv.GITHUB_REF_NAME,
    GITHUB_REPOSITORY: mutableEnv.GITHUB_REPOSITORY,
    LOCAL_SERVICE_RELEASE_REPO: mutableEnv.LOCAL_SERVICE_RELEASE_REPO,
    LOCAL_SERVICE_RELEASE_CHANNEL: mutableEnv.LOCAL_SERVICE_RELEASE_CHANNEL,
    LOCAL_SERVICE_RELEASE_TAG: mutableEnv.LOCAL_SERVICE_RELEASE_TAG,
    LOCAL_SERVICE_RELEASE_URL_LINUX_ARM64:
      mutableEnv.LOCAL_SERVICE_RELEASE_URL_LINUX_ARM64,
    LOCAL_SERVICE_RELEASE_URL_LINUX_X64:
      mutableEnv.LOCAL_SERVICE_RELEASE_URL_LINUX_X64,
    LOCAL_SERVICE_RELEASE_URL_MAC_ARM64:
      mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64,
    LOCAL_SERVICE_RELEASE_URL_MAC_X64:
      mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_X64,
    LOCAL_SERVICE_RELEASE_URL_WIN_X64:
      mutableEnv.LOCAL_SERVICE_RELEASE_URL_WIN_X64,
    NODE_ENV: mutableEnv.NODE_ENV,
    RAILWAY_GIT_BRANCH: mutableEnv.RAILWAY_GIT_BRANCH,
    VERCEL_GIT_COMMIT_REF: mutableEnv.VERCEL_GIT_COMMIT_REF,
    VERCEL_GIT_REPO_OWNER: mutableEnv.VERCEL_GIT_REPO_OWNER,
    VERCEL_GIT_REPO_SLUG: mutableEnv.VERCEL_GIT_REPO_SLUG,
  };

  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnvValue('CF_PAGES_BRANCH', originalEnv.CF_PAGES_BRANCH);
    restoreEnvValue(
      'CLIENT_DOWNLOAD_SIGNING_SECRET',
      originalEnv.CLIENT_DOWNLOAD_SIGNING_SECRET
    );
    restoreEnvValue('DESKTOP_RELEASE_REPO', originalEnv.DESKTOP_RELEASE_REPO);
    restoreEnvValue(
      'DESKTOP_RELEASE_TAG_PREFIX',
      originalEnv.DESKTOP_RELEASE_TAG_PREFIX
    );
    restoreEnvValue(
      'DESKTOP_RELEASE_TARGET_COMMITISH',
      originalEnv.DESKTOP_RELEASE_TARGET_COMMITISH
    );
    restoreEnvValue('GITHUB_REF_NAME', originalEnv.GITHUB_REF_NAME);
    restoreEnvValue('GITHUB_REPOSITORY', originalEnv.GITHUB_REPOSITORY);
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
      'LOCAL_SERVICE_RELEASE_URL_LINUX_ARM64',
      originalEnv.LOCAL_SERVICE_RELEASE_URL_LINUX_ARM64
    );
    restoreEnvValue(
      'LOCAL_SERVICE_RELEASE_URL_LINUX_X64',
      originalEnv.LOCAL_SERVICE_RELEASE_URL_LINUX_X64
    );
    restoreEnvValue(
      'LOCAL_SERVICE_RELEASE_URL_MAC_ARM64',
      originalEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64
    );
    restoreEnvValue(
      'LOCAL_SERVICE_RELEASE_URL_MAC_X64',
      originalEnv.LOCAL_SERVICE_RELEASE_URL_MAC_X64
    );
    restoreEnvValue(
      'LOCAL_SERVICE_RELEASE_URL_WIN_X64',
      originalEnv.LOCAL_SERVICE_RELEASE_URL_WIN_X64
    );
    restoreEnvValue('NODE_ENV', originalEnv.NODE_ENV);
    restoreEnvValue('RAILWAY_GIT_BRANCH', originalEnv.RAILWAY_GIT_BRANCH);
    restoreEnvValue('VERCEL_GIT_COMMIT_REF', originalEnv.VERCEL_GIT_COMMIT_REF);
    restoreEnvValue('VERCEL_GIT_REPO_OWNER', originalEnv.VERCEL_GIT_REPO_OWNER);
    restoreEnvValue('VERCEL_GIT_REPO_SLUG', originalEnv.VERCEL_GIT_REPO_SLUG);
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
          browser_download_url:
            'https://example.com/LunaTV.Desktop_200.0.1-beta.31_macos-arm64.dmg',
          id: 11,
          name: 'LunaTV.Desktop_200.0.1-beta.31_macos-arm64.dmg',
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

  it('recognizes both legacy and current macOS desktop dmg naming', () => {
    expect(
      getDesktopAssetKeyForName('LunaTV.Desktop_200.0.1-beta.31_macos-arm64.dmg')
    ).toBe('mac-arm64');
    expect(
      getDesktopAssetKeyForName('LunaTV.Desktop_200.0.1-beta.31_macos-x64.dmg')
    ).toBe('mac-x64');
    expect(getDesktopAssetKeyForName('LunaTV.Desktop_aarch64.dmg')).toBe(
      'mac-arm64'
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

  it('falls back to unsigned desktop gateway paths when signing is unavailable', () => {
    delete mutableEnv.CLIENT_DOWNLOAD_SIGNING_SECRET;
    mutableEnv.NODE_ENV = 'production';

    expect(isClientDownloadSigningEnabled()).toBe(false);
    expect(
      buildSignedDesktopDownloadPath({
        assetId: 200,
        releaseId: 100,
      })
    ).toBe('/api/client-download?assetId=200&kind=desktop&releaseId=100');
  });

  it('reads local service platform mappings from environment variables', () => {
    mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64 =
      'https://example.com/lunatv-server';
    delete mutableEnv.LOCAL_SERVICE_RELEASE_REPO;
    delete mutableEnv.DESKTOP_RELEASE_REPO;
    delete mutableEnv.GITHUB_REPOSITORY;
    delete mutableEnv.VERCEL_GIT_REPO_OWNER;
    delete mutableEnv.VERCEL_GIT_REPO_SLUG;

    expect(resolveLocalServiceBinaryUrl('mac-arm64')).toBe(
      'https://example.com/lunatv-server'
    );
    expect(resolveLocalServiceBinaryUrl('mac-x64')).toBeNull();
  });

  it('defaults desktop releases to the current deployment repo and desktop tag line', () => {
    delete mutableEnv.DESKTOP_RELEASE_REPO;
    delete mutableEnv.DESKTOP_RELEASE_TAG_PREFIX;
    delete mutableEnv.DESKTOP_RELEASE_TARGET_COMMITISH;
    delete mutableEnv.GITHUB_REPOSITORY;
    mutableEnv.VERCEL_GIT_REPO_OWNER = 'demo';
    mutableEnv.VERCEL_GIT_REPO_SLUG = 'LunaTV';

    expect(getDesktopReleaseConfig()).toEqual({
      repo: 'demo/LunaTV',
      tagPrefix: 'desktop-v',
      targetCommitish: undefined,
    });
  });

  it('hydrates the selected desktop prerelease from the release detail endpoint', async () => {
    mutableEnv.DESKTOP_RELEASE_REPO = 'demo/LunaTV';
    delete mutableEnv.DESKTOP_RELEASE_TAG_PREFIX;
    delete mutableEnv.DESKTOP_RELEASE_TARGET_COMMITISH;

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              assets: [],
              id: 39,
              prerelease: true,
              published_at: '2026-06-16T00:00:00.000Z',
              tag_name: 'desktop-v200.0.0-beta.3',
            },
          ]),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 200,
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            assets: [
              {
                browser_download_url:
                  'https://example.com/LunaTV.Desktop_200.0.0-beta.3_aarch64.dmg',
                id: 401,
                name: 'LunaTV.Desktop_200.0.0-beta.3_aarch64.dmg',
                size: 1024,
              },
            ],
            id: 39,
            prerelease: true,
            published_at: '2026-06-16T00:00:00.000Z',
            tag_name: 'desktop-v200.0.0-beta.3',
          }),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 200,
          }
        )
      ) as typeof fetch;

    await expect(fetchLatestDesktopRelease()).resolves.toMatchObject({
      assets: [
        expect.objectContaining({
          id: 401,
          name: 'LunaTV.Desktop_200.0.0-beta.3_aarch64.dmg',
        }),
      ],
      id: 39,
      tag_name: 'desktop-v200.0.0-beta.3',
    });
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

  it('derives stable GitHub release urls for local service installers', () => {
    mutableEnv.DESKTOP_RELEASE_REPO = 'demo/LunaTV';
    mutableEnv.LOCAL_SERVICE_RELEASE_TAG = 'local-service-nova-latest';

    expect(resolveLocalServiceInstallerUrl('linux-arm64')).toBe(
      'https://github.com/demo/LunaTV/releases/download/local-service-nova-latest/lunatv-local-service-linux-arm64.deb'
    );
    expect(resolveLocalServiceInstallerUrl('linux-x64')).toBe(
      'https://github.com/demo/LunaTV/releases/download/local-service-nova-latest/lunatv-local-service-linux-x64.deb'
    );
    expect(resolveLocalServiceInstallerUrl('mac-arm64')).toBe(
      'https://github.com/demo/LunaTV/releases/download/local-service-nova-latest/lunatv-local-service-mac-arm64.pkg'
    );
    expect(resolveLocalServiceInstallerUrl('mac-x64')).toBe(
      'https://github.com/demo/LunaTV/releases/download/local-service-nova-latest/lunatv-local-service-mac-x64.pkg'
    );
    expect(resolveLocalServiceInstallerUrl('win-x64')).toBe(
      'https://github.com/demo/LunaTV/releases/download/local-service-nova-latest/lunatv-local-service-win-x64.exe'
    );
  });

  it('selects the newest versioned local service release behind a latest alias tag', () => {
    const release = selectLatestVersionedLocalServiceRelease(
      [
        {
          assets: [],
          id: 1,
          prerelease: true,
          published_at: '2026-06-15T00:00:00.000Z',
          tag_name: 'local-service-nova-2026-06-15.1',
        },
        {
          assets: [],
          id: 2,
          prerelease: true,
          published_at: '2026-06-16T00:00:00.000Z',
          tag_name: 'local-service-nova-2026-06-16.3',
        },
        {
          assets: [],
          id: 3,
          prerelease: true,
          published_at: '2026-06-17T00:00:00.000Z',
          tag_name: 'local-service-nova-latest',
        },
      ],
      'local-service-nova-latest'
    );

    expect(release?.tag_name).toBe('local-service-nova-2026-06-16.3');
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

  it('derives local service repo from deployment metadata when explicit repo config is absent', () => {
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_TAG;
    delete mutableEnv.DESKTOP_RELEASE_REPO;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_REPO;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_CHANNEL;
    mutableEnv.GITHUB_REPOSITORY = 'demo/LunaTV';
    mutableEnv.VERCEL_GIT_COMMIT_REF = 'nova';

    expect(resolveLocalServiceBinaryUrl('win-x64')).toBe(
      'https://github.com/demo/LunaTV/releases/download/local-service-nova-latest/lunatv-server-win-x64.exe'
    );
  });

  it('fetches local service release summary with the resolved version tag', async () => {
    mutableEnv.DESKTOP_RELEASE_REPO = 'demo/LunaTV';
    mutableEnv.VERCEL_GIT_COMMIT_REF = 'nova';
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_LINUX_ARM64;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_LINUX_X64;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_X64;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_WIN_X64;
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            assets: [
              {
                browser_download_url:
                  'https://example.com/lunatv-server-mac-arm64',
                id: 10,
                name: 'lunatv-server-mac-arm64',
                size: 100,
              },
              {
                browser_download_url:
                  'https://example.com/lunatv-local-service-mac-arm64.pkg',
                id: 11,
                name: 'lunatv-local-service-mac-arm64.pkg',
                size: 100,
              },
            ],
            id: 1,
            name: 'LunaTV Local Service (local-service-nova-2026-06-16.2)',
            prerelease: true,
            published_at: '2026-06-16T00:00:00.000Z',
            tag_name: 'local-service-nova-2026-06-16.2',
          },
          {
            assets: [
              {
                browser_download_url:
                  'https://example.com/lunatv-server-linux-arm64',
                id: 20,
                name: 'lunatv-server-linux-arm64',
                size: 100,
              },
              {
                browser_download_url:
                  'https://example.com/lunatv-server-linux-x64',
                id: 21,
                name: 'lunatv-server-linux-x64',
                size: 100,
              },
              {
                browser_download_url:
                  'https://example.com/lunatv-server-mac-arm64',
                id: 22,
                name: 'lunatv-server-mac-arm64',
                size: 100,
              },
              {
                browser_download_url:
                  'https://example.com/lunatv-server-mac-x64',
                id: 23,
                name: 'lunatv-server-mac-x64',
                size: 100,
              },
              {
                browser_download_url:
                  'https://example.com/lunatv-server-win-x64.exe',
                id: 24,
                name: 'lunatv-server-win-x64.exe',
                size: 100,
              },
              {
                browser_download_url:
                  'https://example.com/lunatv-local-service-linux-arm64.deb',
                id: 25,
                name: 'lunatv-local-service-linux-arm64.deb',
                size: 100,
              },
              {
                browser_download_url:
                  'https://example.com/lunatv-local-service-linux-x64.deb',
                id: 26,
                name: 'lunatv-local-service-linux-x64.deb',
                size: 100,
              },
              {
                browser_download_url:
                  'https://example.com/lunatv-local-service-mac-arm64.pkg',
                id: 27,
                name: 'lunatv-local-service-mac-arm64.pkg',
                size: 100,
              },
              {
                browser_download_url:
                  'https://example.com/lunatv-local-service-mac-x64.pkg',
                id: 28,
                name: 'lunatv-local-service-mac-x64.pkg',
                size: 100,
              },
              {
                browser_download_url:
                  'https://example.com/lunatv-local-service-win-x64.exe',
                id: 29,
                name: 'lunatv-local-service-win-x64.exe',
                size: 100,
              },
            ],
            id: 2,
            name: 'LunaTV Local Service (local-service-nova-2026-06-16.3)',
            prerelease: true,
            published_at: '2026-06-16T03:00:00.000Z',
            tag_name: 'local-service-nova-2026-06-16.3',
          },
          {
            assets: [
              {
                browser_download_url:
                  'https://example.com/lunatv-server-mac-arm64',
                id: 30,
                name: 'lunatv-server-mac-arm64',
                size: 100,
              },
              {
                browser_download_url:
                  'https://example.com/lunatv-local-service-mac-arm64.pkg',
                id: 31,
                name: 'lunatv-local-service-mac-arm64.pkg',
                size: 100,
              },
            ],
            id: 3,
            name: 'LunaTV Local Service (nova latest)',
            prerelease: true,
            published_at: '2026-06-16T03:10:00.000Z',
            tag_name: 'local-service-nova-latest',
          },
        ]),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        }
      )
    ) as typeof fetch;

    await expect(fetchLocalServiceReleaseSummary()).resolves.toEqual({
      availablePlatforms: [
        'linux-arm64',
        'linux-x64',
        'mac-arm64',
        'mac-x64',
        'win-x64',
      ],
      configuredPlatforms: [
        'linux-arm64',
        'linux-x64',
        'mac-arm64',
        'mac-x64',
        'win-x64',
      ],
      displayName: 'LunaTV Local Service (local-service-nova-2026-06-16.3)',
      installerPlatforms: [
        'linux-arm64',
        'linux-x64',
        'mac-arm64',
        'mac-x64',
        'win-x64',
      ],
      publishedAt: '2026-06-16T03:00:00.000Z',
      releaseStatus: 'release',
      version: 'local-service-nova-2026-06-16.3',
    });
  });

  it('marks a configured branch channel as missing when no release assets can be resolved', async () => {
    mutableEnv.DESKTOP_RELEASE_REPO = 'demo/LunaTV';
    mutableEnv.VERCEL_GIT_COMMIT_REF = 'luna';
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_LINUX_ARM64;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_LINUX_X64;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_ARM64;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_MAC_X64;
    delete mutableEnv.LOCAL_SERVICE_RELEASE_URL_WIN_X64;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 404 })
      ) as typeof fetch;

    await expect(fetchLocalServiceReleaseSummary()).resolves.toEqual({
      availablePlatforms: [],
      configuredPlatforms: [
        'linux-arm64',
        'linux-x64',
        'mac-arm64',
        'mac-x64',
        'win-x64',
      ],
      displayName: null,
      installerPlatforms: [],
      publishedAt: null,
      releaseStatus: 'missing',
      version: 'local-service-luna-latest',
    });
  });
});
