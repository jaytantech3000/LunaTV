const mockUpdaterCheck = jest.fn();

jest.mock('@/lib/app-update-version', () => ({
  isNewerVersion: jest.fn(),
}));

jest.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => mockUpdaterCheck(...args),
}));

jest.mock('@/lib/desktop/tauri-client', () => ({
  cancelActiveDesktopUpdateDownload: jest.fn(),
  clearPausedDesktopUpdateDownload: jest.fn(),
  downloadLatestDesktopUpdate: jest.fn(),
  installDesktopRelease: jest.fn(),
  installDownloadedDesktopUpdate: jest.fn(),
  isDesktopTauriRuntimeAvailable: jest.fn(() => true),
  pauseActiveDesktopUpdateDownload: jest.fn(),
}));

jest.mock('@/lib/release-urls', () => ({
  getReleasePageUrl: jest.fn(() => 'https://example.com/releases'),
}));

jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: jest.fn(() => ({
    APP_TARGET: 'desktop',
  })),
}));

jest.mock('@/lib/version', () => ({
  CURRENT_VERSION: '200.0.0-beta.12',
}));

jest.mock('@/lib/version_check', () => ({
  UpdateStatus: {
    HAS_UPDATE: 'has_update',
    NO_UPDATE: 'no_update',
    FETCH_FAILED: 'fetch_failed',
  },
  compareVersions: jest.fn(),
  fetchLatestRemoteVersion: jest.fn(),
}));

import {
  cancelActiveDesktopUpdateDownload,
  clearPausedDesktopUpdateDownload,
  downloadLatestDesktopUpdate,
  installDesktopRelease,
  pauseActiveDesktopUpdateDownload,
} from '@/lib/desktop/tauri-client';

import {
  type AppUpdateState,
  cancelActiveUpdateDownload,
  checkForAppUpdates,
  DESKTOP_UPDATER_UNSUPPORTED_MESSAGE,
  downloadLatestVersion,
  getAppUpdateState,
  getAutoDownloadDescription,
  getFriendlyDesktopUpdaterError,
  installDesktopReleaseVersion,
  isDesktopUpdaterAvailable,
  pauseActiveUpdateDownload,
  subscribeToAppUpdateState,
} from './app-update';
import { UpdateStatus } from './version_check';

function createDesktopUpdate(
  patch: Partial<Record<'version' | 'date' | 'body', string>> = {}
) {
  return {
    version: patch.version || '200.0.0-beta.13',
    currentVersion: '200.0.0-beta.12',
    date: patch.date,
    body: patch.body,
    download: jest.fn(),
    install: jest.fn(),
    close: jest.fn(async () => undefined),
  };
}

