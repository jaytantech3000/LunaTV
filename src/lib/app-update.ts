import { isNewerVersion } from '@/lib/app-update-version';
import {
  type DesktopReleaseInstallEvent,
  cancelActiveDesktopUpdateDownload,
  clearPausedDesktopUpdateDownload,
  downloadLatestDesktopUpdate,
  installDesktopRelease,
  installDownloadedDesktopUpdate,
  isDesktopTauriRuntimeAvailable,
  pauseActiveDesktopUpdateDownload,
} from '@/lib/desktop/tauri-client';
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
export const DESKTOP_UPDATER_UNSUPPORTED_MESSAGE =
  '当前版本暂不支持应用内更新。';
export const DESKTOP_UPDATER_CONNECTION_MESSAGE =
  '更新源连接失败，请稍后重试。';
export const DESKTOP_UPDATER_CHECK_FAILED_MESSAGE =
  '检查更新失败，请稍后重试。';

export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up_to_date'
  | 'downloading'
  | 'paused'
  | 'downloaded'
  | 'installing'
  | 'error';

export type AppUpdateDownloadTargetKind = 'latest' | 'release';
export type AppUpdateDownloadInterruption = 'paused' | 'canceled';

export interface AppUpdateState {
  phase: AppUpdatePhase;
  source: 'desktop-updater' | 'remote';
  updateStatus: UpdateStatus | null;
  currentVersion: string;
  latestVersion: string | null;
  downloadTargetKind: AppUpdateDownloadTargetKind | null;
  targetManifestUrl: string | null;
  lastDownloadInterruption: AppUpdateDownloadInterruption | null;
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
type DesktopDownloadEvent = DesktopReleaseInstallEvent;
type DesktopUpdaterHandle = {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
  download(onEvent?: (event: DesktopDownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
  close?(): Promise<void>;
};

type RefreshDesktopUpdateTargetResult = 'unchanged' | 'refreshed' | 'blocked';

interface DownloadLatestVersionOptions {
  skipTargetRefresh?: boolean;
}

export interface InstallDesktopReleaseVersionOptions {
  manifestUrl: string;
  version: string;
  publishedAt?: string | null;
  releaseNotes?: string | null;
}

let state: AppUpdateState = createInitialState();
const listeners = new Set<AppUpdateListener>();
let pendingUpdate: DesktopUpdaterHandle | null = null;
let downloadedUpdate: DesktopUpdaterHandle | null = null;
let backgroundCheckStarted = false;
let checkPromise: Promise<AppUpdateState> | null = null;
let downloadPromise: Promise<AppUpdateState> | null = null;
let installPromise: Promise<void> | null = null;
let pendingDownloadControlAction: AppUpdateDownloadInterruption | null = null;

function createInitialState(): AppUpdateState {
  return {
    phase: 'idle',
    source: 'remote',
    updateStatus: null,
    currentVersion: CURRENT_VERSION,
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

function closeUpdateHandle(update: DesktopUpdaterHandle | null) {
  if (!update?.close) {
    return;
  }

  void update.close().catch(() => {
    // Ignore updater resource cleanup failures.
  });
}

function clearPendingUpdate() {
  const currentUpdate = pendingUpdate;
  pendingUpdate = null;
  if (currentUpdate === downloadedUpdate) {
    return;
  }

  closeUpdateHandle(currentUpdate);
}

function setDownloadedUpdate(nextUpdate: DesktopUpdaterHandle | null) {
  if (downloadedUpdate === nextUpdate) {
    return;
  }

  const previousUpdate = downloadedUpdate;
  downloadedUpdate = nextUpdate;

  if (previousUpdate === pendingUpdate) {
    return;
  }

  closeUpdateHandle(previousUpdate);
}

function isDownloadedUpdateReady(version?: string | null) {
  if (!downloadedUpdate) {
    return false;
  }

  return !version || downloadedUpdate.version === version;
}

function isMissingUpdaterConfiguration(normalized: string) {
  return (
    normalized.includes('pubkey') ||
    normalized.includes('no updater endpoints') ||
    normalized.includes('missing updater endpoint') ||
    (normalized.includes('updater endpoint') &&
      normalized.includes('not configured')) ||
    (normalized.includes('updater endpoints') &&
      normalized.includes('not configured')) ||
    (normalized.includes('updater configuration') &&
      normalized.includes('not configured')) ||
    normalized.includes('missing required updater configuration') ||
    normalized.includes('plugin-updater is not initialized') ||
    normalized.includes('updater plugin is not initialized') ||
    normalized.includes('updater disabled')
  );
}

function isUpdaterTransportError(normalized: string) {
  return (
    normalized.includes('tls') ||
    normalized.includes('certificate') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('connection refused') ||
    normalized.includes('network') ||
    normalized.includes('dns')
  );
}

export function getFriendlyDesktopUpdaterError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : '';
  const normalized = message.toLowerCase();

  if (!normalized) {
    return DESKTOP_UPDATER_CHECK_FAILED_MESSAGE;
  }

  if (isMissingUpdaterConfiguration(normalized)) {
    return DESKTOP_UPDATER_UNSUPPORTED_MESSAGE;
  }

  if (isUpdaterTransportError(normalized)) {
    return DESKTOP_UPDATER_CONNECTION_MESSAGE;
  }

  return DESKTOP_UPDATER_CHECK_FAILED_MESSAGE;
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

function getVersionLabel(version: string | null | undefined) {
  return version ? `v${version}` : '目标版本';
}

function buildPausedDownloadMessage(version: string | null | undefined) {
  return `${getVersionLabel(version)} 下载已暂停，可继续下载。`;
}

function buildCanceledDownloadMessage(version: string | null | undefined) {
  return `${getVersionLabel(version)} 下载已取消，可重新开始。`;
}

function applyPausedDownloadState(patch: {
  version: string | null;
  targetKind: AppUpdateDownloadTargetKind | null;
  manifestUrl?: string | null;
  publishedAt?: string | null;
  releaseNotes?: string | null;
  downloadedBytes?: number;
  totalBytes?: number | null;
}) {
  const downloadedBytes = Math.max(0, patch.downloadedBytes ?? 0);
  const totalBytes = patch.totalBytes ?? null;

  patchState({
    phase: 'paused',
    source: 'desktop-updater',
    updateStatus: UpdateStatus.HAS_UPDATE,
    latestVersion: patch.version,
    downloadTargetKind: patch.targetKind,
    targetManifestUrl: patch.manifestUrl || null,
    lastDownloadInterruption: 'paused',
    canUseDesktopUpdater: true,
    canCheck: true,
    canDownload: true,
    canInstall: false,
    isChecking: false,
    isDownloading: false,
    isInstalling: false,
    isBusy: false,
    progressPercent: getDownloadProgressState(downloadedBytes, totalBytes),
    downloadedBytes,
    totalBytes,
    publishedAt: patch.publishedAt || null,
    releaseNotes: patch.releaseNotes || null,
    statusMessage: buildPausedDownloadMessage(patch.version),
    errorMessage: null,
  });
}

function consumePendingDownloadControlAction() {
  const action = pendingDownloadControlAction;
  pendingDownloadControlAction = null;
  return action;
}

function applyDownloadedDesktopUpdateState(
  nextUpdate: DesktopUpdaterHandle,
  autoDownloadEnabled: boolean
) {
  if (downloadedUpdate && downloadedUpdate !== nextUpdate) {
    closeUpdateHandle(nextUpdate);
  }

  patchState({
    phase: 'downloaded',
    source: 'desktop-updater',
    updateStatus: UpdateStatus.HAS_UPDATE,
    latestVersion: nextUpdate.version,
    downloadTargetKind: 'latest',
    targetManifestUrl: null,
    lastDownloadInterruption: null,
    autoDownloadEnabled,
    canUseDesktopUpdater: true,
    canCheck: true,
    canDownload: false,
    canInstall: true,
    isChecking: false,
    isDownloading: false,
    isInstalling: false,
    isBusy: false,
    progressPercent: state.progressPercent ?? 100,
    downloadedBytes: state.downloadedBytes,
    totalBytes: state.totalBytes,
    publishedAt: nextUpdate.date || downloadedUpdate?.date || null,
    releaseNotes:
      nextUpdate.body?.trim() || downloadedUpdate?.body?.trim() || null,
    statusMessage: autoDownloadEnabled
      ? '最新版已自动下载，点击安装即可。'
      : '最新版已下载，点击安装即可。',
    errorMessage: null,
  });
}

function applyAvailableDesktopUpdateState(
  nextUpdate: DesktopUpdaterHandle,
  autoDownloadEnabled: boolean
) {
  setDownloadedUpdate(null);
  pendingUpdate = nextUpdate;
  patchState({
    phase: 'available',
    source: 'desktop-updater',
    updateStatus: UpdateStatus.HAS_UPDATE,
    latestVersion: nextUpdate.version,
    downloadTargetKind: 'latest',
    targetManifestUrl: null,
    lastDownloadInterruption: null,
    autoDownloadEnabled,
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
    statusMessage: '发现新版本，可直接下载最新版。',
    errorMessage: null,
  });
}

async function refreshDesktopUpdateTargetIfNeeded(
  referenceVersion: string | null,
  action: 'download' | 'install'
): Promise<RefreshDesktopUpdateTargetResult> {
  if (!referenceVersion || !state.canUseDesktopUpdater) {
    return 'unchanged';
  }

  const remoteVersion = await fetchLatestRemoteVersion();
  if (!isNewerVersion(remoteVersion, referenceVersion)) {
    return 'unchanged';
  }

  const autoDownloadEnabled = readAutoDownloadPreference();
  const blockedMessage =
    action === 'install'
      ? `检测到更新后的新版本 v${remoteVersion}，已停止安装旧版本，请先下载最新版。`
      : `检测到更新后的新版本 v${remoteVersion}，请稍后重试或前往发布页下载最新版。`;

  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const nextUpdate = await check();
    const updaterHasLatestVersion =
      nextUpdate && !isNewerVersion(remoteVersion, nextUpdate.version);

    if (!nextUpdate || !updaterHasLatestVersion) {
      closeUpdateHandle(nextUpdate || null);
      patchState({
        phase: 'error',
        source: 'desktop-updater',
        updateStatus: UpdateStatus.HAS_UPDATE,
        latestVersion: remoteVersion,
        downloadTargetKind: null,
        targetManifestUrl: null,
        lastDownloadInterruption: null,
        autoDownloadEnabled,
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
        statusMessage: blockedMessage,
        errorMessage: blockedMessage,
      });
      return 'blocked';
    }

    clearPendingUpdate();
    applyAvailableDesktopUpdateState(nextUpdate, autoDownloadEnabled);
    patchState({
      statusMessage:
        action === 'install'
          ? `检测到更新后的新版本 v${nextUpdate.version}，正在改为下载最新版。`
          : `检测到更新后的新版本 v${nextUpdate.version}，已切换为最新版。`,
    });

    return 'refreshed';
  } catch (_) {
    patchState({
      phase: 'error',
      source: 'desktop-updater',
      updateStatus: UpdateStatus.HAS_UPDATE,
      latestVersion: remoteVersion,
      downloadTargetKind: null,
      targetManifestUrl: null,
      lastDownloadInterruption: null,
      autoDownloadEnabled,
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
      statusMessage: blockedMessage,
      errorMessage: blockedMessage,
    });
    return 'blocked';
  }
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
      downloadTargetKind: null,
      targetManifestUrl: null,
      lastDownloadInterruption: null,
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
  const fallbackStatusMessage = hasUpdate
    ? desktopUpdaterErrorMessage === DESKTOP_UPDATER_UNSUPPORTED_MESSAGE
      ? '检测到新版本，但当前版本暂不支持应用内更新，请打开发布页下载最新版。'
      : desktopUpdaterErrorMessage === DESKTOP_UPDATER_CONNECTION_MESSAGE
      ? '检测到新版本，但应用内更新暂时不可用，请打开发布页下载最新版或稍后重试。'
      : desktopUpdaterErrorMessage
      ? '检测到新版本，但应用内更新检查未完成，请打开发布页下载最新版。'
      : '发现新版本，请打开发布页下载最新版。'
    : '当前已是最新版本。';

  return {
    phase: hasUpdate ? ('available' as const) : ('up_to_date' as const),
    source: 'remote' as const,
    updateStatus,
    latestVersion: hasUpdate ? remoteVersion : CURRENT_VERSION,
    downloadTargetKind: null,
    targetManifestUrl: null,
    lastDownloadInterruption: null,
    canUseDesktopUpdater: false,
    canDownload: false,
    canInstall: false,
    publishedAt: null,
    releaseNotes: null,
    progressPercent: null,
    downloadedBytes: 0,
    totalBytes: null,
    statusMessage: fallbackStatusMessage,
    errorMessage: hasUpdate ? desktopUpdaterErrorMessage || null : null,
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

export function isDesktopUpdaterAvailable(
  updateState: Pick<AppUpdateState, 'canUseDesktopUpdater' | 'source'>
) {
  return (
    updateState.canUseDesktopUpdater && updateState.source === 'desktop-updater'
  );
}

export function getAutoDownloadDescription(
  updateState: Pick<
    AppUpdateState,
    | 'autoDownloadEnabled'
    | 'canUseDesktopUpdater'
    | 'downloadTargetKind'
    | 'errorMessage'
    | 'lastDownloadInterruption'
    | 'latestVersion'
    | 'phase'
    | 'source'
    | 'updateStatus'
  >
) {
  const desktopUpdaterAvailable = isDesktopUpdaterAvailable(updateState);
  const isAutoDownloadInProgress =
    desktopUpdaterAvailable &&
    updateState.autoDownloadEnabled &&
    updateState.phase === 'downloading';
  const hasAutoDownloadedUpdate =
    desktopUpdaterAvailable &&
    updateState.autoDownloadEnabled &&
    updateState.phase === 'downloaded';
  const isAutoInstallingUpdate =
    desktopUpdaterAvailable &&
    updateState.autoDownloadEnabled &&
    updateState.phase === 'installing';

  if (isAutoDownloadInProgress) {
    return '正在自动下载最新版，完成后可直接安装。';
  }

  if (desktopUpdaterAvailable && updateState.phase === 'paused') {
    return buildPausedDownloadMessage(updateState.latestVersion);
  }

  if (
    desktopUpdaterAvailable &&
    updateState.lastDownloadInterruption === 'canceled'
  ) {
    return buildCanceledDownloadMessage(updateState.latestVersion);
  }

  if (isAutoInstallingUpdate) {
    return '正在安装更新，请稍候。';
  }

  if (hasAutoDownloadedUpdate) {
    return '最新版已自动下载完成，点击上方安装即可。';
  }

  if (desktopUpdaterAvailable) {
    return '检测到新版本后自动下载最新版，安装仍需你手动确认。';
  }

  if (updateState.updateStatus === UpdateStatus.HAS_UPDATE) {
    return '检测到新版本，但当前环境暂时只能前往发布页下载最新版。';
  }

  if (updateState.errorMessage === DESKTOP_UPDATER_UNSUPPORTED_MESSAGE) {
    return '当前版本暂不支持应用内更新，请前往发布页获取后续版本。';
  }

  return '当前环境暂时不能使用应用内更新，可稍后重新检查。';
}

async function checkDesktopUpdates(allowAutoDownload: boolean) {
  const { check } = await import('@tauri-apps/plugin-updater');

  const nextUpdate = await check();
  clearPendingUpdate();
  const autoDownloadEnabled = readAutoDownloadPreference();

  if (!nextUpdate) {
    setDownloadedUpdate(null);
    patchState({
      phase: 'up_to_date',
      source: 'desktop-updater',
      updateStatus: UpdateStatus.NO_UPDATE,
      latestVersion: CURRENT_VERSION,
      autoDownloadEnabled,
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

  if (isDownloadedUpdateReady(nextUpdate.version)) {
    applyDownloadedDesktopUpdateState(nextUpdate, autoDownloadEnabled);

    return state;
  }

  applyAvailableDesktopUpdateState(nextUpdate, autoDownloadEnabled);

  if (allowAutoDownload && readAutoDownloadPreference()) {
    return downloadLatestVersion({
      skipTargetRefresh: true,
    });
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
  silent?: boolean;
  skipInFlightGuards?: boolean;
}) {
  if (!options?.skipInFlightGuards) {
    if (state.phase === 'downloading' && downloadPromise) {
      return downloadPromise;
    }

    if (state.phase === 'downloading' && installPromise) {
      await installPromise;
      return state;
    }

    if (state.phase === 'installing' && installPromise) {
      await installPromise;
      return state;
    }
  }

  if (checkPromise && !options?.force) {
    return checkPromise;
  }

  const nextPromise = (async () => {
    if (!options?.silent) {
      patchState({
        phase: 'checking',
        downloadTargetKind: null,
        targetManifestUrl: null,
        lastDownloadInterruption: null,
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
    }

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

export async function downloadLatestVersion(
  options?: DownloadLatestVersionOptions
) {
  if (downloadPromise) {
    return downloadPromise;
  }

  const nextPromise = (async () => {
    if (!options?.skipTargetRefresh) {
      const refreshResult = await refreshDesktopUpdateTargetIfNeeded(
        pendingUpdate?.version || downloadedUpdate?.version || null,
        'download'
      );

      if (refreshResult === 'blocked') {
        return state;
      }
    }

    if (state.phase === 'downloaded' && downloadedUpdate) {
      return state;
    }

    if (!pendingUpdate) {
      await checkForAppUpdates({
        force: true,
        allowAutoDownload: false,
      });
    }

    if (state.phase === 'downloaded' && downloadedUpdate) {
      return state;
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

    const updateToDownload = pendingUpdate;
    const isResumingPausedLatestDownload =
      state.phase === 'paused' &&
      state.downloadTargetKind === 'latest' &&
      state.latestVersion === updateToDownload.version;
    let downloadedBytes = isResumingPausedLatestDownload
      ? state.downloadedBytes
      : 0;
    let totalBytes: number | null = isResumingPausedLatestDownload
      ? state.totalBytes
      : null;
    pendingDownloadControlAction = null;

    patchState({
      phase: 'downloading',
      source: 'desktop-updater',
      updateStatus: UpdateStatus.HAS_UPDATE,
      latestVersion: updateToDownload.version,
      downloadTargetKind: 'latest',
      targetManifestUrl: null,
      lastDownloadInterruption: null,
      canUseDesktopUpdater: true,
      canCheck: true,
      canDownload: false,
      canInstall: false,
      isChecking: false,
      isDownloading: true,
      isInstalling: false,
      isBusy: true,
      progressPercent: getDownloadProgressState(downloadedBytes, totalBytes),
      downloadedBytes,
      totalBytes,
      statusMessage: '正在下载最新版...',
      errorMessage: null,
    });

    try {
      await downloadLatestDesktopUpdate(
        updateToDownload.version,
        (event: DesktopDownloadEvent) => {
          switch (event.event) {
            case 'Started':
              totalBytes = event.data.contentLength ?? totalBytes;
              downloadedBytes = event.data.downloadedLength ?? downloadedBytes;
              patchState({
                progressPercent: getDownloadProgressState(
                  downloadedBytes,
                  totalBytes
                ),
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
                progressPercent: 100,
              });
              break;
            default:
              break;
          }
        }
      );
      pendingDownloadControlAction = null;

      setDownloadedUpdate(updateToDownload);
      if (pendingUpdate === updateToDownload) {
        pendingUpdate = null;
      }

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
        publishedAt: updateToDownload.date || state.publishedAt,
        releaseNotes: updateToDownload.body?.trim() || state.releaseNotes,
        statusMessage: readAutoDownloadPreference()
          ? '最新版已自动下载，点击安装即可。'
          : '最新版已下载，点击安装即可。',
        errorMessage: null,
      });
    } catch (error) {
      const controlAction = consumePendingDownloadControlAction();

      if (controlAction === 'paused') {
        applyPausedDownloadState({
          version: updateToDownload.version,
          targetKind: 'latest',
          publishedAt: updateToDownload.date || null,
          releaseNotes: updateToDownload.body?.trim() || null,
          downloadedBytes,
          totalBytes,
        });
        return state;
      }

      if (controlAction === 'canceled') {
        return state;
      }

      patchState({
        phase: 'available',
        source: 'desktop-updater',
        updateStatus: UpdateStatus.HAS_UPDATE,
        latestVersion: updateToDownload.version,
        downloadTargetKind: 'latest',
        targetManifestUrl: null,
        lastDownloadInterruption: null,
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
        statusMessage: '下载最新版失败，请重试。',
        errorMessage:
          error instanceof Error ? error.message : '下载最新版失败，请重试。',
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
    const refreshResult = await refreshDesktopUpdateTargetIfNeeded(
      downloadedUpdate?.version || pendingUpdate?.version || null,
      'install'
    );

    if (refreshResult === 'blocked') {
      return;
    }

    if (refreshResult === 'refreshed') {
      await downloadLatestVersion({
        skipTargetRefresh: true,
      });
      return;
    }

    const updateToInstall = downloadedUpdate;

    if (!updateToInstall || state.phase !== 'downloaded') {
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
      statusMessage: '正在安装更新...',
      errorMessage: null,
    });

    try {
      await installDownloadedDesktopUpdate(updateToInstall.version);
    } catch (error) {
      setDownloadedUpdate(updateToInstall);
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

async function restoreBaseStateAfterStoppedDownload() {
  clearPendingUpdate();
  setDownloadedUpdate(null);
  pendingDownloadControlAction = null;

  return checkForAppUpdates({
    force: true,
    allowAutoDownload: false,
    silent: true,
    skipInFlightGuards: true,
  });
}

async function requestActiveDownloadControl(
  action: AppUpdateDownloadInterruption
) {
  if (action === 'paused') {
    if (state.phase !== 'downloading') {
      return;
    }
  } else if (state.phase === 'paused') {
    await clearPausedDesktopUpdateDownload();
    return restoreBaseStateAfterStoppedDownload();
  } else if (state.phase !== 'downloading') {
    return;
  }

  pendingDownloadControlAction = action;

  try {
    if (action === 'paused') {
      await pauseActiveDesktopUpdateDownload();
    } else {
      await cancelActiveDesktopUpdateDownload();
    }

    const activePromise = downloadPromise || installPromise;
    if (activePromise) {
      await activePromise;
    } else {
      pendingDownloadControlAction = null;
    }

    if (action === 'canceled') {
      return restoreBaseStateAfterStoppedDownload();
    }
  } catch (error) {
    pendingDownloadControlAction = null;
    throw error;
  }
}

export function pauseActiveUpdateDownload() {
  return requestActiveDownloadControl('paused');
}

export function cancelActiveUpdateDownload() {
  return requestActiveDownloadControl('canceled');
}

export async function installDesktopReleaseVersion(
  options: InstallDesktopReleaseVersionOptions
) {
  if (downloadPromise) {
    await downloadPromise;
  }

  if (installPromise) {
    await installPromise;
    return;
  }

  const nextPromise = (async () => {
    const targetVersion = options.version.trim();
    const manifestUrl = options.manifestUrl.trim();
    const publishedAt = options.publishedAt?.trim() || null;
    const releaseNotes = options.releaseNotes?.trim() || null;
    const autoDownloadEnabled = readAutoDownloadPreference();

    clearPendingUpdate();
    setDownloadedUpdate(null);
    pendingDownloadControlAction = null;

    if (!targetVersion || !manifestUrl) {
      patchState({
        phase: 'error',
        source: 'desktop-updater',
        updateStatus: UpdateStatus.HAS_UPDATE,
        latestVersion: targetVersion || null,
        downloadTargetKind: 'release',
        targetManifestUrl: manifestUrl || null,
        lastDownloadInterruption: null,
        autoDownloadEnabled,
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
        publishedAt,
        releaseNotes,
        statusMessage: '所选版本信息不完整，无法执行安装。',
        errorMessage: '所选版本信息不完整，无法执行安装。',
      });
      return;
    }

    if (!isDesktopTarget() || !isDesktopTauriRuntimeAvailable()) {
      patchState({
        phase: 'error',
        source: 'desktop-updater',
        updateStatus: UpdateStatus.HAS_UPDATE,
        latestVersion: targetVersion,
        downloadTargetKind: 'release',
        targetManifestUrl: manifestUrl,
        lastDownloadInterruption: null,
        autoDownloadEnabled,
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
        publishedAt,
        releaseNotes,
        statusMessage: '当前环境无法直接安装指定版本。',
        errorMessage: '当前环境无法直接安装指定版本。',
      });
      return;
    }

    const isResumingPausedReleaseDownload =
      state.phase === 'paused' &&
      state.downloadTargetKind === 'release' &&
      state.latestVersion === targetVersion &&
      state.targetManifestUrl === manifestUrl;
    let downloadedBytes = isResumingPausedReleaseDownload
      ? state.downloadedBytes
      : 0;
    let totalBytes: number | null = isResumingPausedReleaseDownload
      ? state.totalBytes
      : null;

    patchState({
      phase: 'downloading',
      source: 'desktop-updater',
      updateStatus: UpdateStatus.HAS_UPDATE,
      latestVersion: targetVersion,
      downloadTargetKind: 'release',
      targetManifestUrl: manifestUrl,
      lastDownloadInterruption: null,
      autoDownloadEnabled,
      canUseDesktopUpdater: true,
      canCheck: false,
      canDownload: false,
      canInstall: false,
      isChecking: false,
      isDownloading: true,
      isInstalling: false,
      isBusy: true,
      progressPercent: getDownloadProgressState(downloadedBytes, totalBytes),
      downloadedBytes,
      totalBytes,
      publishedAt,
      releaseNotes,
      statusMessage: `正在下载 v${targetVersion}...`,
      errorMessage: null,
    });

    try {
      await installDesktopRelease(manifestUrl, targetVersion, (event) => {
        switch (event.event) {
          case 'Started':
            totalBytes = event.data.contentLength ?? totalBytes;
            downloadedBytes = event.data.downloadedLength ?? downloadedBytes;
            patchState({
              phase: 'downloading',
              progressPercent: getDownloadProgressState(
                downloadedBytes,
                totalBytes
              ),
              downloadedBytes,
              totalBytes,
              statusMessage: `正在下载 v${targetVersion}...`,
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
              progressPercent: 100,
              downloadedBytes,
              totalBytes,
            });
            break;
          case 'Installing':
            patchState({
              phase: 'installing',
              canCheck: false,
              canDownload: false,
              canInstall: false,
              isChecking: false,
              isDownloading: false,
              isInstalling: true,
              isBusy: true,
              progressPercent: totalBytes ? 100 : state.progressPercent,
              downloadedBytes,
              totalBytes,
              statusMessage: `正在安装 v${targetVersion}...`,
              errorMessage: null,
            });
            break;
          default:
            break;
        }
      });

      patchState({
        phase: 'installing',
        source: 'desktop-updater',
        updateStatus: UpdateStatus.HAS_UPDATE,
        latestVersion: targetVersion,
        downloadTargetKind: 'release',
        targetManifestUrl: manifestUrl,
        lastDownloadInterruption: null,
        autoDownloadEnabled,
        canUseDesktopUpdater: true,
        canCheck: false,
        canDownload: false,
        canInstall: false,
        isChecking: false,
        isDownloading: false,
        isInstalling: true,
        isBusy: true,
        progressPercent: totalBytes ? 100 : state.progressPercent,
        downloadedBytes,
        totalBytes,
        publishedAt,
        releaseNotes,
        statusMessage: `正在完成 v${targetVersion} 安装...`,
        errorMessage: null,
      });
    } catch (error) {
      const controlAction = consumePendingDownloadControlAction();

      if (controlAction === 'paused') {
        applyPausedDownloadState({
          version: targetVersion,
          targetKind: 'release',
          manifestUrl,
          publishedAt,
          releaseNotes,
          downloadedBytes,
          totalBytes,
        });
        return;
      }

      if (controlAction === 'canceled') {
        return;
      }

      patchState({
        phase: 'error',
        source: 'desktop-updater',
        updateStatus: UpdateStatus.HAS_UPDATE,
        latestVersion: targetVersion,
        downloadTargetKind: 'release',
        targetManifestUrl: manifestUrl,
        lastDownloadInterruption: null,
        autoDownloadEnabled,
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
        publishedAt,
        releaseNotes,
        statusMessage: `安装 v${targetVersion} 失败，请重试。`,
        errorMessage:
          error instanceof Error
            ? error.message
            : `安装 v${targetVersion} 失败，请重试。`,
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
    state.downloadTargetKind === 'latest' &&
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
