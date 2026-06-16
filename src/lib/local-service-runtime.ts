import { AppRuntimeConfig, getRuntimeConfig } from './runtime-config';

export const LOCAL_SERVICE_DEFAULT_BASE_URL = 'http://127.0.0.1:8787';
export const LOCAL_SERVICE_HEALTH_URL =
  `${LOCAL_SERVICE_DEFAULT_BASE_URL}/health`;
export const LOCAL_SERVICE_ACCELERATION_STORAGE_KEY =
  'lunatv.localService.mediaProxyBaseUrl';

function getWindowStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeLocalServiceBaseUrl(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return normalized.replace(/\/+$/, '');
  }
}

export function normalizeLocalServiceOrigin(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).origin;
  } catch {
    return normalizeLocalServiceBaseUrl(normalized);
  }
}

export function applyLocalServiceMediaProxyOverride(
  runtimeConfig: AppRuntimeConfig,
  storedBaseUrl: string | null | undefined
): AppRuntimeConfig {
  const normalizedBaseUrl = normalizeLocalServiceBaseUrl(storedBaseUrl);

  if (!normalizedBaseUrl) {
    return runtimeConfig;
  }

  return {
    ...runtimeConfig,
    MEDIA_PROXY_BASE_URL: normalizedBaseUrl,
  };
}

export function isLocalServiceAccelerationActive(
  localServiceBaseUrl: string,
  runtimeConfig: AppRuntimeConfig = getRuntimeConfig()
): boolean {
  const configuredOrigin = normalizeLocalServiceOrigin(
    runtimeConfig.MEDIA_PROXY_BASE_URL
  );
  const localServiceOrigin = normalizeLocalServiceOrigin(localServiceBaseUrl);

  return Boolean(
    configuredOrigin &&
      localServiceOrigin &&
      configuredOrigin === localServiceOrigin
  );
}

export function getStoredLocalServiceAccelerationBaseUrl(
  storage: Pick<Storage, 'getItem'> | null = getWindowStorage()
): string | null {
  if (!storage) {
    return null;
  }

  try {
    return normalizeLocalServiceBaseUrl(
      storage.getItem(LOCAL_SERVICE_ACCELERATION_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

export function setStoredLocalServiceAccelerationBaseUrl(
  baseUrl: string,
  storage: Pick<Storage, 'setItem'> | null = getWindowStorage()
): string | null {
  const normalizedBaseUrl = normalizeLocalServiceBaseUrl(baseUrl);

  if (!storage || !normalizedBaseUrl) {
    return null;
  }

  try {
    storage.setItem(
      LOCAL_SERVICE_ACCELERATION_STORAGE_KEY,
      normalizedBaseUrl
    );
    return normalizedBaseUrl;
  } catch {
    return null;
  }
}

export function clearStoredLocalServiceAccelerationBaseUrl(
  storage: Pick<Storage, 'removeItem'> | null = getWindowStorage()
): void {
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(LOCAL_SERVICE_ACCELERATION_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures and keep the current runtime state.
  }
}

export function buildRuntimeConfigBootstrapScript(
  runtimeConfig: AppRuntimeConfig
): string {
  return `(() => {
  const runtimeConfig = ${JSON.stringify(runtimeConfig)};
  try {
    const storedBaseUrl = window.localStorage.getItem(${JSON.stringify(
      LOCAL_SERVICE_ACCELERATION_STORAGE_KEY
    )});
    const normalizedBaseUrl = typeof storedBaseUrl === 'string'
      ? storedBaseUrl.trim()
      : '';
    if (normalizedBaseUrl) {
      try {
        const parsed = new URL(normalizedBaseUrl);
        runtimeConfig.MEDIA_PROXY_BASE_URL = \`\${parsed.origin}\${parsed.pathname.replace(/\\/+$/, '')}\`;
      } catch {
        runtimeConfig.MEDIA_PROXY_BASE_URL = normalizedBaseUrl.replace(/\\/+$/, '');
      }
    }
  } catch {}
  window.RUNTIME_CONFIG = runtimeConfig;
})();`;
}
