/* eslint-disable @typescript-eslint/no-var-requires */

interface DownloadSiteAppModule {
  createDownloadSiteApp(document: Document): {
    render(payload: {
      releases: Array<{
        tagName: string;
        version: string;
        name: string;
        prerelease: boolean;
        publishedAt: string | null;
        htmlUrl: string | null;
        notes: string | null;
        assets: Array<{
          fileName: string;
          platformLabel: string;
          downloadUrl: string;
          size: number | null;
        }>;
      }>;
    }): void;
    setLocale(locale: 'zh-CN' | 'en'): void;
  };
}

const downloadSiteAppModule =
  require('../../download-site/assets/app.js') as DownloadSiteAppModule;

describe('download site app', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders release groups and switches UI locale', () => {
    document.body.innerHTML = `
      <main id="app">
        <div data-copy="releaseSectionTitle"></div>
        <div data-copy="prereleaseSectionTitle"></div>
        <div data-slot="release-list"></div>
        <div data-slot="prerelease-list"></div>
      </main>
    `;

    const app = downloadSiteAppModule.createDownloadSiteApp(document);

    app.render({
      releases: [
        {
          tagName: 'desktop-v200.0.1',
          version: '200.0.1',
          name: 'LunaTV Desktop 200.0.1',
          prerelease: false,
          publishedAt: '2026-06-27T01:00:00Z',
          htmlUrl: 'https://example.com/release',
          notes: 'stable notes',
          assets: [
            {
              fileName: 'LunaTV.Desktop_200.0.1_windows-x64-setup.exe',
              platformLabel: 'Windows x64',
              downloadUrl: 'https://example.com/stable.exe',
              size: 101,
            },
          ],
        },
        {
          tagName: 'desktop-v200.0.1-beta.15',
          version: '200.0.1-beta.15',
          name: 'LunaTV Desktop 200.0.1 Beta 15',
          prerelease: true,
          publishedAt: '2026-06-26T17:28:37Z',
          htmlUrl: 'https://example.com/prerelease',
          notes: 'beta notes',
          assets: [
            {
              fileName: 'LunaTV.Desktop_200.0.1-beta.15_macos-arm64.dmg',
              platformLabel: 'macOS Apple Silicon',
              downloadUrl: 'https://example.com/beta.dmg',
              size: 202,
            },
          ],
        },
      ],
    });

    expect(
      document.querySelector('[data-slot="release-list"]')?.textContent
    ).toContain('200.0.1');
    expect(
      document.querySelector('[data-slot="prerelease-list"]')?.textContent
    ).toContain('200.0.1-beta.15');
    expect(
      document.querySelector('[data-copy="releaseSectionTitle"]')?.textContent
    ).toBe('Release');

    app.setLocale('zh-CN');

    expect(
      document.querySelector('[data-copy="releaseSectionTitle"]')?.textContent
    ).toBe('正式版');
    expect(
      document.querySelector('[data-copy="prereleaseSectionTitle"]')
        ?.textContent
    ).toBe('预发布');
  });

  it('keeps the tabs and shows release notes inside the release notes tab', () => {
    document.body.innerHTML = `
      <main id="app">
        <div data-copy="releaseSectionTitle"></div>
        <div data-copy="prereleaseSectionTitle"></div>
        <div data-slot="release-list"></div>
        <div data-slot="prerelease-list"></div>
      </main>
    `;

    const app = downloadSiteAppModule.createDownloadSiteApp(document);

    app.render({
      releases: [
        {
          tagName: 'desktop-v200.0.1-beta.15',
          version: '200.0.1-beta.15',
          name: 'LunaTV Desktop 200.0.1 Beta 15',
          prerelease: true,
          publishedAt: '2026-06-26T17:28:37Z',
          htmlUrl: 'https://example.com/prerelease',
          notes: 'beta notes body',
          assets: [
            {
              fileName: 'LunaTV.Desktop_200.0.1-beta.15_macos-arm64.dmg',
              platformLabel: 'macOS Apple Silicon',
              downloadUrl: 'https://example.com/beta.dmg',
              size: 202,
            },
          ],
        },
      ],
    });

    const releaseCard = document.querySelector('.release-card');
    releaseCard?.setAttribute('open', 'true');
    const releaseNotesTabButton = document.querySelector(
      '.release-card__tab[data-tab="notes"]'
    ) as HTMLButtonElement | null;
    releaseNotesTabButton?.click();

    expect(
      document.querySelector('.release-card__notes')?.textContent
    ).toContain('beta notes body');
    expect(
      document.querySelector('.release-card__notes-heading')?.textContent
    ).toBe('Release Notes');
    expect(document.querySelectorAll('.release-card__tab')).toHaveLength(2);
    expect(releaseNotesTabButton?.dataset.active).toBe('true');
    expect(
      document.querySelector('.release-card__panel[data-tab-panel="notes"]')
    ).not.toHaveAttribute('hidden');
  });
});