function createDeferredPromise() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createState(patch: Partial<AppUpdateState> = {}): AppUpdateState {
  return {
    phase: 'idle',
    source: 'remote',
    updateStatus: null,
    currentVersion: '200.0.0-beta.12',
    latestVersion: null,
    downloadTargetKind: null,
    targetManifestUrl: null,
    lastDownloadInterruption: null,
    autoDownloadEnabled: false,
    canUseDesktopUpdater: false,
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

describe('app update messaging helpers', () => {
  beforeEach(async () => {
    localStorage.clear();
    mockUpdaterCheck.mockReset();
    (
      cancelActiveDesktopUpdateDownload as jest.MockedFunction<
        typeof cancelActiveDesktopUpdateDownload
      >
    ).mockReset();
    (
      clearPausedDesktopUpdateDownload as jest.MockedFunction<
        typeof clearPausedDesktopUpdateDownload
      >
    ).mockReset();
    (
      downloadLatestDesktopUpdate as jest.MockedFunction<
        typeof downloadLatestDesktopUpdate
      >
    ).mockReset();
    (
      installDesktopRelease as jest.MockedFunction<typeof installDesktopRelease>
    ).mockReset();
    (
      pauseActiveDesktopUpdateDownload as jest.MockedFunction<
        typeof pauseActiveDesktopUpdateDownload
      >
    ).mockReset();
    mockUpdaterCheck.mockResolvedValue(null);
    (
      clearPausedDesktopUpdateDownload as jest.MockedFunction<
        typeof clearPausedDesktopUpdateDownload
      >
    ).mockResolvedValue(undefined);
    (
      pauseActiveDesktopUpdateDownload as jest.MockedFunction<
        typeof pauseActiveDesktopUpdateDownload
      >
    ).mockResolvedValue(undefined);
    await checkForAppUpdates({
      force: true,
      allowAutoDownload: false,
    });
    jest.clearAllMocks();
  });

  it('keeps generic updater failures out of the unsupported bucket', () => {
    expect(
      getFriendlyDesktopUpdaterError(
        new Error('updater request failed with HTTP 500')
      )
    ).toBe('检查更新失败，请稍后重试。');
  });

  it('marks missing updater endpoints as unsupported', () => {
    expect(
      getFriendlyDesktopUpdaterError(
        new Error('No updater endpoints configured for this target')
      )
    ).toBe(DESKTOP_UPDATER_UNSUPPORTED_MESSAGE);
  });

  it('shows manual download copy when only the remote update path is available', () => {
    const state = createState({
      phase: 'available',
      source: 'remote',
      updateStatus: UpdateStatus.HAS_UPDATE,
      latestVersion: '200.0.0-beta.13',
      errorMessage: DESKTOP_UPDATER_UNSUPPORTED_MESSAGE,
    });

    expect(isDesktopUpdaterAvailable(state)).toBe(false);
    expect(getAutoDownloadDescription(state)).toBe(
      '检测到新版本，但当前环境暂时只能前往发布页下载最新版。'
    );
  });

  it('keeps auto-download copy when the desktop updater is active', () => {
    const state = createState({
      phase: 'available',
      source: 'desktop-updater',
      updateStatus: UpdateStatus.HAS_UPDATE,
      latestVersion: '200.0.0-beta.13',
      canUseDesktopUpdater: true,
    });

    expect(isDesktopUpdaterAvailable(state)).toBe(true);
    expect(getAutoDownloadDescription(state)).toBe(
      '检测到新版本后自动下载最新版，安装仍需你手动确认。'
    );
  });

  it('describes a paused desktop download with the target version', () => {
    const state = createState({
      phase: 'paused',
      source: 'desktop-updater',
      updateStatus: UpdateStatus.HAS_UPDATE,
      latestVersion: '200.0.0-beta.13',
      downloadTargetKind: 'latest',
      canUseDesktopUpdater: true,
    });

    expect(getAutoDownloadDescription(state)).toBe(
      'v200.0.0-beta.13 下载已暂停，可继续下载。'
    );
  });

  it('describes a canceled release download with the target version', () => {
    const state = createState({
      phase: 'available',
      source: 'desktop-updater',
      updateStatus: UpdateStatus.HAS_UPDATE,
      latestVersion: '200.0.0-beta.10',
      downloadTargetKind: 'release',
      lastDownloadInterruption: 'canceled',
      canUseDesktopUpdater: true,
    });

    expect(getAutoDownloadDescription(state)).toBe(
      'v200.0.0-beta.10 下载已取消，可重新开始。'
    );
  });

  it('rechecks the updater state after stopping a latest-version download', async () => {
    const update = createDesktopUpdate({
      version: '200.0.0-beta.13',
      body: 'Latest release notes',
    });
    const deferred = createDeferredPromise();
    const mockedDownloadLatestDesktopUpdate =
      downloadLatestDesktopUpdate as jest.MockedFunction<
        typeof downloadLatestDesktopUpdate
      >;
    const mockedCancelActiveDesktopUpdateDownload =
      cancelActiveDesktopUpdateDownload as jest.MockedFunction<
        typeof cancelActiveDesktopUpdateDownload
      >;

    mockUpdaterCheck.mockResolvedValue(update);
    mockedDownloadLatestDesktopUpdate.mockImplementation(
      () => deferred.promise
    );
    mockedCancelActiveDesktopUpdateDownload.mockImplementation(async () => {
      deferred.reject(new Error('desktop update download canceled'));
    });

    await checkForAppUpdates({
      force: true,
      allowAutoDownload: false,
    });

    const phases: AppUpdateState['phase'][] = [];
    const unsubscribe = subscribeToAppUpdateState((nextState) => {
      phases.push(nextState.phase);
    });

    const activeDownloadPromise = downloadLatestVersion({
      skipTargetRefresh: true,
    });
    await Promise.resolve();
    await cancelActiveUpdateDownload();
    await activeDownloadPromise;
    unsubscribe();

    expect(getAppUpdateState()).toMatchObject({
      phase: 'available',
      source: 'desktop-updater',
      latestVersion: '200.0.0-beta.13',
      downloadTargetKind: 'latest',
      lastDownloadInterruption: null,
      canDownload: true,
      canInstall: false,
      errorMessage: null,
      statusMessage: '发现新版本，可直接下载最新版。',
    });
    expect(mockUpdaterCheck).toHaveBeenCalledTimes(2);
    expect(phases).not.toContain('checking');
  });

  it('returns release downloads to the base updater state after stopping', async () => {
    const deferred = createDeferredPromise();
    const update = createDesktopUpdate({
      version: '200.0.0-beta.13',
      body: 'Latest release notes',
    });
    const mockedInstallDesktopRelease =
      installDesktopRelease as jest.MockedFunction<
        typeof installDesktopRelease
      >;
    const mockedCancelActiveDesktopUpdateDownload =
      cancelActiveDesktopUpdateDownload as jest.MockedFunction<
        typeof cancelActiveDesktopUpdateDownload
      >;

    mockUpdaterCheck.mockResolvedValue(update);
    mockedInstallDesktopRelease.mockImplementation(
      async (_manifestUrl, _version, _onEvent) => deferred.promise
    );
    mockedCancelActiveDesktopUpdateDownload.mockImplementation(async () => {
      deferred.reject(new Error('desktop update download canceled'));
    });

    const activeInstallPromise = installDesktopReleaseVersion({
      manifestUrl: 'https://example.com/releases/beta-10/latest.json',
      version: '200.0.0-beta.10',
      publishedAt: '2026-06-10',
      releaseNotes: 'Pinned release notes',
    });
    await Promise.resolve();
    await cancelActiveUpdateDownload();
    await activeInstallPromise;

    expect(getAppUpdateState()).toMatchObject({
      phase: 'available',
      source: 'desktop-updater',
      latestVersion: '200.0.0-beta.13',
      downloadTargetKind: 'latest',
      targetManifestUrl: null,
      lastDownloadInterruption: null,
      canDownload: true,
      canInstall: false,
      errorMessage: null,
      statusMessage: '发现新版本，可直接下载最新版。',
    });
    expect(mockUpdaterCheck).toHaveBeenCalledTimes(1);
  });

  it('clears paused downloads before restoring the base updater state', async () => {
    const update = createDesktopUpdate({
      version: '200.0.0-beta.13',
      body: 'Latest release notes',
    });
    const deferred = createDeferredPromise();
    const mockedClearPausedDesktopUpdateDownload =
      clearPausedDesktopUpdateDownload as jest.MockedFunction<
        typeof clearPausedDesktopUpdateDownload
      >;
    const mockedDownloadLatestDesktopUpdate =
      downloadLatestDesktopUpdate as jest.MockedFunction<
        typeof downloadLatestDesktopUpdate
      >;
    const mockedPauseActiveDesktopUpdateDownload =
      pauseActiveDesktopUpdateDownload as jest.MockedFunction<
        typeof pauseActiveDesktopUpdateDownload
      >;

    mockUpdaterCheck.mockResolvedValue(update);
    mockedDownloadLatestDesktopUpdate.mockImplementation(
      () => deferred.promise
    );
    mockedPauseActiveDesktopUpdateDownload.mockImplementation(async () => {
      deferred.reject(new Error('desktop update download paused'));
    });

    await checkForAppUpdates({
      force: true,
      allowAutoDownload: false,
    });

    const activeDownloadPromise = downloadLatestVersion({
      skipTargetRefresh: true,
    });
    await Promise.resolve();
    await pauseActiveUpdateDownload();
    await activeDownloadPromise;

    expect(getAppUpdateState()).toMatchObject({
      phase: 'paused',
      latestVersion: '200.0.0-beta.13',
      downloadTargetKind: 'latest',
    });

    await cancelActiveUpdateDownload();

    expect(mockedClearPausedDesktopUpdateDownload).toHaveBeenCalledTimes(1);
    expect(getAppUpdateState()).toMatchObject({
      phase: 'available',
      source: 'desktop-updater',
      latestVersion: '200.0.0-beta.13',
      downloadTargetKind: 'latest',
      lastDownloadInterruption: null,
      canDownload: true,
      canInstall: false,
      progressPercent: null,
      downloadedBytes: 0,
      totalBytes: null,
      errorMessage: null,
      statusMessage: '发现新版本，可直接下载最新版。',
    });
  });
});
