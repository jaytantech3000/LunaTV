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
        changeSummary: {
          en: {
            compareUrl: string | null;
            added: string[];
            changed: string[];
            fixed: string[];
            other: string[];
          } | null;
          'zh-CN': {
            compareUrl: string | null;
            added: string[];
            changed: string[];
            fixed: string[];
            other: string[];
          } | null;
        } | null;
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
  const originalMatchMedia = window.matchMedia;
  const originalNavigatorPlatform = window.navigator.platform;
  const originalNavigatorUserAgentData = window.navigator.userAgentData;

  async function flushAsyncWork() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function renderDownloadSiteShell() {
    document.body.innerHTML = `
      <div id="download-site-app">
        <a data-role="repo-link"></a>
        <button
          type="button"
          data-theme-toggle
          aria-label="Toggle theme"
        ></button>
        <button type="button" data-locale-button="zh-CN"></button>
        <button type="button" data-locale-button="en"></button>
        <div data-copy="releaseSectionTitle"></div>
        <div data-copy="prereleaseSectionTitle"></div>
        <div data-slot="release-list"></div>
        <div data-slot="prerelease-list"></div>
        <time data-role="generated-at"></time>
      </div>
    `;
  }

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: originalNavigatorPlatform,
    });
    Object.defineProperty(window.navigator, 'userAgentData', {
      configurable: true,
      value: originalNavigatorUserAgentData,
    });
  });

  afterAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: originalNavigatorPlatform,
    });
    Object.defineProperty(window.navigator, 'userAgentData', {
      configurable: true,
      value: originalNavigatorUserAgentData,
    });
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
          changeSummary: null,
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
          changeSummary: null,
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

  it('keeps the tabs and renders desktop-style release summaries inside the release notes tab', () => {
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
          changeSummary: {
            en: {
              compareUrl:
                'https://github.com/jaytantech3000/LunaTV/compare/desktop-v200.0.1-beta.14...desktop-v200.0.1-beta.15',
              added: ['Compact desktop release cards'],
              changed: ['Reuse compare parser'],
              fixed: ['Avoid stale release compare cache'],
              other: [],
            },
            'zh-CN': {
              compareUrl:
                'https://github.com/jaytantech3000/LunaTV/compare/desktop-v200.0.1-beta.14...desktop-v200.0.1-beta.15',
              added: ['精简桌面版本卡片'],
              changed: ['复用版本对比解析器'],
              fixed: ['避免旧的版本对比缓存'],
              other: [],
            },
          },
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
      document.querySelector('.release-card__change-group-label')?.textContent
    ).toBe('Added');
    expect(
      document.querySelector('.release-card__change-summary')?.textContent
    ).toContain('Compact desktop release cards');
    expect(
      document.querySelector('.release-card__change-summary')?.textContent
    ).not.toContain('beta notes body');
    expect(
      document.querySelector('.release-card__notes-heading')?.textContent
    ).toBe('Release Notes');
    expect(
      document.querySelector('.release-card__change-compare')?.textContent
    ).toBe('Full compare');
    expect(document.querySelectorAll('.release-card__tab')).toHaveLength(2);
    expect(releaseNotesTabButton?.dataset.active).toBe('true');
    expect(
      document.querySelector('.release-card__panel[data-tab-panel="notes"]')
    ).not.toHaveAttribute('hidden');

    app.setLocale('zh-CN');

    const zhReleaseCard = document.querySelector('.release-card');
    zhReleaseCard?.setAttribute('open', 'true');
    const zhReleaseNotesTabButton = document.querySelector(
      '.release-card__tab[data-tab="notes"]'
    ) as HTMLButtonElement | null;
    zhReleaseNotesTabButton?.click();

    expect(
      document.querySelector('.release-card__notes-heading')?.textContent
    ).toBe('发布说明');
    expect(
      document.querySelector('.release-card__change-group-label')?.textContent
    ).toBe('新增功能');
    expect(
      document.querySelector('.release-card__change-summary')?.textContent
    ).toContain('精简桌面版本卡片');
    expect(
      document.querySelector('.release-card__change-compare')?.textContent
    ).toBe('完整对比');
  });

  it('follows dark system preference on first render and toggles theme persistently', () => {
    renderDownloadSiteShell();

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    });

    downloadSiteAppModule.createDownloadSiteApp(document);

    expect(document.documentElement.dataset.theme).toBe('dark');

    const toggle = document.querySelector(
      '[data-theme-toggle]'
    ) as HTMLButtonElement | null;
    toggle?.click();

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('lunatv-download-site:theme')).toBe(
      'light'
    );
  });

  it('highlights the matching Windows asset for Windows visitors', () => {
    renderDownloadSiteShell();

    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });

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
          changeSummary: null,
          assets: [
            {
              fileName: 'LunaTV.Desktop_200.0.1_windows-x64-setup.exe',
              platformLabel: 'Windows x64',
              downloadUrl: 'https://example.com/stable.exe',
              size: 101,
            },
            {
              fileName: 'LunaTV.Desktop_200.0.1_macos-arm64.dmg',
              platformLabel: 'macOS Apple Silicon',
              downloadUrl: 'https://example.com/stable.dmg',
              size: 202,
            },
          ],
        },
      ],
    });

    expect(
      document.querySelector('.asset-item[data-platform-match="true"]')
    ).toHaveTextContent('Windows x64');
    expect(
      document.querySelector('.asset-item__link[data-platform-match="true"]')
    ).toHaveTextContent('Download');
    expect(
      document.querySelector('.asset-item[data-platform-match="true"]')
    ).not.toHaveTextContent('macOS Apple Silicon');
  });

  it('highlights only Apple Silicon assets for arm64 macOS visitors', async () => {
    renderDownloadSiteShell();
    const getHighEntropyValuesMock = jest.fn().mockResolvedValue({
      architecture: 'arm',
      bitness: '64',
    });

    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });
    Object.defineProperty(window.navigator, 'userAgentData', {
      configurable: true,
      value: {
        platform: 'macOS',
        getHighEntropyValues: getHighEntropyValuesMock,
      },
    });

    const app = downloadSiteAppModule.createDownloadSiteApp(document);

    app.render({
      releases: [
        {
          tagName: 'desktop-v200.0.1-beta.38',
          version: '200.0.1-beta.38',
          name: 'LunaTV Desktop 200.0.1 Beta 38',
          prerelease: true,
          publishedAt: '2026-07-06T01:00:00Z',
          htmlUrl: 'https://example.com/release',
          notes: 'beta notes',
          changeSummary: null,
          assets: [
            {
              fileName: 'LunaTV.Desktop_200.0.1-beta.38_macos-arm64.dmg',
              platformLabel: 'macOS Apple Silicon',
              downloadUrl: 'https://example.com/apple.dmg',
              size: 100,
            },
            {
              fileName: 'LunaTV.Desktop_200.0.1-beta.38_macos-x64.dmg',
              platformLabel: 'macOS Intel',
              downloadUrl: 'https://example.com/intel.dmg',
              size: 101,
            },
          ],
        },
      ],
    });

    await flushAsyncWork();
    expect(getHighEntropyValuesMock).toHaveBeenCalled();

    const matchedAssets = Array.from(
      document.querySelectorAll('.asset-item[data-platform-match="true"]')
    ).map((element) => element.textContent || '');

    expect(matchedAssets).toHaveLength(1);
    expect(matchedAssets[0]).toContain('macOS Apple Silicon');
    expect(matchedAssets[0]).not.toContain('macOS Intel');
  });

  it('highlights only Intel assets for x64 macOS visitors', async () => {
    renderDownloadSiteShell();
    const getHighEntropyValuesMock = jest.fn().mockResolvedValue({
      architecture: 'x86',
      bitness: '64',
    });

    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });
    Object.defineProperty(window.navigator, 'userAgentData', {
      configurable: true,
      value: {
        platform: 'macOS',
        getHighEntropyValues: getHighEntropyValuesMock,
      },
    });

    const app = downloadSiteAppModule.createDownloadSiteApp(document);

    app.render({
      releases: [
        {
          tagName: 'desktop-v200.0.1-beta.38',
          version: '200.0.1-beta.38',
          name: 'LunaTV Desktop 200.0.1 Beta 38',
          prerelease: true,
          publishedAt: '2026-07-06T01:00:00Z',
          htmlUrl: 'https://example.com/release',
          notes: 'beta notes',
          changeSummary: null,
          assets: [
            {
              fileName: 'LunaTV.Desktop_200.0.1-beta.38_macos-arm64.dmg',
              platformLabel: 'macOS Apple Silicon',
              downloadUrl: 'https://example.com/apple.dmg',
              size: 100,
            },
            {
              fileName: 'LunaTV.Desktop_200.0.1-beta.38_macos-x64.dmg',
              platformLabel: 'macOS Intel',
              downloadUrl: 'https://example.com/intel.dmg',
              size: 101,
            },
          ],
        },
      ],
    });

    await flushAsyncWork();
    expect(getHighEntropyValuesMock).toHaveBeenCalled();

    const matchedAssets = Array.from(
      document.querySelectorAll('.asset-item[data-platform-match="true"]')
    ).map((element) => element.textContent || '');

    expect(matchedAssets).toHaveLength(1);
    expect(matchedAssets[0]).toContain('macOS Intel');
    expect(matchedAssets[0]).not.toContain('macOS Apple Silicon');
  });
});
