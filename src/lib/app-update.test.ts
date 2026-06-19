jest.mock('@/lib/app-update-version', () => ({
  isNewerVersion: jest.fn(),
}));

jest.mock('@/lib/desktop/tauri-client', () => ({
  isDesktopTauriRuntimeAvailable: jest.fn(() => true),
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
  type AppUpdateState,
  DESKTOP_UPDATER_UNSUPPORTED_MESSAGE,
  getAutoDownloadDescription,
  getFriendlyDesktopUpdaterError,
  isDesktopUpdaterAvailable,
} from './app-update';
import { UpdateStatus } from './version_check';

function createState(
  patch: Partial<AppUpdateState> = {}
): AppUpdateState {
  return {
    phase: 'idle',
    source: 'remote',
    updateStatus: null,
    currentVersion: '200.0.0-beta.12',
    latestVersion: null,
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
});
