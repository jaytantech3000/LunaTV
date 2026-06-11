import { isDesktopTauriRuntimeAvailable } from '@/lib/desktop/tauri-client';
import { getRuntimeConfig } from '@/lib/runtime-config';

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenVideoElement = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

export interface DesktopPlayerPresentationHandle {
  fullscreenWeb?: boolean;
  template?: {
    $container?: HTMLElement | null;
    $player?: HTMLElement | null;
  };
  video?: HTMLVideoElement | null;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

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

function getFullscreenDocument(): FullscreenDocument | null {
  if (typeof document === 'undefined') {
    return null;
  }

  return document as FullscreenDocument;
}

function getDesktopPlayerRoot(
  player: DesktopPlayerPresentationHandle | null | undefined
): FullscreenElement | null {
  const playerRoot = player?.template?.$player;
  if (playerRoot instanceof HTMLElement) {
    return playerRoot as FullscreenElement;
  }

  const container = player?.template?.$container;
  return container instanceof HTMLElement
    ? (container as FullscreenElement)
    : null;
}

function getDesktopPlayerVideo(
  player: DesktopPlayerPresentationHandle | null | undefined
): FullscreenVideoElement | null {
  const video = player?.video;
  return video instanceof HTMLVideoElement
    ? (video as FullscreenVideoElement)
    : null;
}

function isDocumentPlayerFullscreen(
  player: DesktopPlayerPresentationHandle | null | undefined
): boolean {
  const fullscreenDocument = getFullscreenDocument();
  const fullscreenElement =
    fullscreenDocument?.fullscreenElement ??
    fullscreenDocument?.webkitFullscreenElement ??
    null;
  const playerRoot = getDesktopPlayerRoot(player);

  if (!fullscreenElement || !playerRoot) {
    return false;
  }

  return (
    fullscreenElement === playerRoot ||
    fullscreenElement.contains(playerRoot) ||
    playerRoot.contains(fullscreenElement)
  );
}

export function isDesktopPlayerPresentationFullscreen(
  player: DesktopPlayerPresentationHandle | null | undefined
): boolean {
  if (!player) {
    return false;
  }

  if (player.fullscreenWeb) {
    return true;
  }

  if (isDocumentPlayerFullscreen(player)) {
    return true;
  }

  return Boolean(getDesktopPlayerVideo(player)?.webkitDisplayingFullscreen);
}

async function requestElementPresentationFullscreen(
  target: FullscreenElement | null
): Promise<boolean> {
  if (!target) {
    return false;
  }

  if (typeof target.requestFullscreen === 'function') {
    try {
      await target.requestFullscreen();
      return true;
    } catch (_) {
      // Fall back to platform-specific fullscreen strategies.
    }
  }

  if (typeof target.webkitRequestFullscreen === 'function') {
    try {
      await target.webkitRequestFullscreen();
      return true;
    } catch (_) {
      // Fall back to player-managed web fullscreen.
    }
  }

  return false;
}

function requestVideoPresentationFullscreen(
  video: FullscreenVideoElement | null
): boolean {
  if (!video) {
    return false;
  }

  if (typeof video.webkitEnterFullscreen !== 'function') {
    return false;
  }

  if (video.webkitSupportsFullscreen === false) {
    return false;
  }

  try {
    video.webkitEnterFullscreen();
    return true;
  } catch (_) {
    return false;
  }
}

async function exitElementPresentationFullscreen(): Promise<boolean> {
  const fullscreenDocument = getFullscreenDocument();
  if (!fullscreenDocument) {
    return false;
  }

  if (typeof fullscreenDocument.exitFullscreen === 'function') {
    try {
      await fullscreenDocument.exitFullscreen();
      return true;
    } catch (_) {
      // Fall through to platform-specific fullscreen exit.
    }
  }

  if (typeof fullscreenDocument.webkitExitFullscreen === 'function') {
    try {
      await fullscreenDocument.webkitExitFullscreen();
      return true;
    } catch (_) {
      return false;
    }
  }

  return false;
}

function exitVideoPresentationFullscreen(
  video: FullscreenVideoElement | null
): boolean {
  if (
    !video?.webkitDisplayingFullscreen ||
    typeof video.webkitExitFullscreen !== 'function'
  ) {
    return false;
  }

  try {
    video.webkitExitFullscreen();
    return true;
  } catch (_) {
    return false;
  }
}

export async function setDesktopPlayerPresentationFullscreenState(
  player: DesktopPlayerPresentationHandle | null | undefined,
  fullscreen: boolean
): Promise<boolean> {
  if (!player) {
    return false;
  }

  const video = getDesktopPlayerVideo(player);

  if (!fullscreen) {
    let handled = false;

    if (player.fullscreenWeb) {
      player.fullscreenWeb = false;
      handled = true;
    }

    if (exitVideoPresentationFullscreen(video)) {
      handled = true;
    }

    if (await exitElementPresentationFullscreen()) {
      handled = true;
    }

    return handled;
  }

  if (
    await requestElementPresentationFullscreen(getDesktopPlayerRoot(player))
  ) {
    return true;
  }

  if (requestVideoPresentationFullscreen(video)) {
    return true;
  }

  if (typeof player.fullscreenWeb === 'boolean') {
    player.fullscreenWeb = true;
    return Boolean(player.fullscreenWeb);
  }

  return false;
}

export async function toggleDesktopPlayerPresentationFullscreenState(
  player: DesktopPlayerPresentationHandle | null | undefined
): Promise<boolean | null> {
  if (!player) {
    return null;
  }

  const nextState = !isDesktopPlayerPresentationFullscreen(player);
  const applied = await setDesktopPlayerPresentationFullscreenState(
    player,
    nextState
  );

  return applied ? nextState : null;
}

export function bindDesktopPlayerPresentationFullscreenState(
  player: DesktopPlayerPresentationHandle | null | undefined,
  listener: (fullscreen: boolean) => void
): () => void {
  if (!player) {
    return () => undefined;
  }

  const handleStateChange = () => {
    listener(isDesktopPlayerPresentationFullscreen(player));
  };
  const video = getDesktopPlayerVideo(player);
  const fullscreenWebListener = () => {
    handleStateChange();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', handleStateChange);
    document.addEventListener(
      'webkitfullscreenchange' as keyof DocumentEventMap,
      handleStateChange as EventListener
    );
  }

  video?.addEventListener('webkitbeginfullscreen', handleStateChange);
  video?.addEventListener('webkitendfullscreen', handleStateChange);
  player.on?.('fullscreenWeb', fullscreenWebListener);

  handleStateChange();

  return () => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', handleStateChange);
      document.removeEventListener(
        'webkitfullscreenchange' as keyof DocumentEventMap,
        handleStateChange as EventListener
      );
    }

    video?.removeEventListener('webkitbeginfullscreen', handleStateChange);
    video?.removeEventListener('webkitendfullscreen', handleStateChange);
    player.off?.('fullscreenWeb', fullscreenWebListener);
  };
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
