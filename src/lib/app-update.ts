import { isDesktopTauriRuntimeAvailable } from '@/lib/desktop/tauri-client';
import { getReleasePageUrl } from '@/lib/release-urls';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { CURRENT_VERSION } from '@/lib/version';
import {
  compareVersions,
  fetchLatestRemoteVersion,
  UpdateStatus,
} from '@/lib/version_check';

const AUTO_DOWNLOAD_STORAGE_KEY = 'lunatv:desktop-updater:auto-download';
const RELEASE_PAGE_URL = getReleasePageUrl();

export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up_to_date'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export interface AppUpdateState {
  phase: AppUpdatePhase;
  source: 'desktop-updater' | 'remote';
  updateStatus: UpdateStatus | null;
  currentVersion: string;
  latestVersion: string | null;
  autoDownloadEnabled: boolean;
  canUseDesktopUpdater: boolean;
  canCheck: boolean;
  canDownload: boolean;
  canInstall: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  isBusy: boolean;
  progressPercent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  publishedAt: string | null;
  releaseNotes: string | null;
  statusMessage: string;
  errorMessage: string | null;
  releasePageUrl: string;
}

type AppUpdateListener = (state: AppUpdateState) => void;
type DesktopDownloadEvent =
  | {
      event: 'Started';
      data: {
        contentLength?: number;
      };
    }
  | {
      event: 'Progress';
      data: {
        chunkLength: number;
      };
    }
  | {
      event: 'Finished';
    };
type DesktopUpdaterHandle = {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
  download(onEvent?: (event: DesktopDownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
  close?(): Promise<void>;
};

let state: AppUpdateState = createInitialState();
const listeners = new Set<AppUpdateListener>();
let pendingUpdate: DesktopUpdaterHandle | null = null;
let backgroundCheckStarted = false;
let checkPromise: Promise<AppUpdateState> | null = null;
let downloadPromise: Promise<AppUpdateState> | null = null;
let installPromise: Promise<void> | null = null;

function createInitialState(): AppUpdateState {
  return {
    phase: 'idle',
    source: 'remote',
    updateStatus: null,
    currentVersion: CURRENT_VERSION,
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
    releasePageUrl: RELEASE_PAGE_URL,
  };
}

function emitState() {
  listeners.forEach((listener) => {
    listener(state);
  });
}

function patchState(patch: Partial<AppUpdateState>) {
  state = {
    ...state,
    ...patch,
  };
  emitState();
}

function isDesktopTarget() {
  return getRuntimeConfig().APP_TARGET === 'desktop';
}

function readAutoDownloadPreference() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(AUTO_DOWNLOAD_STORAGE_KEY) === '1';
}

function persistAutoDownloadPreference(enabled: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  if (enabled) {
    window.localStorage.setItem(AUTO_DOWNLOAD_STORAGE_KEY, '1');
  } else {
    window.localStorage.removeItem(AUTO_DOWNLOAD_STORAGE_KEY);
  }
}

function clearPendingUpdate() {
  const currentUpdate = pendingUpdate;
  pendingUpdate = null;
  if (currentUpdate?.close) {
    void currentUpdate.close().catch(() => {
      // Ignore updater resource cleanup failures.
    });
  }
}

function getFriendlyDesktopUpdaterError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : '';
  const normalized = message.toLowerCase();

  if (!normalized) {
    return '检查更新失败，请稍后重试。';
  }

  if (
    normalized.includes('pubkey') ||
    normalized.includes('endpoint') ||
    normalized.includes('updater') ||
    normalized.includes('configuration')
  ) {
    return '当前桌面构建未配置应用内更新源。';
  }

  if (normalized.includes('tls') || normalized.includes('https')) {
    return '更新源连接失败，请检查更新地址或 HTTPS 配置。';
  }

  return '检查更新失败，请稍后重试。';
}

function getDownloadProgressState(
  downloadedBytes: number,
  totalBytes: number | null
) {
  if (!totalBytes || totalBytes <= 0) {
    return null;
  }

  return Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
}

