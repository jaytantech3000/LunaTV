import { getRuntimeConfig } from '@/lib/runtime-config';

import { invokeDesktopCommand } from './tauri-client';

const LOCAL_SERVICE_ACCESS_TOKEN_HEADER = 'X-MoonTV-Local-Token';

let accessTokenPromise: Promise<string> | null = null;

export function canUseLocalServiceAccessToken(): boolean {
  return Boolean(
    getRuntimeConfig().APP_TARGET === 'desktop' &&
      typeof window !== 'undefined' &&
      (window.__TAURI_INTERNALS__ || window.__TAURI__)
  );
}

async function getLocalServiceAccessToken(): Promise<string | null> {
  if (!canUseLocalServiceAccessToken()) {
    return null;
  }

  accessTokenPromise ??= invokeDesktopCommand<string>(
    'get_local_service_access_token'
  );

  try {
    return await accessTokenPromise;
  } catch (error) {
    accessTokenPromise = null;
    throw error;
  }
}

export async function withLocalServiceAccessToken(
  options: RequestInit = {}
): Promise<RequestInit> {
  const accessToken = await getLocalServiceAccessToken();
  if (!accessToken) {
    return options;
  }

  const headers = new Headers(options.headers);
  headers.set(LOCAL_SERVICE_ACCESS_TOKEN_HEADER, accessToken);

  return {
    ...options,
    headers,
  };
}

export async function localServiceFetch(
  input: RequestInfo | URL,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(input, await withLocalServiceAccessToken(options));
}

export function resetLocalServiceAccessTokenForTests() {
  accessTokenPromise = null;
}
