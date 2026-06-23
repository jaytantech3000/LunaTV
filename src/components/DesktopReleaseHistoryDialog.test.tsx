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
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
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
      }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).fetch;
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