function buildRemoteState(
  remoteVersion: string | null,
  desktopUpdaterErrorMessage?: string | null
) {
  if (!remoteVersion) {
    return {
      phase: 'error' as const,
      source: 'remote' as const,
      updateStatus: UpdateStatus.FETCH_FAILED,
      latestVersion: null,
      canUseDesktopUpdater: false,
      canDownload: false,
      canInstall: false,
      publishedAt: null,
      releaseNotes: null,
      progressPercent: null,
      downloadedBytes: 0,
      totalBytes: null,
      statusMessage: desktopUpdaterErrorMessage || '暂时无法获取最新版本信息。',
      errorMessage: desktopUpdaterErrorMessage || '暂时无法获取最新版本信息。',
    };
  }

  const updateStatus = compareVersions(remoteVersion, CURRENT_VERSION);
  const hasUpdate = updateStatus === UpdateStatus.HAS_UPDATE;

  return {
    phase: hasUpdate ? ('available' as const) : ('up_to_date' as const),
    source: 'remote' as const,
    updateStatus,
    latestVersion: hasUpdate ? remoteVersion : CURRENT_VERSION,
    canUseDesktopUpdater: false,
    canDownload: false,
    canInstall: false,
    publishedAt: null,
    releaseNotes: null,
    progressPercent: null,
    downloadedBytes: 0,
    totalBytes: null,
    statusMessage: hasUpdate
      ? desktopUpdaterErrorMessage || '发现新版本，但当前环境不支持应用内下载。'
      : '当前已是最新版本。',
    errorMessage: desktopUpdaterErrorMessage || null,
  };
}

async function checkRemoteUpdates(desktopUpdaterErrorMessage?: string | null) {
  const remoteVersion = await fetchLatestRemoteVersion();
  const remoteState = buildRemoteState(
    remoteVersion,
    desktopUpdaterErrorMessage || null
  );

  patchState({
    ...remoteState,
    autoDownloadEnabled: readAutoDownloadPreference(),
    canCheck: true,
    isChecking: false,
    isDownloading: false,
    isInstalling: false,
    isBusy: false,
  });

  return state;
}

async function checkDesktopUpdates(allowAutoDownload: boolean) {
  const { check } = await import('@tauri-apps/plugin-updater');

  const nextUpdate = await check();
  clearPendingUpdate();

  if (!nextUpdate) {
    patchState({
      phase: 'up_to_date',
      source: 'desktop-updater',
      updateStatus: UpdateStatus.NO_UPDATE,
      latestVersion: CURRENT_VERSION,
      autoDownloadEnabled: readAutoDownloadPreference(),
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
      statusMessage: '当前已是最新版本。',
      errorMessage: null,
    });

    return state;
  }

  pendingUpdate = nextUpdate;
  patchState({
    phase: 'available',
    source: 'desktop-updater',
    updateStatus: UpdateStatus.HAS_UPDATE,
    latestVersion: nextUpdate.version,
    autoDownloadEnabled: readAutoDownloadPreference(),
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
    publishedAt: nextUpdate.date || null,
    releaseNotes: nextUpdate.body?.trim() || null,
    statusMessage: '发现新版本，可立即下载。',
    errorMessage: null,
  });

  if (allowAutoDownload && readAutoDownloadPreference()) {
    return downloadLatestVersion();
  }

  return state;
}

export function getAppUpdateState() {
  return state;
}

export function subscribeToAppUpdateState(listener: AppUpdateListener) {
  listeners.add(listener);
  listener(state);

  return () => {
    listeners.delete(listener);
  };
}

export async function checkForAppUpdates(options?: {
  force?: boolean;
  allowAutoDownload?: boolean;
}) {
  if (checkPromise && !options?.force) {
    return checkPromise;
  }

  const nextPromise = (async () => {
    patchState({
      phase: 'checking',
      autoDownloadEnabled: readAutoDownloadPreference(),
      canCheck: true,
      canDownload: false,
      canInstall: false,
      isChecking: true,
      isDownloading: false,
      isInstalling: false,
      isBusy: true,
      progressPercent: null,
      downloadedBytes: 0,
      totalBytes: null,
      statusMessage: '正在检查更新...',
      errorMessage: null,
    });

    if (!isDesktopTarget() || !isDesktopTauriRuntimeAvailable()) {
      return checkRemoteUpdates();
    }

    try {
      return await checkDesktopUpdates(options?.allowAutoDownload !== false);
    } catch (error) {
      clearPendingUpdate();
      return checkRemoteUpdates(getFriendlyDesktopUpdaterError(error));
    }
  })();

  checkPromise = nextPromise;

  try {
    return await nextPromise;
  } finally {
    if (checkPromise === nextPromise) {
      checkPromise = null;
    }
  }
}

