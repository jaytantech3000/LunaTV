/* eslint-disable @typescript-eslint/no-var-requires */

interface GithubReleaseAssetPayload {
  name?: string | null;
  label?: string | null;
  browser_download_url?: string | null;
  size?: number | null;
}

interface GithubReleasePayload {
  id?: number | string | null;
  tag_name?: string | null;
  name?: string | null;
  body?: string | null;
  draft?: boolean | null;
  prerelease?: boolean | null;
  published_at?: string | null;
  created_at?: string | null;
  html_url?: string | null;
  assets?: GithubReleaseAssetPayload[] | null;
}

interface DownloadSiteDataModule {
  normalizeDownloadSiteReleases(input: GithubReleasePayload[]): Array<{
    tagName: string;
    version: string;
    prerelease: boolean;
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
  hydrateDownloadSiteReleaseChangeSummaries(
    input: Array<{
      tagName: string;
      version: string;
      prerelease: boolean;
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
    }>,
    options?: {
      fetchImpl?: (
        input: string,
        init?: Record<string, unknown>
      ) => Promise<{
        ok: boolean;
        status: number;
        json: () => Promise<unknown>;
      }>;
    }
  ): Promise<
    Array<{
      tagName: string;
      version: string;
      prerelease: boolean;
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
    }>
  >;
}

const downloadSiteDataModule =
  require('../../scripts/download-site-data.js') as DownloadSiteDataModule;

describe('download site release data', () => {
  it('keeps only public desktop releases and end-user assets', () => {
    const releases = downloadSiteDataModule.normalizeDownloadSiteReleases([
      {
        id: 1,
        tag_name: 'desktop-v200.0.1-beta.15',
        name: 'LunaTV Desktop 200.0.1 Beta 15',
        body: `## Added
- replace web mocks with netease routes

## Fixed
- restore beta release summaries

**Full Changelog**: https://github.com/jaytantech3000/LunaTV/compare/desktop-v200.0.1-beta.14...desktop-v200.0.1-beta.15`,
        prerelease: true,
        published_at: '2026-06-26T17:28:37Z',
        html_url:
          'https://github.com/jaytantech3000/LunaTV/releases/tag/desktop-v200.0.1-beta.15',
        assets: [
          {
            name: 'latest.json',
            browser_download_url: 'https://example.com/latest.json',
            size: 10,
          },
          {
            name: 'LunaTV.Desktop_200.0.1-beta.15_windows-x64-setup.exe',
            label:
              'Windows x64 - LunaTV.Desktop_200.0.1-beta.15_windows-x64-setup.exe',
            browser_download_url: 'https://example.com/win.exe',
            size: 101,
          },
          {
            name: 'LunaTV.Desktop_200.0.1-beta.15_windows-x64-setup.exe.sig',
            label:
              'Windows x64 - LunaTV.Desktop_200.0.1-beta.15_windows-x64-setup.exe.sig',
            browser_download_url: 'https://example.com/win.exe.sig',
            size: 1,
          },
          {
            name: 'LunaTV.Desktop_200.0.1-beta.15_macos-arm64.dmg',
            label:
              'macOS Apple Silicon - LunaTV.Desktop_200.0.1-beta.15_macos-arm64.dmg',
            browser_download_url: 'https://example.com/macos.dmg',
            size: 202,
          },
        ],
      },
      {
        id: 2,
        tag_name: 'desktop-v200.0.1-internal-run43-a1',
        name: 'internal',
        prerelease: true,
        published_at: '2026-06-26T15:35:46Z',
        assets: [
          {
            name: 'LunaTV.Desktop_200.0.1_windows-x64-setup.exe',
            browser_download_url: 'https://example.com/internal.exe',
          },
        ],
      },
      {
        id: 3,
        tag_name: 'desktop-v200.0.1',
        name: 'stable',
        prerelease: false,
        published_at: '2026-06-27T01:00:00Z',
        assets: [
          {
            name: 'LunaTV.Desktop_200.0.1_macos-x64.dmg',
            label: 'macOS Intel - LunaTV.Desktop_200.0.1_macos-x64.dmg',
            browser_download_url: 'https://example.com/stable.dmg',
            size: 303,
          },
        ],
      },
      {
        id: 4,
        tag_name: 'desktop-v200.0.0',
        name: 'stable old',
        prerelease: false,
        published_at: '2026-06-20T01:00:00Z',
        assets: [
          {
            name: 'LunaTV.Desktop_200.0.0_macos-x64.dmg',
            label: 'macOS Intel - LunaTV.Desktop_200.0.0_macos-x64.dmg',
            browser_download_url: 'https://example.com/stable-old.dmg',
            size: 404,
          },
        ],
      },
      {
        id: 5,
        tag_name: 'desktop-v200.0.2',
        name: 'draft',
        draft: true,
        prerelease: false,
        published_at: '2026-06-28T01:00:00Z',
        assets: [
          {
            name: 'LunaTV.Desktop_200.0.2_macos-x64.dmg',
            browser_download_url: 'https://example.com/draft.dmg',
          },
        ],
      },
    ]);

    expect(releases.map((release) => release.tagName)).toEqual([
      'desktop-v200.0.1',
      'desktop-v200.0.1-beta.15',
      'desktop-v200.0.0',
    ]);
    expect(releases[1]).toMatchObject({
      version: '200.0.1-beta.15',
      prerelease: true,
      changeSummary: {
        en: {
          compareUrl:
            'https://github.com/jaytantech3000/LunaTV/compare/desktop-v200.0.1-beta.14...desktop-v200.0.1-beta.15',
          added: ['replace web mocks with netease routes'],
          changed: [],
          fixed: ['restore beta release summaries'],
          other: [],
        },
        'zh-CN': {
          compareUrl:
            'https://github.com/jaytantech3000/LunaTV/compare/desktop-v200.0.1-beta.14...desktop-v200.0.1-beta.15',
          added: ['用网易云路由替换 Web Mock'],
          changed: [],
          fixed: ['恢复 Beta 版本摘要'],
          other: [],
        },
      },
      assets: [
        {
          fileName: 'LunaTV.Desktop_200.0.1-beta.15_windows-x64-setup.exe',
          platformLabel: 'Windows x64',
          downloadUrl: 'https://example.com/win.exe',
          size: 101,
        },
        {
          fileName: 'LunaTV.Desktop_200.0.1-beta.15_macos-arm64.dmg',
          platformLabel: 'macOS Apple Silicon',
          downloadUrl: 'https://example.com/macos.dmg',
          size: 202,
        },
      ],
    });
  });

  it('hydrates compare-only release notes into grouped bilingual summaries', async () => {
    const compareUrl =
      'https://github.com/jaytantech3000/LunaTV/compare/desktop-v200.0.1-beta.15...desktop-v200.0.1-beta.16';

    const normalizedReleases =
      downloadSiteDataModule.normalizeDownloadSiteReleases([
        {
          id: 1,
          tag_name: 'desktop-v200.0.1-beta.16',
          name: 'LunaTV Desktop 200.0.1 Beta 16',
          body: `**Full Changelog**: ${compareUrl}`,
          prerelease: true,
          published_at: '2026-06-27T01:00:00Z',
          html_url:
            'https://github.com/jaytantech3000/LunaTV/releases/tag/desktop-v200.0.1-beta.16',
          assets: [
            {
              name: 'LunaTV.Desktop_200.0.1-beta.16_windows-x64-setup.exe',
              label:
                'Windows x64 - LunaTV.Desktop_200.0.1-beta.16_windows-x64-setup.exe',
              browser_download_url: 'https://example.com/win.exe',
              size: 101,
            },
          ],
        },
      ]);

    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        commits: [
          {
            commit: {
              message: 'feat(music): power desktop music api with netease',
            },
          },
          {
            commit: {
              message: 'fix(desktop): restore beta release summaries',
            },
          },
        ],
      }),
    }));

    const hydratedReleases =
      await downloadSiteDataModule.hydrateDownloadSiteReleaseChangeSummaries(
        normalizedReleases,
        {
          fetchImpl,
        }
      );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/jaytantech3000/LunaTV/compare/desktop-v200.0.1-beta.15...desktop-v200.0.1-beta.16',
      expect.objectContaining({
        cache: 'no-store',
      })
    );
    expect(hydratedReleases[0]?.changeSummary).toEqual({
      en: {
        compareUrl,
        added: ['music: power desktop music api with netease'],
        changed: [],
        fixed: ['desktop: restore beta release summaries'],
        other: [],
      },
      'zh-CN': {
        compareUrl,
        added: ['音乐：用网易云驱动桌面音乐 API'],
        changed: [],
        fixed: ['桌面端：恢复 Beta 版本摘要'],
        other: [],
      },
    });
  });
});
