'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';

import type { AppUpdateState } from '@/lib/app-update';

const mockInstallDesktopReleaseVersion = jest.fn();
const mockOpenExternalUrl = jest.fn();
const mockFetchDesktopReleaseHistory = jest.fn();
const mockIsDesktopTauriRuntimeAvailable = jest.fn(() => true);

jest.mock('@/lib/app-update', () => ({
  installDesktopReleaseVersion: (...args: unknown[]) =>
    mockInstallDesktopReleaseVersion(...args),
}));

jest.mock('@/lib/scroll-lock', () => ({
  acquireScrollLock: jest.fn(() => jest.fn()),
}));

jest.mock('@/lib/open-external-url', () => ({
  openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
}));

jest.mock('@/lib/desktop/tauri-client', () => ({
  fetchDesktopReleaseHistory: (...args: unknown[]) =>
    mockFetchDesktopReleaseHistory(...args),
  isDesktopTauriRuntimeAvailable: () => mockIsDesktopTauriRuntimeAvailable(),
}));

import { DesktopReleaseHistoryDialog } from './DesktopReleaseHistoryDialog';

function createJsonFetchResponse(payload: unknown, status = 200) {
  const body = JSON.stringify(payload);

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type'
          ? 'application/json; charset=utf-8'
          : null,
    },
    text: async () => body,
    json: async () => payload,
  };
}

function createTextFetchResponse(
  body: string,
  {
    status = 200,
    contentType = 'text/html; charset=utf-8',
  }: {
    status?: number;
    contentType?: string;
  } = {}
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? contentType : null,
    },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

function createDesktopReleaseHistoryItems() {
  return [
    {
      id: 'release-200',
      version: '200.0.0',
      tagName: 'desktop-v200.0.0',
      name: 'Desktop 200',
      notes: null,
      prerelease: false,
      publishedAt: '2026-06-24T10:25:11Z',
      htmlUrl: 'https://example.com/desktop-200',
      manifestUrl: 'https://example.com/desktop-200/latest.json',
    },
    {
      id: 'beta-16',
      version: '200.0.0-beta.16',
      tagName: 'desktop-v200.0.0-beta.16',
      name: 'Beta 16',
      notes: null,
      prerelease: true,
      publishedAt: '2026-06-19T05:01:04Z',
      htmlUrl: 'https://example.com/beta-16',
      manifestUrl: 'https://example.com/beta-16/latest.json',
    },
    {
      id: 'beta-15',
      version: '200.0.0-beta.15',
      tagName: 'desktop-v200.0.0-beta.15',
      name: 'Beta 15',
      notes: null,
      prerelease: true,
      publishedAt: '2026-06-19T04:01:04Z',
      htmlUrl: 'https://example.com/beta-15',
      manifestUrl: 'https://example.com/beta-15/latest.json',
    },
    {
      id: 'beta-13',
      version: '200.0.0-beta.13',
      tagName: 'desktop-v200.0.0-beta.13',
      name: 'Beta 13',
      notes: null,
      prerelease: true,
      publishedAt: '2026-06-19T02:01:04Z',
      htmlUrl: 'https://example.com/beta-13',
      manifestUrl: 'https://example.com/beta-13/latest.json',
    },
  ];
}

function createGithubReleasePayload() {
  return [
    {
      id: 'release-200',
      tag_name: 'desktop-v200.0.0',
      name: 'Desktop 200',
      body: null,
      prerelease: false,
      published_at: '2026-06-24T10:25:11Z',
      html_url: 'https://example.com/desktop-200',
      assets: [
        {
          name: 'latest.json',
          browser_download_url: 'https://example.com/desktop-200/latest.json',
        },
      ],
    },
    {
      id: 'beta-16',
      tag_name: 'desktop-v200.0.0-beta.16',
      name: 'Beta 16',
      body: null,
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
      id: 'beta-15',
      tag_name: 'desktop-v200.0.0-beta.15',
      name: 'Beta 15',
      body: null,
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
      id: 'beta-13',
      tag_name: 'desktop-v200.0.0-beta.13',
      name: 'Beta 13',
      body: null,
      prerelease: true,
      published_at: '2026-06-19T02:01:04Z',
      html_url: 'https://example.com/beta-13',
      assets: [
        {
          name: 'latest.json',
          browser_download_url: 'https://example.com/beta-13/latest.json',
        },
      ],
    },
  ];
}