export async function downloadLatestVersion() {
  if (downloadPromise) {
    return downloadPromise;
  }

  const nextPromise = (async () => {
    if (!pendingUpdate) {
      await checkForAppUpdates({
        force: true,
        allowAutoDownload: false,
      });
    }

    if (!pendingUpdate || !state.canUseDesktopUpdater) {
      patchState({
        phase: 'error',
        canDownload: false,
        canInstall: false,
        isChecking: false,
        isDownloading: false,
        isInstalling: false,
        isBusy: false,
        statusMessage: '当前环境无法直接下载更新包。',
        errorMessage: '当前环境无法直接下载更新包。',
      });
      return state;
    }

    let downloadedBytes = 0;
    let totalBytes: number | null = null;

    patchState({
      phase: 'downloading',
      source: 'desktop-updater',
      updateStatus: UpdateStatus.HAS_UPDATE,
      latestVersion: pendingUpdate.version,
      canUseDesktopUpdater: true,
      canCheck: true,
      canDownload: false,
      canInstall: false,
      isChecking: false,
      isDownloading: true,
      isInstalling: false,
      isBusy: true,
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      statusMessage: '正在下载更新包...',
      errorMessage: null,
    });

    try {
      await pendingUpdate.download((event: DesktopDownloadEvent) => {
        switch (event.event) {
          case 'Started':
            totalBytes = event.data.contentLength ?? null;
            downloadedBytes = 0;
            patchState({
              progressPercent: 0,
              downloadedBytes,
              totalBytes,
            });
            break;
          case 'Progress':
            downloadedBytes += event.data.chunkLength;
            patchState({
              progressPercent: getDownloadProgressState(
                downloadedBytes,
                totalBytes
              ),
              downloadedBytes,
              totalBytes,
            });
            break;
          case 'Finished':
            patchState({
              progressPercent: totalBytes ? 100 : state.progressPercent,
            });
            break;
          default:
            break;
        }
      });

      patchState({
        phase: 'downloaded',
        canCheck: true,
        canDownload: false,
        canInstall: true,
        isChecking: false,
        isDownloading: false,
        isInstalling: false,
        isBusy: false,
        progressPercent: totalBytes ? 100 : state.progressPercent,
        downloadedBytes,
        totalBytes,
        statusMessage: '更新包已下载，可立即安装并重启。',
        errorMessage: null,
      });
    } catch (error) {
      patchState({
        phase: 'available',
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
        statusMessage: '下载更新包失败，请重试。',
        errorMessage:
          error instanceof Error ? error.message : '下载更新包失败，请重试。',
      });
    }

    return state;
  })();

  downloadPromise = nextPromise;

  try {
    return await nextPromise;
  } finally {
    if (downloadPromise === nextPromise) {
      downloadPromise = null;
    }
  }
}

export async function installDownloadedUpdate() {
  if (installPromise) {
    await installPromise;
    return;
  }

  const nextPromise = (async () => {
    if (!pendingUpdate || state.phase !== 'downloaded') {
      patchState({
        phase: 'error',
        canInstall: false,
        isChecking: false,
        isDownloading: false,
        isInstalling: false,
        isBusy: false,
        statusMessage: '请先下载更新包，再执行安装。',
        errorMessage: '请先下载更新包，再执行安装。',
      });
      return;
    }

    patchState({
      phase: 'installing',
      canCheck: false,
      canDownload: false,
      canInstall: false,
      isChecking: false,
      isDownloading: false,
      isInstalling: true,
      isBusy: true,
      statusMessage: '正在安装更新并准备重启...',
      errorMessage: null,
    });

    try {
      await pendingUpdate.install();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      patchState({
        phase: 'downloaded',
        canCheck: true,
        canDownload: false,
        canInstall: true,
        isChecking: false,
        isDownloading: false,
        isInstalling: false,
        isBusy: false,
        statusMessage: '安装更新失败，请重试。',
        errorMessage:
          error instanceof Error ? error.message : '安装更新失败，请重试。',
      });
    }
  })();

  installPromise = nextPromise;

  try {
    await nextPromise;
  } finally {
    if (installPromise === nextPromise) {
      installPromise = null;
    }
  }
}

export function setAutoDownloadEnabled(enabled: boolean) {
  persistAutoDownloadPreference(enabled);
  patchState({
    autoDownloadEnabled: enabled,
  });

  if (
    enabled &&
    state.canUseDesktopUpdater &&
    state.phase === 'available' &&
    !state.isBusy
  ) {
    void downloadLatestVersion();
  }
}

export function ensureBackgroundUpdateCheck() {
  if (backgroundCheckStarted) {
    return;
  }

  backgroundCheckStarted = true;
  patchState({
    autoDownloadEnabled: readAutoDownloadPreference(),
  });
  void checkForAppUpdates({
    allowAutoDownload: true,
  });
}
