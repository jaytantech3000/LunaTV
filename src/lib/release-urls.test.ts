import {
  getDesktopReleaseHistoryProxyUrl,
  getDesktopUpdaterManifestProxyUrl,
  getDesktopUpdaterVersionProxyUrl,
} from './release-urls';

describe('release url helpers', () => {
  afterEach(() => {
    delete window.RUNTIME_CONFIG;
  });

  it('builds desktop release proxy urls from runtime config', () => {
    window.RUNTIME_CONFIG = {
      DESKTOP_RELEASE_PROXY_BASE_URL: 'https://proxy.example.com/',
    };

    expect(getDesktopReleaseHistoryProxyUrl()).toBe(
      'https://proxy.example.com/api/desktop/releases?repo=jaytantech3000%2FLunaTV'
    );
    expect(getDesktopUpdaterVersionProxyUrl()).toBe(
      'https://proxy.example.com/api/desktop/updater/version?repo=jaytantech3000%2FLunaTV&branch=desktop-updater'
    );
    expect(
      getDesktopUpdaterManifestProxyUrl({
        tagName: 'desktop-v200.0.0',
      })
    ).toBe(
      'https://proxy.example.com/api/desktop/updater/latest?repo=jaytantech3000%2FLunaTV&tag=desktop-v200.0.0'
    );
  });
});
