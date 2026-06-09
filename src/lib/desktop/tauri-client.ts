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
