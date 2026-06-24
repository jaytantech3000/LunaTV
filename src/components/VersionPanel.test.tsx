import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import type { AppUpdateState } from '@/lib/app-update';
import { UpdateStatus } from '@/lib/version_check';

const mockCancelActiveUpdateDownload = jest.fn();
const mockCheckForAppUpdates = jest.fn();
const mockDownloadLatestVersion = jest.fn();
const mockInstallDesktopReleaseVersion = jest.fn();
const mockInstallDownloadedUpdate = jest.fn();
const mockOpenExternalUrl = jest.fn();
const mockPauseActiveUpdateDownload = jest.fn();
const mockSetAutoDownloadEnabled = jest.fn();
const mockUseAppUpdateState = jest.fn();

jest.mock('@/lib/app-update', () => ({
  cancelActiveUpdateDownload: (...args: unknown[]) =>
    mockCancelActiveUpdateDownload(...args),
  checkForAppUpdates: (...args: unknown[]) => mockCheckForAppUpdates(...args),
  downloadLatestVersion: (...args: unknown[]) =>
    mockDownloadLatestVersion(...args),
  getAutoDownloadDescription: jest.fn(() => '自动下载说明'),
  installDesktopReleaseVersion: (...args: unknown[]) =>
    mockInstallDesktopReleaseVersion(...args),
  installDownloadedUpdate: (...args: unknown[]) =>
    mockInstallDownloadedUpdate(...args),
  isDesktopUpdaterAvailable: (state: {
    canUseDesktopUpdater: boolean;
    source: string;
  }) => state.canUseDesktopUpdater && state.source === 'desktop-updater',
  pauseActiveUpdateDownload: (...args: unknown[]) =>
    mockPauseActiveUpdateDownload(...args),
  setAutoDownloadEnabled: (...args: unknown[]) =>
    mockSetAutoDownloadEnabled(...args),
}));

jest.mock('@/lib/changelog', () => ({
  changelog: [
    {
      version: '200.0.0-beta.15',
      date: '2026-06-15',
      added: ['Local release note'],
      changed: [],
      fixed: [],
    },
  ],
  getLocalizedChangelogItems: (items: string[]) => items,
}));

jest.mock('@/lib/desktop-release', () => ({
  DESKTOP_UPSTREAM_VERSION: '100.1.3',
}));

jest.mock('@/lib/release-urls', () => ({
  getChangelogFileUrl: jest.fn(() => 'https://example.com/CHANGELOG'),
}));

jest.mock('@/lib/open-external-url', () => ({
  openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(() => ({
    APP_TARGET: 'desktop',
  })),
}));

jest.mock('@/lib/scroll-lock', () => ({
  acquireScrollLock: jest.fn(() => jest.fn()),
}));

jest.mock('@/lib/use-app-update', () => ({
  useAppUpdateState: () => mockUseAppUpdateState(),
}));

jest.mock('@/lib/version', () => ({
  CURRENT_VERSION: '200.0.0-beta.15',
}));

jest.mock('@/lib/version_check', () => ({
  UpdateStatus: {
    HAS_UPDATE: 'has_update',
    NO_UPDATE: 'no_update',
    FETCH_FAILED: 'fetch_failed',
  },
}));

jest.mock('@/components/CapsuleSwitch', () => ({
  __esModule: true,
  default: () => <div data-testid='capsule-switch' />,
}));

jest.mock('@/components/DesktopReleaseHistoryDialog', () => ({
  DesktopReleaseHistoryDialog: () => null,
}));

import { VersionPanel } from './VersionPanel';

function createUpdateState(
  patch: Partial<AppUpdateState> = {}
): AppUpdateState {
  return {
    phase: 'available',
    source: 'desktop-updater',
    updateStatus: UpdateStatus.HAS_UPDATE,
    currentVersion: '200.0.0-beta.15',
    latestVersion: '200.0.0-beta.16',
    downloadTargetKind: 'latest',
    targetManifestUrl: null,
    lastDownloadInterruption: null,
    autoDownloadEnabled: false,
    canUseDesktopUpdater: true,
    canCheck: true,
    canDownload: true,
    canInstall: false,
    isChecking: false,
    isDownloading: false,
    isInstalling: false,
    isBusy: false,
    progressPercent: null,
    downloadedBytes: 0,
    totalBytes: null,
    publishedAt: '2026-06-19T04:41:14Z',
    releaseNotes: null,
    statusMessage: '发现新版本，可直接下载最新版本。',
    errorMessage: null,
    releasePageUrl: 'https://example.com/releases',
    ...patch,
  };
}

