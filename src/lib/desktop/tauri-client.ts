import type { DesktopReleaseHistoryItem } from '@/lib/desktop-release-history';
import { getRuntimeConfig } from '@/lib/runtime-config';

import { loadTauriCoreModule } from './tauri-runtime';

export interface DesktopLocalServiceStatus {
  running: boolean;
  port: number;
  baseUrl: string;
  configPath: string;
  dataDir: string;
  sqlitePath: string;
}

export type DesktopAppConfig = Record<string, unknown>;

export interface DesktopAuthStatus {
  username: string;
  passwordRequired: boolean;
  multiUser: boolean;
  ownerPasswordConfigured: boolean;
}

export interface DesktopAuthSession {
  username: string;
  role: 'owner' | 'admin' | 'user';
  adminCapability?: string;
}

export interface DesktopAvailableUpdate {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

export type DesktopDiagnosticsLevel = 'ok' | 'warning' | 'error';

export interface DesktopLocalServiceDiagnosticFinding {
  level: DesktopDiagnosticsLevel;
  title: string;
  detail: string;
}

export interface DesktopLocalServiceDiagnosticsReport {
  status: DesktopDiagnosticsLevel;
  capturedAtMs: number;
  summary: string;
  findings: DesktopLocalServiceDiagnosticFinding[];
  recommendations: string[];
  logText: string;
}

export interface DesktopLocalServiceDiagnosticsUploadResult {
  uploaded: boolean;
  target: string;
  issueUrl?: string | null;
  issueNumber?: number | null;
  message: string;
}

export interface DesktopLocalServiceDiagnosticsSaveResult {
  saved: boolean;
  canceled: boolean;
  path: string | null;
}

export type DesktopReleaseInstallEvent =
  | {
      event: 'Started';
      data: {
        contentLength?: number;
        downloadedLength?: number;
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
    }
  | {
      event: 'Installing';
    };

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

function ensureDesktopTarget() {
  if (getRuntimeConfig().APP_TARGET !== 'desktop') {
    throw new Error('Desktop IPC is only available for desktop builds.');
  }
}

export function isDesktopTauriRuntimeAvailable(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

export async function invokeDesktopCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  ensureDesktopTarget();

  if (!isDesktopTauriRuntimeAvailable()) {
    throw new Error(
      'Desktop IPC is unavailable in browser preview. Run inside the Tauri shell.'
    );
  }

  const { invoke } = await loadTauriCoreModule();
  return invoke<T>(command, args);
}

export function getLocalServiceStatus(): Promise<DesktopLocalServiceStatus> {
  return invokeDesktopCommand<DesktopLocalServiceStatus>(
    'get_local_service_status'
  );
}

export function startLocalService(): Promise<DesktopLocalServiceStatus> {
  return invokeDesktopCommand<DesktopLocalServiceStatus>('start_local_service');
}

export function stopLocalService(): Promise<DesktopLocalServiceStatus> {
  return invokeDesktopCommand<DesktopLocalServiceStatus>('stop_local_service');
}

export function runLocalServiceDiagnostics(): Promise<DesktopLocalServiceDiagnosticsReport> {
  return invokeDesktopCommand<DesktopLocalServiceDiagnosticsReport>(
    'run_local_service_diagnostics'
  );
}

export function uploadLocalServiceDiagnostics(
  remoteBaseUrl: string,
  report: DesktopLocalServiceDiagnosticsReport
): Promise<DesktopLocalServiceDiagnosticsUploadResult> {
  return invokeDesktopCommand<DesktopLocalServiceDiagnosticsUploadResult>(
    'upload_local_service_diagnostics',
    {
      remoteBaseUrl,
      report,
    }
  );
}

export function saveLocalServiceDiagnostics(
  defaultFilename: string,
  contents: string
): Promise<DesktopLocalServiceDiagnosticsSaveResult> {
  return invokeDesktopCommand<DesktopLocalServiceDiagnosticsSaveResult>(
    'save_local_service_diagnostics',
    {
      defaultFilename,
      contents,
    }
  );
}

export function readDesktopAppConfig(): Promise<DesktopAppConfig> {
  return invokeDesktopCommand<DesktopAppConfig>('read_app_config');
}

export function writeDesktopAppConfig(
  config: DesktopAppConfig
): Promise<DesktopAppConfig> {
  return invokeDesktopCommand<DesktopAppConfig>('write_app_config', {
    config,
  });
}

export function getDesktopAuthStatus(): Promise<DesktopAuthStatus> {
  return invokeDesktopCommand<DesktopAuthStatus>('get_desktop_auth_status');
}

export function desktopLogin(
  username?: string,
  password?: string
): Promise<DesktopAuthSession> {
  return invokeDesktopCommand<DesktopAuthSession>('desktop_login', {
    username,
    password,
  });
}

export function changeDesktopPassword(
  currentPassword: string,
  newPassword: string
): Promise<DesktopAuthStatus> {
  return invokeDesktopCommand<DesktopAuthStatus>('change_desktop_password', {
    currentPassword,
    newPassword,
  });
}

export function checkDesktopUpdate(): Promise<DesktopAvailableUpdate | null> {
  return invokeDesktopCommand<DesktopAvailableUpdate | null>(
    'check_desktop_update'
  );
}

export function fetchLatestRemoteVersionFromDesktop(
  urls: readonly string[]
): Promise<string | null> {
  return invokeDesktopCommand<string | null>('fetch_latest_remote_version', {
    urls,
  });
}

export function fetchDesktopReleaseHistory(
  repository: string
): Promise<DesktopReleaseHistoryItem[]> {
  return invokeDesktopCommand<DesktopReleaseHistoryItem[]>(
    'fetch_desktop_release_history',
    {
      repository,
    }
  );
}

export async function installDesktopRelease(
  manifestUrl: string,
  version: string,
  onEvent?: (event: DesktopReleaseInstallEvent) => void
): Promise<void> {
  ensureDesktopTarget();

  if (!isDesktopTauriRuntimeAvailable()) {
    throw new Error(
      'Desktop IPC is unavailable in browser preview. Run inside the Tauri shell.'
    );
  }

  const { Channel, invoke } = await loadTauriCoreModule();
  const channel = new Channel<DesktopReleaseInstallEvent>();

  if (onEvent) {
    channel.onmessage = onEvent;
  }

  await invoke('install_desktop_release', {
    manifestUrl,
    version,
    onEvent: channel,
  });
}

export async function downloadDesktopRelease(
  manifestUrl: string,
  version: string,
  onEvent?: (event: DesktopReleaseInstallEvent) => void
): Promise<void> {
  ensureDesktopTarget();

  if (!isDesktopTauriRuntimeAvailable()) {
    throw new Error(
      'Desktop IPC is unavailable in browser preview. Run inside the Tauri shell.'
    );
  }

  const { Channel, invoke } = await loadTauriCoreModule();
  const channel = new Channel<DesktopReleaseInstallEvent>();

  if (onEvent) {
    channel.onmessage = onEvent;
  }

  await invoke('download_desktop_release', {
    manifestUrl,
    version,
    onEvent: channel,
  });
}

export async function downloadLatestDesktopUpdate(
  version: string,
  onEvent?: (event: DesktopReleaseInstallEvent) => void
): Promise<void> {
  ensureDesktopTarget();

  if (!isDesktopTauriRuntimeAvailable()) {
    throw new Error(
      'Desktop IPC is unavailable in browser preview. Run inside the Tauri shell.'
    );
  }

  const { Channel, invoke } = await loadTauriCoreModule();
  const channel = new Channel<DesktopReleaseInstallEvent>();

  if (onEvent) {
    channel.onmessage = onEvent;
  }

  await invoke('download_latest_desktop_update', {
    version,
    onEvent: channel,
  });
}

export function installDownloadedDesktopUpdate(
  version?: string
): Promise<void> {
  return invokeDesktopCommand<void>('install_downloaded_desktop_update', {
    version,
  });
}

export function pauseActiveDesktopUpdateDownload(): Promise<void> {
  return invokeDesktopCommand<void>('pause_active_desktop_update_download');
}

export function cancelActiveDesktopUpdateDownload(): Promise<void> {
  return invokeDesktopCommand<void>('cancel_active_desktop_update_download');
}

export function clearPausedDesktopUpdateDownload(): Promise<void> {
  return invokeDesktopCommand<void>('clear_paused_desktop_update_download');
}

export function openDesktopExternalUrl(url: string): Promise<void> {
  return invokeDesktopCommand<void>('open_external_url', {
    url,
  });
}
