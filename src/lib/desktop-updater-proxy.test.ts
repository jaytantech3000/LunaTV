import {
  buildGithubRawBranchFileUrl,
  buildGithubReleaseDownloadUrl,
  isAllowedGithubReleaseAssetUrl,
  isRepositorySlug,
  normalizeGithubRef,
  normalizeRepositorySlug,
  parseDesktopUpdaterManifest,
  rewriteDesktopUpdaterManifestUrls,
} from './desktop-updater-proxy';

describe('desktop updater proxy helpers', () => {
  it('validates repository slugs and refs', () => {
    expect(isRepositorySlug('jaytantech3000/LunaTV')).toBe(true);
    expect(isRepositorySlug('not a repo')).toBe(false);
    expect(normalizeRepositorySlug(' jaytantech3000/LunaTV ')).toBe(
      'jaytantech3000/LunaTV'
    );
    expect(normalizeRepositorySlug('')).toBeNull();
    expect(normalizeGithubRef(' desktop-updater ')).toBe('desktop-updater');
    expect(normalizeGithubRef('bad ref')).toBeNull();
  });

  it('builds raw branch and release download urls', () => {
    expect(
      buildGithubRawBranchFileUrl(
        'jaytantech3000/LunaTV',
        'desktop-updater',
        'latest.json'
      )
    ).toBe(
      'https://raw.githubusercontent.com/jaytantech3000/LunaTV/desktop-updater/latest.json'
    );
    expect(
      buildGithubReleaseDownloadUrl(
        'jaytantech3000/LunaTV',
        'desktop-v200.0.0',
        'latest.json'
      )
    ).toBe(
      'https://github.com/jaytantech3000/LunaTV/releases/download/desktop-v200.0.0/latest.json'
    );
  });

  it('only allows release asset urls from the configured repository', () => {
    expect(
      isAllowedGithubReleaseAssetUrl(
        'https://github.com/jaytantech3000/LunaTV/releases/download/desktop-v200.0.0/LunaTV.Desktop_200.0.0_x64-setup.exe',
        'jaytantech3000/LunaTV'
      )
    ).toBe(true);
    expect(
      isAllowedGithubReleaseAssetUrl(
        'https://github.com/other/repo/releases/download/v1/app.exe',
        'jaytantech3000/LunaTV'
      )
    ).toBe(false);
    expect(
      isAllowedGithubReleaseAssetUrl(
        'https://raw.githubusercontent.com/jaytantech3000/LunaTV/main/latest.json',
        'jaytantech3000/LunaTV'
      )
    ).toBe(false);
  });

  it('parses and rewrites updater manifests to proxy asset downloads', () => {
    const manifest = parseDesktopUpdaterManifest(`{
      "version": "200.0.0",
      "platforms": {
        "windows-x86_64": {
          "signature": "demo",
          "url": "https://github.com/jaytantech3000/LunaTV/releases/download/desktop-v200.0.0/LunaTV.Desktop_200.0.0_x64-setup.exe"
        }
      }
    }`);

    expect(
      rewriteDesktopUpdaterManifestUrls(manifest, {
        proxyBaseUrl: 'https://proxy.example.com',
        repository: 'jaytantech3000/LunaTV',
      })
    ).toEqual({
      version: '200.0.0',
      platforms: {
        'windows-x86_64': {
          signature: 'demo',
          url: 'https://proxy.example.com/api/desktop/updater/download?repo=jaytantech3000%2FLunaTV&target=https%3A%2F%2Fgithub.com%2Fjaytantech3000%2FLunaTV%2Freleases%2Fdownload%2Fdesktop-v200.0.0%2FLunaTV.Desktop_200.0.0_x64-setup.exe',
        },
      },
    });
  });
});