describe('VersionPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    mockCancelActiveUpdateDownload.mockReset();
    mockCheckForAppUpdates.mockReset();
    mockDownloadLatestVersion.mockReset();
    mockInstallDesktopReleaseVersion.mockReset();
    mockInstallDownloadedUpdate.mockReset();
    mockOpenExternalUrl.mockReset();
    mockPauseActiveUpdateDownload.mockReset();
    mockSetAutoDownloadEnabled.mockReset();
    mockUseAppUpdateState.mockReset();
    mockPauseActiveUpdateDownload.mockResolvedValue(undefined);
    mockCancelActiveUpdateDownload.mockResolvedValue(undefined);
    mockOpenExternalUrl.mockResolvedValue(undefined);
    mockUseAppUpdateState.mockReturnValue(createUpdateState());
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '',
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).fetch;
  });

  it('renders release notes markdown as readable links and emphasis', async () => {
    const changelogUrl =
      'https://example.com/compare/desktop-v200.0.0-beta.15...desktop-v200.0.0-beta.16';

    mockUseAppUpdateState.mockReturnValue(
      createUpdateState({
        releaseNotes: `**Full Changelog**: ${changelogUrl}`,
      })
    );

    render(<VersionPanel isOpen={true} onClose={jest.fn()} />);

    expect(await screen.findByText('版本信息')).toBeInTheDocument();
    expect(screen.getByText('Full Changelog')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: changelogUrl })).toHaveAttribute(
      'href',
      changelogUrl
    );
  });

  it('keeps the progress UI visible while paused and swaps the primary control to continue', async () => {
    mockUseAppUpdateState.mockReturnValue(
      createUpdateState({
        phase: 'paused',
        canDownload: true,
        progressPercent: 42,
        downloadedBytes: 420,
        totalBytes: 1000,
        releaseNotes:
          '**Full Changelog**: https://example.com/compare/desktop-v200.0.0-beta.15...desktop-v200.0.0-beta.16',
        statusMessage: 'v200.0.0-beta.16 下载已暂停，可继续下载。',
      })
    );

    render(<VersionPanel isOpen={true} onClose={jest.fn()} />);

    const continueButton = await screen.findByLabelText('继续下载');
    const stopButton = screen.getByLabelText('停止下载');

    expect(screen.getByText('已下载 42%')).toBeInTheDocument();
    expect(screen.getByText('420 B / 1000 B')).toBeInTheDocument();
    expect(continueButton).toHaveClass('text-emerald-600');
    expect(stopButton).toHaveClass('text-rose-600');
    expect(screen.queryByText('继续下载最新版本')).not.toBeInTheDocument();
    expect(screen.queryByText('Full Changelog')).not.toBeInTheDocument();

    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(mockDownloadLatestVersion).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(stopButton);
    expect(
      await screen.findByRole('dialog', { name: '确认下载操作' })
    ).toBeInTheDocument();
  });

  it('pauses downloads immediately without opening a confirmation dialog', async () => {
    mockUseAppUpdateState.mockReturnValue(
      createUpdateState({
        phase: 'downloading',
        canDownload: false,
        isBusy: true,
        progressPercent: 42,
        downloadedBytes: 420,
        totalBytes: 1000,
        statusMessage: '正在下载最新版本...',
      })
    );

    render(<VersionPanel isOpen={true} onClose={jest.fn()} />);

    const pauseButton = await screen.findByLabelText('暂停下载');
    const stopButton = screen.getByLabelText('停止下载');

    expect(pauseButton).toHaveClass('text-amber-600');
    expect(stopButton).toHaveClass('text-rose-600');
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(mockPauseActiveUpdateDownload).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByRole('dialog', { name: '确认下载操作' })
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(stopButton).not.toBeDisabled();
    });
    fireEvent.click(stopButton);
    expect(
      await screen.findByRole('dialog', { name: '确认下载操作' })
    ).toBeInTheDocument();
  });

  it('shows a simplified stop confirmation dialog', async () => {
    mockUseAppUpdateState.mockReturnValue(
      createUpdateState({
        phase: 'downloading',
        canDownload: false,
        isBusy: true,
        latestVersion: '200.0.0-beta.20',
      })
    );

    render(<VersionPanel isOpen={true} onClose={jest.fn()} />);

    fireEvent.click(await screen.findByLabelText('停止下载'));

    const dialog = await screen.findByRole('dialog', {
      name: '确认下载操作',
    });
    const scoped = within(dialog);

    expect(scoped.getByText('下载目标')).toBeInTheDocument();
    expect(scoped.getByText('v200.0.0-beta.20')).toBeInTheDocument();
    expect(
      scoped.getByText(
        '当前下载进度会被清空。如果之后还要安装 v200.0.0-beta.20，需要从头重新下载。'
      )
    ).toBeInTheDocument();
    expect(scoped.queryByText('当前版本')).not.toBeInTheDocument();
    expect(scoped.queryByText('目标版本')).not.toBeInTheDocument();
    expect(scoped.queryByText('停止后会发生什么')).not.toBeInTheDocument();
  });

  it('opens the release page through the shared external-url helper', async () => {
    render(<VersionPanel isOpen={true} onClose={jest.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '打开发布页' }));

    await waitFor(() => {
      expect(mockOpenExternalUrl).toHaveBeenCalledWith(
        'https://example.com/releases'
      );
    });
  });
});
