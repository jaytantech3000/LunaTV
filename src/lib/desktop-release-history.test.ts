import {
  buildLocalDesktopReleaseHistoryFallback,
  extractDesktopReleaseVersion,
  findDesktopReleaseManifestUrl,
  isDesktopReleaseLineVersion,
  normalizeDesktopReleaseHistory,
} from './desktop-release-history';

describe('desktop release history helpers', () => {
  it('extracts valid desktop release versions from tags', () => {
    expect(extractDesktopReleaseVersion('desktop-v200.0.0')).toBe('200.0.0');
    expect(extractDesktopReleaseVersion('desktop-v200.0.0-beta.16')).toBe(
      '200.0.0-beta.16'
    );
    expect(extractDesktopReleaseVersion('v200.0.0')).toBeNull();
    expect(extractDesktopReleaseVersion('desktop-vnot-a-version')).toBeNull();
  });

  it('finds the updater manifest asset url', () => {
    expect(
      findDesktopReleaseManifestUrl([
        {
          name: 'latest.json',
          browser_download_url: 'https://example.com/latest.json',
        },
      ])
    ).toBe('https://example.com/latest.json');

    expect(
      findDesktopReleaseManifestUrl([
        {
          name: 'LunaTV.Desktop_200.0.0_x64-setup.exe',
          browser_download_url: 'https://example.com/setup.exe',
        },
      ])
    ).toBeNull();
  });

  it('keeps only desktop releases with manifests and sorts them by semver', () => {
    const releases = normalizeDesktopReleaseHistory([
      {
        id: 1,
        tag_name: 'desktop-v200.0.0-beta.15',
        name: 'Beta 15',
        prerelease: true,
        published_at: '2026-06-19T04:01:04Z',
        html_url: 'https://example.com/beta-15',
        assets: [
          {
            name: 'latest.json',
            browser_download_url: 'https://example.com/beta-15/latest.json',
          },
        ],
      },
      {
        id: 2,
        tag_name: 'desktop-v200.0.0',
        name: 'Stable',
        prerelease: false,
        published_at: '2026-06-20T04:01:04Z',
        html_url: 'https://example.com/stable',
        assets: [
          {
            name: 'latest.json',
            browser_download_url: 'https://example.com/stable/latest.json',
          },
        ],
      },
      {
        id: 3,
        tag_name: 'local-service-nova-2026-06-17.3',
        name: 'Ignore me',
        prerelease: true,
        published_at: '2026-06-17T04:01:04Z',
        assets: [
          {
            name: 'latest.json',
            browser_download_url:
              'https://example.com/local-service/latest.json',
          },
        ],
      },
      {
        id: 4,
        tag_name: 'desktop-v200.0.0-beta.16',
        name: 'Beta 16',
        prerelease: true,
        published_at: '2026-06-19T05:01:04Z',
        html_url: 'https://example.com/beta-16',
        assets: [
          {
            name: 'latest.json',
            browser_download_url: 'https://example.com/beta-16/latest.json',
          },
        ],
      },
      {
        id: 5,
        tag_name: 'desktop-v200.0.1',
        name: 'Missing manifest',
        prerelease: false,
        published_at: '2026-06-21T04:01:04Z',
        assets: [],
      },
    ]);

    expect(releases).toHaveLength(3);
    expect(releases.map((item) => item.version)).toEqual([
      '200.0.0',
      '200.0.0-beta.16',
      '200.0.0-beta.15',
    ]);
  });

  it('detects versions that belong to the desktop-only release line', () => {
    expect(isDesktopReleaseLineVersion('200.0.0')).toBe(true);
    expect(isDesktopReleaseLineVersion('200.0.0-beta.16')).toBe(true);
    expect(isDesktopReleaseLineVersion('100.1.3')).toBe(false);
    expect(isDesktopReleaseLineVersion('not-a-version')).toBe(false);
  });

  it('builds a local fallback release list from desktop changelog entries', () => {
    const releases = buildLocalDesktopReleaseHistoryFallback({
      currentVersion: '200.0.1-beta.8',
      repository: 'jaytantech3000/LunaTV',
      manifestProxyBaseUrl: 'https://proxy.example.com',
    });

    expect(releases.map((item) => item.version)).toEqual([
      '200.0.1',
      '200.0.1-beta.8',
      '200.0.0',
    ]);
    expect(
      releases.find((item) => item.version === '200.0.1-beta.8')
    ).toMatchObject({
      tagName: 'desktop-v200.0.1-beta.8',
      prerelease: true,
      htmlUrl:
        'https://github.com/jaytantech3000/LunaTV/releases/tag/desktop-v200.0.1-beta.8',
      manifestUrl:
        'https://proxy.example.com/api/desktop/updater/latest?repo=jaytantech3000%2FLunaTV&tag=desktop-v200.0.1-beta.8',
    });
    expect(releases.some((item) => item.version === '100.1.3')).toBe(false);
  });
});
