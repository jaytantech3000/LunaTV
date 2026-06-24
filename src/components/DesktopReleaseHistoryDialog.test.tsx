'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';

import type { AppUpdateState } from '@/lib/app-update';

const mockInstallDesktopReleaseVersion = jest.fn();

jest.mock('@/lib/app-update', () => ({
  installDesktopReleaseVersion: (...args: unknown[]) =>
    mockInstallDesktopReleaseVersion(...args),
}));

jest.mock('@/lib/scroll-lock', () => ({
  acquireScrollLock: jest.fn(() => jest.fn()),
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

function createGithubReleasePayload() {
  return [
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
    delete window.RUNTIME_CONFIG;
    global.fetch = jest.fn(async () =>
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
        ],
      })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete window.RUNTIME_CONFIG;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).fetch;
  });

  it('loads release history from GitHub in desktop mode', async () => {
    window.RUNTIME_CONFIG = {
      APP_TARGET: 'desktop',
    };
    const fetchMock = jest.fn(async () =>
      createJsonFetchResponse(createGithubReleasePayload())
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDialog();

    expect(
      await screen.findByTestId('desktop-release-card-desktop-v200.0.0-beta.15')
    ).toBeInTheDocument();
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
      const versionHeadings = screen
        .getAllByRole('heading', { level: 4 })
        .map((heading) => heading.textContent || '')
        .filter((text) => text.startsWith('v'));

      expect(versionHeadings.slice(0, 3)).toEqual([
        'v200.0.0-beta.13',
        'v200.0.0-beta.16',
        'v200.0.0-beta.15',
      ]);
    });
  });
});