function createUpdateState(
  patch: Partial<AppUpdateState> = {}
): AppUpdateState {
  return {
    phase: 'idle',
    source: 'desktop-updater',
    updateStatus: null,
    currentVersion: '200.0.0-beta.16',
    latestVersion: null,
    downloadTargetKind: null,
    targetManifestUrl: null,
    lastDownloadInterruption: null,
    autoDownloadEnabled: false,
    canUseDesktopUpdater: true,
    canCheck: true,
    canDownload: false,
    canInstall: false,
    isChecking: false,
    isDownloading: false,
    isInstalling: false,
    isBusy: false,
    progressPercent: null,
    downloadedBytes: 0,
    totalBytes: null,
    publishedAt: null,
    releaseNotes: null,
    statusMessage: '',
    errorMessage: null,
    releasePageUrl: 'https://example.com/releases',
    ...patch,
  };
}

function renderDialog(
  props?: Partial<ComponentProps<typeof DesktopReleaseHistoryDialog>>
) {
  return render(
    <DesktopReleaseHistoryDialog
      isOpen={true}
      onClose={jest.fn()}
      currentVersion='200.0.0-beta.15'
      updateState={createUpdateState()}
      {...props}
    />
  );
}

describe('DesktopReleaseHistoryDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    mockInstallDesktopReleaseVersion.mockReset();
    mockOpenExternalUrl.mockReset();
    mockFetchDesktopReleaseHistory.mockReset();
    mockIsDesktopTauriRuntimeAvailable.mockReset();
    mockOpenExternalUrl.mockResolvedValue(undefined);
    mockFetchDesktopReleaseHistory.mockResolvedValue(
      createDesktopReleaseHistoryItems()
    );
    mockIsDesktopTauriRuntimeAvailable.mockReturnValue(true);
    delete window.RUNTIME_CONFIG;
    global.fetch = jest.fn(async () =>
      createJsonFetchResponse({
        releases: createDesktopReleaseHistoryItems(),
      })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete window.RUNTIME_CONFIG;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).fetch;
  });

  it('loads release history through the desktop shell in desktop mode', async () => {
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };

    renderDialog();

    expect(
      await screen.findByTestId('desktop-release-card-desktop-v200.0.0-beta.15')
    ).toBeInTheDocument();
    expect(mockFetchDesktopReleaseHistory).toHaveBeenCalledWith(
      'jaytantech3000/LunaTV'
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still prefers the desktop shell in desktop mode when a proxy is configured', async () => {
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
      DESKTOP_RELEASE_PROXY_BASE_URL: 'https://proxy.example.com/',
    };

    renderDialog({
      currentVersion: '200.0.0-beta.12',
    });

    expect(
      await screen.findByTestId('desktop-release-card-desktop-v200.0.0-beta.15')
    ).toBeInTheDocument();
    expect(mockFetchDesktopReleaseHistory).toHaveBeenCalledWith(
      'jaytantech3000/LunaTV'
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to the configured desktop proxy when the desktop shell request fails', async () => {
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
      DESKTOP_RELEASE_PROXY_BASE_URL: 'https://proxy.example.com/',
    };
    mockFetchDesktopReleaseHistory.mockRejectedValueOnce(
      new Error('network timeout')
    );
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValueOnce(
      createJsonFetchResponse({
        releases: [
          {
            id: 'beta-16',
            version: '200.0.0-beta.16',
            tagName: 'desktop-v200.0.0-beta.16',
            name: 'Beta 16',
            notes: null,
            prerelease: true,
            publishedAt: '2026-06-19T05:01:04Z',
            htmlUrl: 'https://example.com/beta-16',
            manifestUrl:
              'https://proxy.example.com/api/desktop/updater/latest?repo=jaytantech3000%2FLunaTV&tag=desktop-v200.0.0-beta.16',
          },
        ],
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDialog({
      currentVersion: '200.0.0-beta.12',
    });

    expect(
      await screen.findByTestId('desktop-release-card-desktop-v200.0.0-beta.16')
    ).toBeInTheDocument();
    expect(mockFetchDesktopReleaseHistory).toHaveBeenCalledWith(
      'jaytantech3000/LunaTV'
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://proxy.example.com/api/desktop/releases?repo=jaytantech3000%2FLunaTV',
      expect.objectContaining({
        cache: 'no-store',
      })
    );
  });

  it('falls back to GitHub when the desktop shell is unavailable and no proxy is configured', async () => {
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };
    mockIsDesktopTauriRuntimeAvailable.mockReturnValue(false);
    const fetchMock = jest.fn(async () =>
      createJsonFetchResponse(createGithubReleasePayload())
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDialog();

    expect(
      await screen.findByTestId('desktop-release-card-desktop-v200.0.0-beta.15')
    ).toBeInTheDocument();
    expect(mockFetchDesktopReleaseHistory).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/jaytantech3000/LunaTV/releases?per_page=100',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
        }),
      })
    );
  });

  it('falls back to GitHub when the route returns HTML', async () => {
    const fetchMock = jest.fn();
    fetchMock.mockResolvedValueOnce(
      createTextFetchResponse('<!DOCTYPE html><html></html>')
    );
    fetchMock.mockResolvedValueOnce(
      createJsonFetchResponse(createGithubReleasePayload())
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDialog();

    expect(
      await screen.findByTestId('desktop-release-card-desktop-v200.0.0-beta.15')
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/desktop/releases',
      expect.objectContaining({
        cache: 'no-store',
      })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/jaytantech3000/LunaTV/releases?per_page=100',
      expect.objectContaining({
        cache: 'no-store',
      })
    );
  });

  it('shows a current tag for the running version', async () => {
    renderDialog();

    const currentCard = await screen.findByTestId(
      'desktop-release-card-desktop-v200.0.0-beta.15'
    );

    expect(currentCard).toHaveTextContent('当前');
    expect(currentCard).toHaveTextContent('v200.0.0-beta.15');
  });

  it('shows compare-derived change summaries inside the release card', async () => {
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };
    const compareUrl =
      'https://github.com/jaytantech3000/LunaTV/compare/desktop-v200.0.0-beta.15...desktop-v200.0.0-beta.16';
    mockFetchDesktopReleaseHistory.mockResolvedValueOnce([
      {
        id: 'release-200',
        version: '200.0.0',
        tagName: 'desktop-v200.0.0',
        name: 'Desktop 200',
        notes: null,
        prerelease: false,
        publishedAt: '2026-06-24T10:25:11Z',
        htmlUrl: 'https://example.com/desktop-200',
        manifestUrl: 'https://example.com/desktop-200/latest.json',
      },
      {
        id: 'beta-16',
        version: '200.0.0-beta.16',
        tagName: 'desktop-v200.0.0-beta.16',
        name: 'Beta 16',
        notes: `**Full Changelog**: ${compareUrl}`,
        prerelease: true,
        publishedAt: '2026-06-19T05:01:04Z',
        htmlUrl: 'https://example.com/beta-16',
        manifestUrl: 'https://example.com/beta-16/latest.json',
      },
    ]);
    const fetchMock = jest.fn(async () =>
      createJsonFetchResponse({
        commits: [
          {
            commit: {
              message: 'feat: compact desktop release cards',
            },
          },
          {
            commit: {
              message: 'fix: avoid stale release compare cache',
            },
          },
        ],
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDialog({
      currentVersion: '200.0.0-beta.15',
    });

    const releaseCard = await screen.findByTestId(
      'desktop-release-card-desktop-v200.0.0-beta.16'
    );

    await waitFor(() => {
      expect(releaseCard).toHaveTextContent('本次变更');
      expect(releaseCard).toHaveTextContent('新增功能');
      expect(releaseCard).toHaveTextContent('compact desktop release cards');
      expect(releaseCard).toHaveTextContent('问题修复');
      expect(releaseCard).toHaveTextContent(
        'avoid stale release compare cache'
      );
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/jaytantech3000/LunaTV/compare/desktop-v200.0.0-beta.15...desktop-v200.0.0-beta.16',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
        }),
      })
    );
  });

  it('prefers localized changelog summaries when a release version matches the local changelog', async () => {
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };
    const compareUrl =
      'https://github.com/jaytantech3000/LunaTV/compare/desktop-v100.1.3...desktop-v200.0.0';
    mockFetchDesktopReleaseHistory.mockResolvedValueOnce([
      {
        id: 'release-200',
        version: '200.0.0',
        tagName: 'desktop-v200.0.0',
        name: 'Desktop 200',
        notes: `**Full Changelog**: ${compareUrl}`,
        prerelease: false,
        publishedAt: '2026-06-16T00:00:00Z',
        htmlUrl: 'https://example.com/desktop-200',
        manifestUrl: 'https://example.com/desktop-200/latest.json',
      },
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDialog({
      currentVersion: '100.1.3',
      changelogLocale: 'en',
    });

    const releaseCard = await screen.findByTestId(
      'desktop-release-card-desktop-v200.0.0'
    );

    await waitFor(() => {
      expect(releaseCard).toHaveTextContent('Changes');
      expect(releaseCard).toHaveTextContent(
        'Desktop versioning now starts from an independent 200.x line.'
      );
      expect(releaseCard).toHaveTextContent('Changed');
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('prefers prerelease compare summaries over unreleased stable changelog entries', async () => {
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };
    const compareUrl =
      'https://github.com/jaytantech3000/LunaTV/compare/desktop-v200.0.1-beta.4...desktop-v200.0.1-beta.5';
    mockFetchDesktopReleaseHistory.mockResolvedValueOnce([
      {
        id: 'beta-5',
        version: '200.0.1-beta.5',
        tagName: 'desktop-v200.0.1-beta.5',
        name: 'Beta 5',
        notes: `**Full Changelog**: ${compareUrl}`,
        prerelease: true,
        publishedAt: '2026-06-26T04:14:33Z',
        htmlUrl: 'https://example.com/beta-5',
        manifestUrl: 'https://example.com/beta-5/latest.json',
      },
    ]);
    const fetchMock = jest.fn(async () =>
      createJsonFetchResponse({
        commits: [
          {
            commit: {
              message: 'feat: add bilingual beta release summaries',
            },
          },
          {
            commit: {
              message: 'fix: avoid startup follow record toast',
            },
          },
        ],
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDialog({
      currentVersion: '200.0.1-beta.4',
      changelogLocale: 'zh-CN',
    });

    const releaseCard = await screen.findByTestId(
      'desktop-release-card-desktop-v200.0.1-beta.5'
    );

    await waitFor(() => {
      expect(releaseCard).toHaveTextContent(
        'add bilingual beta release summaries'
      );
      expect(releaseCard).toHaveTextContent(
        'avoid startup follow record toast'
      );
      expect(releaseCard).not.toHaveTextContent(
        '版本列表现优先参考本地变更日志摘要'
      );
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/jaytantech3000/LunaTV/compare/desktop-v200.0.1-beta.4...desktop-v200.0.1-beta.5',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
        }),
      })
    );
  });

  it('forwards changelog locale switch events', async () => {
    const onChangelogLocaleChange = jest.fn();

    renderDialog({
      changelogLocale: 'zh-CN',
      onChangelogLocaleChange,
    });

    await screen.findByTestId('desktop-release-card-desktop-v200.0.0-beta.15');

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(onChangelogLocaleChange).toHaveBeenCalledWith('en');
  });

  it('toggles favorite state and persists the release tag', async () => {
    renderDialog({
      currentVersion: '200.0.0-beta.12',
    });

    const favoriteButton = await screen.findByLabelText(
      '收藏 v200.0.0-beta.13'
    );
    fireEvent.click(favoriteButton);

    await waitFor(() => {
      expect(
        screen.getByLabelText('取消收藏 v200.0.0-beta.13')
      ).toBeInTheDocument();
    });

    expect(
      JSON.parse(
        localStorage.getItem('lunatv:desktop-release-history:favorites') || '[]'
      )
    ).toEqual(['desktop-v200.0.0-beta.13']);
  });

  it('moves favorited versions to the top of the prerelease section', async () => {
    renderDialog({
      currentVersion: '200.0.0-beta.12',
    });

    fireEvent.click(await screen.findByLabelText('收藏 v200.0.0-beta.13'));

    await waitFor(() => {
      const prereleaseCardOrder = screen
        .getAllByTestId(/desktop-release-card-/)
        .map((card) => card.getAttribute('data-testid') || '')
        .filter((testId) => testId.includes('beta'))
        .map((testId) => testId.replace('desktop-release-card-desktop-v', 'v'));

      expect(prereleaseCardOrder).toEqual([
        'v200.0.0-beta.13',
        'v200.0.0-beta.16',
        'v200.0.0-beta.15',
      ]);
    });
  });

  it('opens the selected release page through the shared external-url helper', async () => {
    renderDialog({
      currentVersion: '200.0.0-beta.12',
    });

    fireEvent.click(
      await screen.findByLabelText('打开 v200.0.0-beta.13 发布页')
    );

    await waitFor(() => {
      expect(mockOpenExternalUrl).toHaveBeenCalledWith(
        'https://example.com/beta-13'
      );
    });
  });

  it('opens a styled confirmation dialog and cancels without installing', async () => {
    const onClose = jest.fn();

    renderDialog({
      onClose,
      currentVersion: '200.0.0-beta.15',
    });

    fireEvent.click(
      await screen.findByLabelText('\u5207\u6362\u5230 v200.0.0-beta.16')
    );

    expect(
      await screen.findByTestId('desktop-release-confirm-dialog')
    ).toBeInTheDocument();
    expect(
      screen.getByText('\u786e\u8ba4\u5207\u6362\u7248\u672c')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '\u53d6\u6d88' }));

    await waitFor(() => {
      expect(
        screen.queryByTestId('desktop-release-confirm-dialog')
      ).not.toBeInTheDocument();
    });

    expect(mockInstallDesktopReleaseVersion).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('confirms rollback with the project dialog and installs the selected version', async () => {
    const onClose = jest.fn();

    renderDialog({
      onClose,
      currentVersion: '200.0.0-beta.16',
    });

    fireEvent.click(
      await screen.findByLabelText('\u56de\u9000\u5230 v200.0.0-beta.15')
    );

    expect(
      await screen.findByText('\u786e\u8ba4\u56de\u9000\u7248\u672c')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '\u786e\u8ba4\u56de\u9000' })
    );

    await waitFor(() => {
      expect(mockInstallDesktopReleaseVersion).toHaveBeenCalledWith({
        manifestUrl: 'https://example.com/beta-15/latest.json',
        version: '200.0.0-beta.15',
        publishedAt: '2026-06-19T04:01:04Z',
        releaseNotes: null,
      });
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
