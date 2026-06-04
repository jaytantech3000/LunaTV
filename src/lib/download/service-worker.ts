const DEFAULT_SERVICE_WORKER_READY_TIMEOUT_MS = 1500;

function waitForControllerChange(
  serviceWorker: ServiceWorkerContainer,
  timeoutMs: number
): Promise<boolean> {
  if (serviceWorker.controller) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const handleControllerChange = () => {
      cleanup(Boolean(serviceWorker.controller));
    };

    const cleanup = (result: boolean) => {
      window.clearTimeout(timeoutId);
      serviceWorker.removeEventListener(
        'controllerchange',
        handleControllerChange
      );
      resolve(result);
    };

    const timeoutId = window.setTimeout(() => {
      cleanup(Boolean(serviceWorker.controller));
    }, timeoutMs);

    serviceWorker.addEventListener(
      'controllerchange',
      handleControllerChange,
      {
        once: true,
      }
    );
  });
}

export async function ensureOfflineServiceWorkerReady(
  timeoutMs = DEFAULT_SERVICE_WORKER_READY_TIMEOUT_MS
): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !window.isSecureContext ||
    !('serviceWorker' in navigator)
  ) {
    return false;
  }

  const serviceWorker = navigator.serviceWorker;

  try {
    const registration = await serviceWorker.getRegistration();
    if (!registration) {
      return false;
    }

    if (serviceWorker.controller) {
      return true;
    }

    await Promise.race([
      serviceWorker.ready.then(() => undefined),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeoutMs);
      }),
    ]);

    if (serviceWorker.controller) {
      return true;
    }

    return waitForControllerChange(serviceWorker, timeoutMs);
  } catch (_) {
    return false;
  }
}
