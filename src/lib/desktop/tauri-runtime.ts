export interface TauriChannel<T> {
  onmessage?: ((message: T) => void) | null;
}

export interface TauriCoreModule {
  Channel: new <T>() => TauriChannel<T>;
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
}

export interface TauriWindowHandle {
  isFullscreen: () => Promise<boolean>;
  onResized: (listener: () => void) => Promise<() => void>;
  setFullscreen: (fullscreen: boolean) => Promise<void>;
  setSimpleFullscreen: (fullscreen: boolean) => Promise<void>;
}

export interface TauriWindowModule {
  getCurrentWindow: () => TauriWindowHandle;
}

export async function loadTauriCoreModule(): Promise<TauriCoreModule> {
  return import('@tauri-apps/api/core') as Promise<TauriCoreModule>;
}

export async function loadTauriWindowModule(): Promise<TauriWindowModule> {
  return import('@tauri-apps/api/window') as Promise<TauriWindowModule>;
}
