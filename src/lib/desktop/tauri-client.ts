import { getRuntimeConfig } from '@/lib/runtime-config';

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

async function invokeDesktopCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  ensureDesktopTarget();

  if (!isDesktopTauriRuntimeAvailable()) {
    throw new Error(
      'Desktop IPC is unavailable in browser preview. Run inside the Tauri shell.'
    );
  }

  const { invoke } = await import('@tauri-apps/api/core');
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
  username: string,
  newPassword: string
): Promise<DesktopAuthStatus> {
  return invokeDesktopCommand<DesktopAuthStatus>('change_desktop_password', {
    username,
    newPassword,
  });
}
