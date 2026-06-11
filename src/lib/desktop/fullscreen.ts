import { isDesktopTauriRuntimeAvailable } from '@/lib/desktop/tauri-client';
import { getRuntimeConfig } from '@/lib/runtime-config';

function isDesktopFullscreenRuntimeAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    getRuntimeConfig().APP_TARGET === 'desktop' &&
    isDesktopTauriRuntimeAvailable()
  );
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /mac/i.test(navigator.userAgent);
}

async function getDesktopWindowHandle() {
  if (!isDesktopFullscreenRuntimeAvailable()) {
    return null;
  }

  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export async function getDesktopWindowFullscreenState(): Promise<
  boolean | null
> {
  const windowHandle = await getDesktopWindowHandle();
  if (!windowHandle) {
    return null;
  }

  try {
    return await windowHandle.isFullscreen();
  } catch (_) {
    return null;
  }
}

export async function setDesktopWindowFullscreenState(
  fullscreen: boolean
): Promise<boolean> {
  const windowHandle = await getDesktopWindowHandle();
  if (!windowHandle) {
    return false;
  }

  try {
    if (isMacPlatform()) {
      try {
        await windowHandle.setSimpleFullscreen(fullscreen);
      } catch (_) {
        await windowHandle.setFullscreen(fullscreen);
      }
    } else {
      await windowHandle.setFullscreen(fullscreen);
    }

    return true;
  } catch (_) {
    return false;
  }
}

export async function toggleDesktopWindowFullscreenState(): Promise<
  boolean | null
> {
  const currentState = await getDesktopWindowFullscreenState();
  if (currentState === null) {
    return null;
  }

  const nextState = !currentState;
  const applied = await setDesktopWindowFullscreenState(nextState);

  return applied ? nextState : null;
}
